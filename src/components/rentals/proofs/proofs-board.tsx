"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Globe, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Money, StatusBadge } from "@/components/rentals/ui";
import { formatTimeAgo } from "@/lib/format";
import { formatContractNumber, monthLabelOf, PROOF_STATUS_META } from "@/lib/rentals/labels";
import { getProofFileUrl } from "@/lib/actions/rentals-proofs";
import type { RentalProofStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { FileViewer } from "./file-viewer";
import { KindChip, kindLabel } from "./proof-kind-icon";
import { formatFileSize } from "./proof-helpers";
import { Kbd, ProofReviewPanel } from "./proof-review-panel";
import type { ProofItem, ProofsBoardData } from "./proof-types";
import { MissingProofsList } from "./missing-proofs-list";
import { PaymentReportsList } from "./payment-reports-list";

/**
 * Pantalla Comprobantes: cuatro bandejas (Por revisar · Faltan · Avisos de
 * pago · Revisados). "Por revisar" es una bandeja de entrada: en escritorio,
 * lista a la izquierda y visor a la derecha con atajos (A valida, R rechaza,
 * ↑ ↓ se mueve) y avance automático al siguiente; en el celular, lista y el
 * detalle en una hoja.
 */

export type ProofsTab = "revisar" | "faltan" | "avisos" | "revisados";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

function TabButton({
  active,
  onClick,
  children,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  tone?: "blue" | "amber" | "neutral";
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {!!count && (
        <span
          className={cn(
            "inline-flex min-w-5 justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
            tone === "blue" && "bg-blue-500/15 text-blue-700 dark:text-blue-300",
            tone === "amber" && "bg-amber-500/15 text-amber-800 dark:text-amber-200",
            (!tone || tone === "neutral") && "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ProofRow({ p, selected, onSelect, showStatus }: { p: ProofItem; selected: boolean; onSelect: () => void; showStatus?: boolean }) {
  return (
    <button
      id={`proof-row-${p.id}`}
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex w-full items-start gap-3 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:bg-accent/50 sm:px-4",
        selected ? "bg-primary/5" : "hover:bg-accent/40",
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
      <KindChip kind={p.kind} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{p.tenantName ?? "Inquilino"}</span>
          {p.amount != null && <Money amount={p.amount} currency={p.proofCurrency || p.currency} className="shrink-0 text-sm font-semibold" />}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{p.address}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {kindLabel(p.kind)} · {monthLabelOf(p.period)}
          </span>
          {showStatus ? (
            <StatusBadge meta={PROOF_STATUS_META[p.status]} compact />
          ) : (
            <>
              {p.uploadedAt && <span suppressHydrationWarning>{formatTimeAgo(p.uploadedAt)}</span>}
              {p.uploadedVia === "portal" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-px text-sky-700 dark:text-sky-300">
                  <Globe size={10} /> desde el portal
                </span>
              )}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/** Encabezado + visor + panel de revisión de UN comprobante (panel derecho o hoja). */
function ProofDetail({
  p,
  shortcuts,
  onDecided,
  onReopened,
  layout,
}: {
  p: ProofItem;
  shortcuts: boolean;
  onDecided: (id: string, status: RentalProofStatus) => void;
  onReopened: (id: string) => void;
  layout: "wide" | "stacked";
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <KindChip kind={p.kind} size="lg" />
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight">
              {kindLabel(p.kind)} · {monthLabelOf(p.period)}
            </p>
            <Link
              href={`/dashboard/alquileres/contratos/${p.contractId}`}
              className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">
                {p.tenantName ?? "Inquilino"} · {p.address}
              </span>
              <span className="shrink-0 font-mono text-[10px]">{formatContractNumber(p.contractNumber)}</span>
            </Link>
            <p className="mt-0.5 text-[11px] text-muted-foreground" suppressHydrationWarning>
              {p.uploadedVia === "portal" ? "Lo subió el inquilino desde su link" : p.uploadedVia === "staff" ? "Lo cargó alguien del equipo" : "Sin archivo"}
              {p.uploadedAt ? ` · ${formatTimeAgo(p.uploadedAt)}` : ""}
              {p.fileSize ? ` · ${formatFileSize(p.fileSize)}` : ""}
            </p>
          </div>
        </div>
        {p.status !== "en_revision" && <StatusBadge meta={PROOF_STATUS_META[p.status]} />}
      </div>
      <div className={cn(layout === "wide" ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start" : "space-y-3")}>
        {p.hasFile ? (
          <FileViewer
            cacheKey={`proof:${p.id}`}
            mime={p.fileMime}
            load={() => getProofFileUrl(p.id)}
            minHeightClass={layout === "wide" ? "min-h-[60vh]" : "min-h-[45vh]"}
          />
        ) : (
          <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
            Este comprobante no tiene archivo.
          </div>
        )}
        <div className="space-y-2">
          <ProofReviewPanel key={p.id} proof={p} shortcuts={shortcuts} onDecided={onDecided} onReopened={onReopened} />
          {shortcuts && p.status === "en_revision" && (
            <p className="hidden flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
              Atajos: <Kbd>A</Kbd> validar · <Kbd>R</Kbd> rechazar · <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> moverte
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyQueue({ missing, onSeeMissing }: { missing: number; onSeeMissing: () => void }) {
  return (
    <Card className="items-center gap-3 border-dashed p-8 text-center sm:p-12">
      <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={24} />
      </div>
      <div>
        <p className="text-base font-semibold">Estás al día: no hay comprobantes para revisar</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Cuando un inquilino suba una expensa o un servicio desde su link, aparece acá para que lo valides.
        </p>
      </div>
      {missing > 0 && (
        <Button variant="outline" size="sm" onClick={onSeeMissing}>
          Ver lo que falta este mes ({missing})
        </Button>
      )}
    </Card>
  );
}

type ReviewedFilter = "todos" | "validado" | "rechazado" | "no_corresponde";

export function ProofsBoard({ data, initialTab }: { data: ProofsBoardData; initialTab: ProofsTab }) {
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<ProofsTab>(initialTab);
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reviewedOpen, setReviewedOpen] = useState<ProofItem | null>(null);
  const [reviewedFilter, setReviewedFilter] = useState<ReviewedFilter>("todos");

  const queue = data.review.filter((p) => !decided.has(p.id));
  const selected = queue.find((p) => p.id === selectedId) ?? (isDesktop ? queue[0] ?? null : null);
  const selectedIndex = selected ? queue.findIndex((p) => p.id === selected.id) : -1;
  const pendingReports = data.reports.filter((r) => r.status === "pendiente").length;
  const reviewed = data.reviewed.filter((p) => reviewedFilter === "todos" || p.status === reviewedFilter);

  function changeTab(next: ProofsTab) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // sin URL compartible: no pasa nada
    }
  }

  function select(id: string) {
    setSelectedId(id);
    if (!isDesktop) setSheetOpen(true);
  }

  function move(delta: number) {
    if (!queue.length) return;
    const from = selectedIndex < 0 ? (delta > 0 ? -1 : queue.length) : selectedIndex;
    const next = queue[Math.min(queue.length - 1, Math.max(0, from + delta))];
    if (!next) return;
    setSelectedId(next.id);
    requestAnimationFrame(() => document.getElementById(`proof-row-${next.id}`)?.scrollIntoView({ block: "nearest" }));
  }

  function handleDecided(id: string) {
    const idx = queue.findIndex((p) => p.id === id);
    const next = queue[idx + 1] ?? queue[idx - 1] ?? null;
    setDecided((s) => new Set(s).add(id));
    setSelectedId(next?.id ?? null);
    if (!next) setSheetOpen(false);
  }

  function handleReopened(id: string) {
    setDecided((s) => {
      const nextSet = new Set(s);
      nextSet.delete(id);
      return nextSet;
    });
    setSelectedId(id);
    setReviewedOpen(null);
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (tab !== "revisar" || !isDesktop || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    if (document.querySelector("[role='dialog']")) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      move(-1);
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Bandejas de comprobantes" className="-mx-1 flex overflow-x-auto border-b px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabButton active={tab === "revisar"} onClick={() => changeTab("revisar")} count={queue.length} tone="blue">
          Por revisar
        </TabButton>
        <TabButton active={tab === "faltan"} onClick={() => changeTab("faltan")} count={data.kpi.missingCount} tone="amber">
          Faltan de {monthLabelOf(data.month).split(" ")[0].toLowerCase()}
        </TabButton>
        <TabButton active={tab === "avisos"} onClick={() => changeTab("avisos")} count={pendingReports} tone="blue">
          Avisos de pago
        </TabButton>
        <TabButton active={tab === "revisados"} onClick={() => changeTab("revisados")}>
          Revisados
        </TabButton>
      </div>

      {tab === "revisar" &&
        (queue.length === 0 ? (
          <EmptyQueue missing={data.kpi.missingCount} onSeeMissing={() => changeTab("faltan")} />
        ) : isDesktop ? (
          <div className="grid grid-cols-[minmax(0,22rem)_minmax(0,1fr)] items-start gap-4">
            <Card className="max-h-[calc(100dvh-15rem)] gap-0 divide-y overflow-y-auto p-0">
              {queue.map((p) => (
                <ProofRow key={p.id} p={p} selected={p.id === selected?.id} onSelect={() => select(p.id)} />
              ))}
            </Card>
            <Card className="sticky top-4 gap-0 p-4 animate-fade-in">
              {selected && (
                <ProofDetail p={selected} shortcuts layout="wide" onDecided={handleDecided} onReopened={handleReopened} />
              )}
            </Card>
          </div>
        ) : (
          <Card className="gap-0 divide-y overflow-hidden p-0">
            {queue.map((p) => (
              <ProofRow key={p.id} p={p} selected={false} onSelect={() => select(p.id)} />
            ))}
          </Card>
        ))}

      {tab === "faltan" && <MissingProofsList items={data.missing} month={data.month} />}
      {tab === "avisos" && <PaymentReportsList items={data.reports} />}

      {tab === "revisados" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(["todos", "validado", "rechazado", "no_corresponde"] as ReviewedFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={reviewedFilter === f}
                onClick={() => setReviewedFilter(f)}
                className={cn(
                  "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                  reviewedFilter === f ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {f === "todos" ? "Todos" : PROOF_STATUS_META[f].label}
              </button>
            ))}
          </div>
          {reviewed.length === 0 ? (
            <Card className="items-center gap-2 border-dashed p-8 text-center text-sm text-muted-foreground">
              <Inbox size={22} className="text-muted-foreground/60" />
              Nada revisado en los últimos 60 días{reviewedFilter !== "todos" ? " con ese estado" : ""}.
            </Card>
          ) : (
            <Card className="gap-0 divide-y overflow-hidden p-0">
              {reviewed.map((p) => (
                <ProofRow key={p.id} p={p} selected={false} showStatus onSelect={() => setReviewedOpen(p)} />
              ))}
            </Card>
          )}
        </div>
      )}

      <Sheet open={sheetOpen && !isDesktop && !!selected} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:w-[36rem] sm:max-w-xl">
          <SheetHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-3">
            <div className="min-w-0">
              <SheetTitle className="text-sm">Comprobante para revisar</SheetTitle>
              <SheetDescription className="text-xs">
                {selectedIndex + 1} de {queue.length}
              </SheetDescription>
            </div>
            <div className="mr-8 flex items-center gap-1">
              <Button size="icon-sm" variant="outline" aria-label="Anterior" disabled={selectedIndex <= 0} onClick={() => move(-1)}>
                <ChevronLeft size={16} />
              </Button>
              <Button size="icon-sm" variant="outline" aria-label="Siguiente" disabled={selectedIndex >= queue.length - 1} onClick={() => move(1)}>
                <ChevronRight size={16} />
              </Button>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {selected && <ProofDetail p={selected} shortcuts={false} layout="stacked" onDecided={handleDecided} onReopened={handleReopened} />}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!reviewedOpen} onOpenChange={(o) => !o && setReviewedOpen(null)}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:w-[40rem] sm:max-w-2xl">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm">Comprobante revisado</SheetTitle>
            <SheetDescription className="text-xs">Si te equivocaste, volvelo a la cola con «Volver a revisar».</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {reviewedOpen && <ProofDetail p={reviewedOpen} shortcuts={false} layout="stacked" onDecided={() => setReviewedOpen(null)} onReopened={handleReopened} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
