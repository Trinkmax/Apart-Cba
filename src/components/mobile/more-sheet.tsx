"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTheme } from "next-themes";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Loader2,
  LogOut,
  MonitorDown,
  Moon,
  Receipt,
  Search,
  Sun,
  SunMoon,
  UserRound,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptics";
import { useMounted } from "@/lib/ui/use-mounted";
import { fold } from "@/lib/tex/format";
import { signOut } from "@/lib/actions/auth";
import { setCurrentOrg } from "@/lib/actions/org";
import { searchEverything, type GlobalSearchHit } from "@/lib/actions/global-search";
import { ROLE_META } from "@/lib/constants";
import { getInitials } from "@/lib/format";
import { requestInstall, useInstallApp } from "@/components/pwa/install-app-prompt";
import { TexAvatar } from "@/components/tex/tex-avatar";
import type { UserRole } from "@/lib/types/database";
import { SCREEN_ICONS } from "./icons";
import { moreGroups, profileHref, reachableScreens, routeMeta, type ScreenLink, type ShellContext } from "./routes";
import { closeMore, openTex, originOf, useMoreOpen, useShellPathname } from "./shell-store";

/*
 * «Más» en el celular (nov-2026): la pestaña abre una hoja de vidrio que flota
 * arriba de la barra (que sigue viva y tocable), con lo que no entra abajo:
 * la persona, el buscador de todo, Tex, los mosaicos por grupo, el tema y el
 * cambio de organización. Inspirada en la hoja «Más» de sharp-app.
 */

export type MoreSheetProps = {
  role: UserRole;
  rentalsEnabled: boolean;
  texEnabled: boolean;
  user: { fullName: string; email?: string | null; avatarUrl?: string | null };
  org: { id: string; name: string };
  memberships: Array<{ id: string; name: string; role: UserRole }>;
  /** Avisos sin leer (número en el mosaico «Avisos»). */
  unreadCount: number;
};

