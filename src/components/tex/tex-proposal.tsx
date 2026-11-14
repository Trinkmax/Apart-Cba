"use client";

import Link from "next/link";
import { AlertTriangle, Check, ChevronRight, Clock, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProposalView } from "@/lib/tex/types";
import { isInternalHref } from "@/lib/tex/format";
import { TexAvatar } from "./tex-avatar";

/**
 * La tarjeta de confirmación (nov-2026): lo que Tex dejó listo, con el resumen
 * EXACTO armado por código (no por el modelo). Nada se escribe hasta tocar el
 * botón. Al ejecutarse, Tex festeja (trofeo + papelitos pixel).
 */
export function TexProposal({
  action,
  disabled,
  onConfirm,
  onCancel,
  onNavigate,
}: {
  action: ProposalView;
  /** Mientras Tex todavía escribe, no se confirma (la historia tiene que cerrar primero). */
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onNavigate?: () => void;
}) {
  const { summary, status } = action;
  const done = status === "executed";
  const failed = status === "failed";
  const closed = status === "cancelled" || status === "expired";

  return (
    <section
      className={cn(
        "tex-msg-in relative overflow-hidden rounded-[22px] border-2 bg-card shadow-[0_10px_30px_-16px_rgba(22,46,36,0.45)]",
        done
          ? "border-emerald-500/50"
          : failed
            ? "border-red-500/40"
            : closed
              ? "border-black/[0.06] opacity-70 dark:border-white/[0.08]"
              : "border-[oklch(0.62_0.08_152)]",
      )}
    >
      {done ? <PixelConfetti /> : null}
      <header className="flex items-center gap-2.5 px-4 pt-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#dcefff] dark:bg-[#123250]">
          <TexAvatar mood={done ? "happy" : "idle"} className="size-8" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
            {done ? "Listo" : failed ? "No se pudo" : closed ? (status === "expired" ? "Venció" : "Descartado") : "Para confirmar"}
          </p>
          <h4 className="truncate text-[15.5px] leading-snug font-semibold tracking-tight">{summary.title}</h4>
        </div>
      </header>

      <dl className="mx-4 mt-3 divide-y divide-black/[0.05] rounded-2xl bg-black/[0.025] dark:divide-white/[0.06] dark:bg-white/[0.04]">
        {summary.lines.map((l, i) => (
          <div key={i} className="flex items-start justify-between gap-3 px-3 py-2">
            <dt className="shrink-0 text-[13px] text-muted-foreground">{l.label}</dt>
            <dd className="min-w-0 text-right text-[13.5px] font-medium break-words">{l.value}</dd>
          </div>
        ))}
      </dl>

      {summary.note && !done ? (
        <p className="mx-4 mt-2.5 flex gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[12.5px] leading-snug text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {summary.note}
        </p>
      ) : null}

      <div className="p-4 pt-3">
        {status === "pending" || status === "executing" ? (
          <div className="grid grid-cols-[1fr_1.6fr] gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={status === "executing"}
              className="h-11 rounded-full bg-black/[0.05] text-[14.5px] font-medium active:scale-[0.98] disabled:opacity-50 dark:bg-white/10"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={disabled || status === "executing"}
              className={cn(
                "flex h-11 items-center justify-center gap-2 rounded-full text-[14.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_18px_-10px_rgba(22,46,36,0.6)] active:scale-[0.98] disabled:opacity-60",
                summary.danger ? "bg-red-600" : "bg-[oklch(0.5_0.09_152)]",
              )}
            >
              {status === "executing" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              {status === "executing" ? "Haciéndolo…" : summary.confirmLabel}
            </button>
          </div>
        ) : done ? (
          <div className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2.5">
            <Check className="size-4 shrink-0 text-emerald-600" aria-hidden />
            <p className="min-w-0 flex-1 text-[13.5px] font-medium text-emerald-800 dark:text-emerald-200">
              {action.result?.message ?? "Hecho."}
            </p>
            {isInternalHref(action.result?.href) ? (
              <Link
                href={action.result.href}
                onClick={onNavigate}
                className="flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300"
              >
                Ver <ChevronRight className="size-4" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : failed ? (
          <p className="flex gap-2 rounded-2xl bg-red-500/10 px-3 py-2.5 text-[13.5px] text-red-800 dark:text-red-200">
            <X className="mt-0.5 size-4 shrink-0" aria-hidden />
            {action.error ?? "No se pudo."}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Clock className="size-4" aria-hidden />
            {status === "expired" ? "Pasaron 15 minutos: pedile a Tex que la arme de nuevo." : "No se hizo nada."}
          </p>
        )}
      </div>
    </section>
  );
}

/** Papelitos pixel cuando una acción sale bien (sólo CSS, una vez). */
function PixelConfetti() {
  const bits = [
    ["#3aa0f0", "-60px", "-70px", "8deg"],
    ["#7ed957", "50px", "-80px", "-12deg"],
    ["#ed7059", "-30px", "-95px", "20deg"],
    ["#ffd25e", "75px", "-55px", "-25deg"],
    ["#6bb9f4", "-85px", "-40px", "35deg"],
    ["#7ed957", "15px", "-105px", "-5deg"],
    ["#ffd25e", "-10px", "-60px", "45deg"],
    ["#ed7059", "95px", "-90px", "10deg"],
  ];
  return (
    <span aria-hidden className="pointer-events-none absolute top-10 left-1/2 z-10">
      {bits.map(([c, x, y, r], i) => (
        <span
          key={i}
          className="tex-confetti absolute block size-[7px]"
          style={{ background: c, ["--x" as string]: x, ["--y" as string]: y, ["--r" as string]: r, animationDelay: `${i * 18}ms` }}
        />
      ))}
    </span>
  );
}
