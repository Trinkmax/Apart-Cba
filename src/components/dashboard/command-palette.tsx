"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { Building2, CalendarDays, CornerDownLeft, Loader2, Search, UserRound, Users, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fold } from "@/lib/tex/format";
import { searchEverything, type GlobalSearchHit } from "@/lib/actions/global-search";
import type { UserRole } from "@/lib/types/database";
import { TexAvatar } from "@/components/tex/tex-avatar";
import { SCREEN_ICONS } from "@/components/mobile/icons";
import { reachableScreens, type ShellContext } from "@/components/mobile/routes";
import { openTex } from "@/components/mobile/shell-store";

/*
 * ⌘K (nov-2026): ir a cualquier pantalla o encontrar una reserva, un
 * huésped, una unidad, un propietario o un movimiento escribiendo. Si Tex está
 * encendido, la primera opción es preguntarle lo que escribiste. Mismo
 * buscador que la hoja «Más» del celular (`searchEverything`).
 */

const HIT_ICON: Record<GlobalSearchHit["kind"], React.ComponentType<{ className?: string }>> = {
  reserva: CalendarDays,
  huesped: Users,
  unidad: Building2,
  propietario: UserRound,
  movimiento: Wallet,
};
const HIT_LABEL: Record<GlobalSearchHit["kind"], string> = {
  reserva: "Reserva",
  huesped: "Huésped",
  unidad: "Unidad",
  propietario: "Propietario",
  movimiento: "Movimiento",
};

export function CommandPalette({
  role,
  rentalsEnabled,
  texEnabled,
}: {
  role: UserRole;
  rentalsEnabled: boolean;
  texEnabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const ctx = React.useMemo<ShellContext>(() => ({ role, rentalsEnabled }), [role, rentalsEnabled]);
  const screens = React.useMemo(() => reachableScreens(ctx).filter((s) => role === "limpieza" || role === "mantenimiento" || !s.href.startsWith("/m")), [ctx, role]);
  const [result, setResult] = React.useState<{ q: string; hits: GlobalSearchHit[] } | null>(null);
  const q = query.trim();
  const hits = result && result.q === q ? result.hits : [];
  const loading = q.length >= 2 && result?.q !== q;

  // ⌘K / Ctrl+K abre y cierra desde cualquier pantalla.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (q.length < 2) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      const r = await searchEverything(q, { limit: 12 }).catch(() => null);
      if (alive) setResult({ q, hits: r && r.ok ? r.hits : [] });
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const screenHits = React.useMemo(() => {
    const f = fold(q);
    if (!f) return screens;
    return screens.filter((s) => fold(`${s.label} ${s.keywords ?? ""}`).includes(f));
  }, [q, screens]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 items-center gap-2 rounded-full border border-black/[0.08] bg-black/[0.03] pr-1.5 pl-3 text-[13px] text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground md:flex dark:border-white/10 dark:bg-white/[0.04]"
        aria-label="Buscar (⌘K)"
      >
        <Search size={15} />
        <span className="hidden 2xl:inline">Buscar…</span>
        <kbd className="rounded-md border border-black/10 bg-background px-1.5 py-0.5 text-[10px] font-medium dark:border-white/10">⌘K</kbd>
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        {/* Arriba (como Spotlight), no centrado: la lista crece hacia abajo sin mover el buscador. */}
        <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:top-[14vh] sm:max-w-[600px] sm:translate-y-0 sm:p-0">
          <DialogTitle className="sr-only">Buscar en Apart</DialogTitle>
          <CommandPrimitive shouldFilter={false} loop className="flex flex-col">
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search size={18} className="shrink-0 text-muted-foreground" />
              <CommandPrimitive.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Buscá una reserva, un huésped, una unidad o una pantalla…"
                className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
              {loading ? <Loader2 size={16} className="shrink-0 animate-spin text-muted-foreground" /> : null}
            </div>
            <CommandPrimitive.List className="max-h-[min(60vh,460px)] overflow-y-auto p-2">
              <CommandPrimitive.Empty className="px-3 py-8 text-center text-[14px] text-muted-foreground">
                {loading ? "Buscando…" : `No encontré nada con «${q}».`}
              </CommandPrimitive.Empty>

              {texEnabled && role !== "owner_view" && q ? (
                <CommandPrimitive.Group heading="Tex" className={GROUP}>
                  <CommandPrimitive.Item
                    value={`tex ${q}`}
                    onSelect={() => {
                      setOpen(false);
                      setQuery("");
                      openTex({ prompt: q });
                    }}
                    className={ITEM}
                  >
                    <TexAvatar mood="face" className="size-7 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      Preguntale a Tex: <span className="font-semibold">«{q}»</span>
                    </span>
                    <CornerDownLeft size={14} className="text-muted-foreground" />
                  </CommandPrimitive.Item>
                </CommandPrimitive.Group>
              ) : null}

              {screenHits.length ? (
                <CommandPrimitive.Group heading={q ? "Pantallas" : "Ir a"} className={GROUP}>
                  {screenHits.slice(0, q ? 6 : 20).map((s) => {
                    const Icon = SCREEN_ICONS[s.icon];
                    return (
                      <CommandPrimitive.Item key={s.href} value={`screen ${s.href}`} onSelect={() => go(s.href)} className={ITEM}>
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[oklch(0.95_0.025_150)] text-[oklch(0.4_0.07_152)] dark:bg-white/10 dark:text-[oklch(0.86_0.08_150)]">
                          <Icon className="size-4" />
                        </span>
                        <span className="flex-1">{s.label}</span>
                      </CommandPrimitive.Item>
                    );
                  })}
                </CommandPrimitive.Group>
              ) : null}

              {hits.length ? (
                <CommandPrimitive.Group heading="En tus datos" className={GROUP}>
                  {hits.map((h) => {
                    const Icon = HIT_ICON[h.kind];
                    return (
                      <CommandPrimitive.Item key={`${h.kind}-${h.id}`} value={`${h.kind} ${h.id}`} onSelect={() => go(h.href)} className={ITEM}>
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-black/[0.05] dark:bg-white/10">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{h.title}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {HIT_LABEL[h.kind]}
                            {h.subtitle ? ` · ${h.subtitle}` : ""}
                          </span>
                        </span>
                        {h.meta ? <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{h.meta}</span> : null}
                      </CommandPrimitive.Item>
                    );
                  })}
                </CommandPrimitive.Group>
              ) : null}
            </CommandPrimitive.List>
            <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
              <span>
                <kbd className={KBD}>↑</kbd> <kbd className={KBD}>↓</kbd> moverse
              </span>
              <span>
                <kbd className={KBD}>↵</kbd> abrir
              </span>
              <span className="ml-auto">
                <kbd className={KBD}>esc</kbd> cerrar
              </span>
            </div>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>
    </>
  );
}

const GROUP =
  "mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase";
const ITEM = cn(
  "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-[14px] outline-none select-none",
  "data-[selected=true]:bg-[oklch(0.95_0.03_150)] dark:data-[selected=true]:bg-white/[0.08]",
);
const KBD = "rounded border border-border bg-muted px-1 py-px text-[10px]";