export function MoreSheet(props: MoreSheetProps) {
  const open = useMoreOpen();
  const pathname = useShellPathname();

  // Llegó otra pantalla (un mosaico, el buscador, el «atrás»): la hoja se va.
  const last = React.useRef(pathname);
  React.useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    closeMore();
  }, [pathname]);

  // Con la hoja abierta la barra queda arriba del velo (mobile-shell.css).
  React.useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    html.setAttribute("data-more-open", "");
    return () => html.removeAttribute("data-more-open");
  }, [open]);

  // En la compu no hay pestañas: si la ventana se agranda con la hoja abierta, se cierra.
  React.useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => mq.matches && closeMore();
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open]);

  React.useEffect(() => () => closeMore(), []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && closeMore()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="lg-overlay fixed inset-0 z-50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 md:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // La barra sigue viva debajo de la hoja: tocarla no es «tocar afuera».
          onInteractOutside={(e) => {
            const t = e.target as Element | null;
            if (t && typeof t.closest === "function" && t.closest(".lg-bar")) e.preventDefault();
          }}
          className={cn(
            "lg-sheet fixed inset-x-2 z-50 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[28px] outline-none md:hidden",
            "bottom-[calc(var(--bar-h)+var(--bar-offset)+10px)]",
            "max-h-[calc(100dvh-var(--safe-t)-var(--bar-h)-var(--bar-offset)-1.5rem)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-6 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-4 data-[state=closed]:zoom-out-95",
            "origin-bottom duration-300",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Más</DialogPrimitive.Title>
          <MoreContent {...props} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** `data-scrolled` en la hoja mientras su contenido pasa por debajo del encabezado. */
function markScroll(mark: HTMLSpanElement | null): (() => void) | undefined {
  const sheet = mark?.parentElement;
  if (!mark || !sheet) return undefined;
  if (typeof IntersectionObserver === "undefined") {
    sheet.setAttribute("data-scrolled", "");
    return undefined;
  }
  const io = new IntersectionObserver(
    (entries) => {
      const e = entries[entries.length - 1];
      if (e) sheet.toggleAttribute("data-scrolled", !e.isIntersecting);
    },
    { root: sheet },
  );
  io.observe(mark);
  return () => io.disconnect();
}

function MoreContent({ role, rentalsEnabled, texEnabled, user, org, memberships, unreadCount }: MoreSheetProps) {
  const pathname = useShellPathname();
  const ctx = React.useMemo<ShellContext>(() => ({ role, rentalsEnabled }), [role, rentalsEnabled]);
  const groups = React.useMemo(() => moreGroups(ctx), [ctx]);
  const current = React.useMemo(() => routeMeta(pathname, ctx), [pathname, ctx]);
  const [query, setQuery] = React.useState("");
  const texRef = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <span ref={markScroll} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1" />
      <span aria-hidden className="lg-handle mx-auto mt-2.5 block h-[5px] w-9 rounded-full" />

      {/* Encabezado fijo: la persona y la cruz no se van al bajar. */}
      <div className="lg-head sticky -top-2 z-10 mt-1 px-4 pt-2 pb-3">
        <div className="flex min-h-14 items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[oklch(0.93_0.04_150)] text-[15px] font-semibold text-[oklch(0.35_0.06_152)] dark:bg-white/10 dark:text-white">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar de Storage, sin optimizador
              <img src={user.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              getInitials(user.fullName)
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] leading-snug font-semibold tracking-tight">{user.fullName}</p>
            <p className="truncate text-[13.5px] leading-snug text-muted-foreground">
              {ROLE_META[role]?.label ?? role} · {org.name}
            </p>
          </div>
          <DialogPrimitive.Close
            aria-label="Cerrar"
            className="lg-tile -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-foreground transition-transform duration-150 active:scale-[0.94]"
          >
            <X className="size-5" strokeWidth={2.25} aria-hidden />
          </DialogPrimitive.Close>
        </div>
      </div>

      <div className="space-y-5 px-4 pb-5">
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={profileHref(role)}
            className={cn(
              "flex h-12 items-center justify-center gap-2 rounded-full text-[15px] font-medium",
              current.title === "Mi perfil" ? "lg-tile-on" : "lg-tile",
            )}
          >
            <UserRound className="size-[18px]" aria-hidden />
            Mi perfil
          </Link>
          <SignOutChip />
        </div>

        <MoreSearch ctx={ctx} query={query} onQuery={setQuery} />

        {!query && texEnabled && role !== "owner_view" ? (
          <button
            ref={texRef}
            type="button"
            onClick={() => {
              haptic("impact");
              openTex({ origin: originOf(texRef.current) });
            }}
            className="lg-tile relative flex w-full items-center gap-3 overflow-hidden rounded-[22px] p-3 pr-4 text-left active:scale-[0.99]"
          >
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#dcefff] dark:bg-[#123250]">
              <TexAvatar mood="wave" className="size-12" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold tracking-tight">Hablá con Tex</span>
              <span className="block text-[13.5px] leading-snug text-muted-foreground">
                Preguntale lo que quieras o pedile que cargue algo por vos.
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        ) : null}

        {!query
          ? groups.map((g) => (
              <section key={g.id} aria-labelledby={`more-${g.id}`}>
                <h3
                  id={`more-${g.id}`}
                  className="mb-2.5 px-1 text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
                >
                  {g.title}
                </h3>
                <ul className="grid grid-cols-3 gap-2" role="list">
                  {g.rows.map((row) => (
                    <li key={row.id} className="flex min-w-0 *:flex-1">
                      <Tile row={row} current={current.tab === "mas" && current.title === row.label} badge={row.id === "avisos" ? unreadCount : 0} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          : null}

        {!query ? (
          <section aria-labelledby="more-cuenta" className="space-y-2">
            <h3 id="more-cuenta" className="mb-2.5 px-1 text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Tu cuenta
            </h3>
            <ThemeRow />
            {memberships.length > 1 ? <OrgSwitch current={org.id} memberships={memberships} /> : null}
            <InstallRow />
          </section>
        ) : null}
      </div>
    </>
  );
}

function Tile({ row, current, badge }: { row: ScreenLink; current: boolean; badge?: number }) {
  const Icon = SCREEN_ICONS[row.icon];
  return (
    <Link
      href={row.href}
      className={cn(
        "flex aspect-[1/0.92] flex-col items-center justify-center gap-2 rounded-[20px] px-1.5 text-center transition-transform duration-150 active:scale-[0.96]",
        current ? "lg-tile-on" : "lg-tile",
      )}
    >
      <span
        className={cn(
          "relative grid size-11 place-items-center rounded-[14px]",
          current
            ? "bg-[oklch(0.6_0.09_152)] text-white"
            : "bg-[oklch(0.95_0.025_150)] text-[oklch(0.38_0.06_152)] dark:bg-white/10 dark:text-[oklch(0.86_0.08_150)]",
        )}
      >
        <Icon className="size-[22px]" aria-hidden />
        {badge ? (
          <span className="absolute -top-2 -right-2.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#e5533d] px-1.5 text-[11px] font-bold leading-none text-white tabular-nums ring-2 ring-white dark:ring-[#1c211e]">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span className={cn("line-clamp-2 text-[13px] leading-tight", current ? "font-semibold" : "font-medium")}>
        {row.label}
      </span>
    </Link>
  );
}

function SignOutChip() {
  const [pending, setPending] = React.useState(false);
  return (
    <form action={signOut} onSubmit={() => setPending(true)} className="contents">
      <button
        type="submit"
        disabled={pending}
        className="lg-tile flex h-12 items-center justify-center gap-2 rounded-full text-[15px] font-medium disabled:opacity-70"
      >
        {pending ? <Loader2 className="size-[18px] animate-spin" aria-hidden /> : <LogOut className="size-[18px]" aria-hidden />}
        Cerrar sesión
      </button>
    </form>
  );
}

function ThemeRow() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const options: Array<{ id: string; label: string; icon: LucideIcon }> = [
    { id: "light", label: "Claro", icon: Sun },
    { id: "dark", label: "Oscuro", icon: Moon },
    { id: "system", label: "Auto", icon: SunMoon },
  ];
  return (
    <div className="lg-tile flex items-center gap-3 rounded-[20px] p-2 pl-3.5">
      <span className="flex-1 text-[15px] font-medium">Tema</span>
      <div className="flex rounded-full bg-black/[0.05] p-0.5 dark:bg-white/[0.08]" role="radiogroup" aria-label="Tema">
        {options.map((o) => {
          const on = mounted && (theme ?? "light") === o.id;
          const Icon = o.icon;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                haptic("selection");
                setTheme(o.id);
              }}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                on ? "bg-white text-foreground shadow-sm dark:bg-white/15" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OrgSwitch({ current, memberships }: { current: string; memberships: Array<{ id: string; name: string; role: UserRole }> }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [target, setTarget] = React.useState<string | null>(null);
  return (
    <div className="lg-tile overflow-hidden rounded-[20px]">
      <p className="flex items-center gap-2 px-3.5 pt-3 pb-1.5 text-[13px] font-medium text-muted-foreground">
        <Building2 className="size-4" aria-hidden />
        Organización
      </p>
      <ul>
        {memberships.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (m.id === current) return;
                haptic("selection");
                setTarget(m.id);
                startTransition(async () => {
                  await setCurrentOrg(m.id);
                  closeMore();
                  router.refresh();
                });
              }}
              className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-[15px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
              <span className="text-[12.5px] text-muted-foreground">{ROLE_META[m.role]?.label}</span>
              {pending && target === m.id ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              ) : m.id === current ? (
                <Check className="size-4 text-[oklch(0.5_0.09_152)]" aria-hidden />
              ) : (
                <span className="size-4" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InstallRow() {
  const { hidden } = useInstallApp();
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={() => void requestInstall()}
      className="lg-tile flex w-full items-center gap-3 rounded-[20px] px-3.5 py-3 text-left text-[15px] font-medium"
    >
      <MonitorDown className="size-[18px] text-muted-foreground" aria-hidden />
      <span className="flex-1">Instalar la app en este teléfono</span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </button>
  );
}

// ── Buscador ─────────────────────────────────────────────────────────────────

const HIT_ICON: Record<GlobalSearchHit["kind"], LucideIcon> = {
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

function MoreSearch({ ctx, query, onQuery }: { ctx: ShellContext; query: string; onQuery: (q: string) => void }) {
  const screens = React.useMemo(() => reachableScreens(ctx), [ctx]);
  // El resultado queda atado a la búsqueda que lo pidió: si cambia el texto, se
  // muestra "buscando" sin resetear nada en un efecto.
  const [result, setResult] = React.useState<{ q: string; hits: GlobalSearchHit[] } | null>(null);
  const q = query.trim();
  const hits = result && result.q === q ? result.hits : [];
  const loading = q.length >= 2 && result?.q !== q;

  const screenHits = React.useMemo(() => {
    const f = fold(q);
    if (f.length < 2) return [];
    return screens.filter((s) => fold(`${s.label} ${s.keywords ?? ""}`).includes(f)).slice(0, 5);
  }, [q, screens]);

  React.useEffect(() => {
    if (q.length < 2) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      const r = await searchEverything(q, { limit: 12 }).catch(() => null);
      if (alive) setResult({ q, hits: r && r.ok ? r.hits : [] });
    }, 260);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="space-y-2">
      <label className="lg-tile flex h-12 items-center gap-2.5 rounded-full px-4">
        <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Buscá una reserva, un huésped o una pantalla"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground"
          aria-label="Buscar"
        />
        {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : null}
        {query ? (
          <button type="button" onClick={() => onQuery("")} aria-label="Borrar" className="grid size-7 place-items-center rounded-full text-muted-foreground">
            <X className="size-4" />
          </button>
        ) : null}
      </label>

      {q.length >= 2 ? (
        <div className="lg-tile overflow-hidden rounded-[20px]">
          {screenHits.length === 0 && hits.length === 0 && !loading ? (
            <p className="px-4 py-5 text-center text-[14px] text-muted-foreground">No encontré nada con «{q}».</p>
          ) : null}
          <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {screenHits.map((s) => {
              const Icon = SCREEN_ICONS[s.icon];
              return (
                <li key={`s-${s.href}`}>
                  <Link href={s.href} className="flex items-center gap-3 px-3.5 py-3 active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[oklch(0.95_0.025_150)] text-[oklch(0.38_0.06_152)] dark:bg-white/10 dark:text-[oklch(0.86_0.08_150)]">
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{s.label}</span>
                      <span className="block text-[12.5px] text-muted-foreground">Pantalla</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
            {hits.map((h) => {
              const Icon = HIT_ICON[h.kind] ?? Receipt;
              return (
                <li key={`${h.kind}-${h.id}`}>
                  <Link href={h.href} className="flex items-center gap-3 px-3.5 py-3 active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-black/[0.04] text-foreground dark:bg-white/10">
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{h.title}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">
                        {HIT_LABEL[h.kind]}
                        {h.subtitle ? ` · ${h.subtitle}` : ""}
                      </span>
                    </span>
                    {h.meta ? <span className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">{h.meta}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
