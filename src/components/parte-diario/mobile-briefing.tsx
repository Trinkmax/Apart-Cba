"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLEANING_STATUS_META, TICKET_PRIORITY_META } from "@/lib/constants";
import { changeCleaningStatus } from "@/lib/actions/cleaning";
import { MobileProgressRing } from "./mobile-progress-ring";
import type {
  MobileParteDiarioPayload,
  ParteDiarioCleaningRow,
} from "@/lib/types/database";

interface MobileBriefingProps {
  payload: MobileParteDiarioPayload;
}

export function MobileBriefing({ payload }: MobileBriefingProps) {
  // Sincronización con server: si payload cambia (revalidatePath upstream),
  // reseteamos el estado optimista al snapshot fresco. setState en render es
  // el patrón canónico para "reset on prop change" — no en useEffect.
  const [renderedPayload, setRenderedPayload] = useState(payload);
  const [cleanings, setCleanings] = useState(payload.cleanings);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingTransition, startTransition] = useTransition();

  if (renderedPayload !== payload) {
    setRenderedPayload(payload);
    setCleanings(payload.cleanings);
  }

  const completed = cleanings.filter((c) => c.status === "completada").length;
  const total = cleanings.length;
  // Confetti se monta cuando todo está hecho — la animación CSS es one-shot,
  // unmount + remount al volver a tachar/destachar bastan como ciclo natural.
  const allDone = total > 0 && completed === total;

  const handleToggle = (row: ParteDiarioCleaningRow) => {
    if (!row.task_id) return;
    const next = row.status === "completada" ? "en_progreso" : "completada";
    setPendingId(row.task_id);
    startTransition(async () => {
      try {
        await changeCleaningStatus(row.task_id as string, next);
        setCleanings((prev) =>
          prev.map((c) => (c.task_id === row.task_id ? { ...c, status: next } : c)),
        );
        if (next === "completada") {
          toast.success("Tarea completada");
        }
      } catch (err) {
        toast.error("No se pudo actualizar", { description: (err as Error).message });
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <div className="space-y-5 pb-6">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-cyan-500/10 via-cyan-500/5 to-emerald-500/10 p-5">
        {allDone ? <ConfettiBurst /> : null}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {payload.date_label}
            </p>
            <h1 className="text-xl font-semibold mt-0.5 truncate">Hola, {payload.greeting_name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {total === 0
                ? "No tenés tareas asignadas hoy."
                : allDone
                  ? "Terminaste todo. Buen turno."
                  : `Tu día: ${total} ${total === 1 ? "limpieza" : "limpiezas"}`}
            </p>
          </div>
          {total > 0 ? (
            <MobileProgressRing completed={completed} total={total} />
          ) : (
            <Sparkles className="size-12 text-cyan-500/60" />
          )}
        </div>
      </header>

      {/* Limpiezas */}
      {cleanings.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Sparkles className="size-4 text-cyan-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Limpiezas</h2>
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {completed}/{total}
            </span>
          </div>
          <ul className="space-y-2">
            {cleanings.map((row) => (
              <CleaningCard
                key={row.task_id ?? row.unit_id}
                row={row}
                pending={pendingId === row.task_id || pendingTransition}
                onToggle={() => handleToggle(row)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* Mantenimiento asignado */}
      {payload.maintenance.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Wrench className="size-4 text-amber-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Mantenimiento</h2>
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {payload.maintenance.length}
            </span>
          </div>
          <ul className="space-y-2">
            {payload.maintenance.map((m) => (
              <li
                key={m.ticket_id}
                className="rounded-2xl border bg-card p-4 active:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">{m.unit_code}</span>
                  <span
                    className="ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-current/30"
                    style={{
                      color: TICKET_PRIORITY_META[m.priority].color,
                      backgroundColor: TICKET_PRIORITY_META[m.priority].color + "1a",
                    }}
                  >
                    {TICKET_PRIORITY_META[m.priority].label}
                  </span>
                </div>
                <p className="text-sm font-medium mt-1.5">{m.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{m.unit_name}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cleanings.length === 0 && payload.maintenance.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
          <Sparkles className="size-8 mx-auto text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            Hoy no tenés tareas asignadas. Disfrutá el día.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CleaningCard({
  row,
  pending,
  onToggle,
}: {
  row: ParteDiarioCleaningRow;
  pending: boolean;
  onToggle: () => void;
}) {
  const done = row.status === "completada";
  return (
    <li>
      <button
        onClick={onToggle}
        disabled={pending || row.task_id === null}
        className={cn(
          "w-full rounded-2xl border bg-card p-4 text-left flex items-center gap-3 transition-colors",
          done && "bg-emerald-500/5 border-emerald-500/20",
          !done && "active:bg-muted/30",
        )}
      >
        <span
          className={cn(
            "shrink-0 size-8 rounded-full border-2 flex items-center justify-center transition-colors",
            done
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "border-muted-foreground/30 text-transparent",
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : done ? (
            <Check className="size-4" strokeWidth={3} />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold tabular-nums">{row.unit_code}</span>
            <span className={cn("text-sm truncate", done && "line-through text-muted-foreground")}>
              {row.unit_name}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {row.guest_name && row.check_out_time
              ? `Sale ${row.guest_name} · ${row.check_out_time.slice(0, 5)}`
              : row.guest_name
                ? `Sale ${row.guest_name}`
                : row.check_out_time
                  ? `Check-out ${row.check_out_time.slice(0, 5)}`
                  : row.status
                    ? CLEANING_STATUS_META[row.status].label
                    : ""}
          </p>
        </div>
      </button>
    </li>
  );
}

function ConfettiBurst() {
  // Particles CSS-only generadas con N divs absolutos. Sin JS de animación.
  const particles = Array.from({ length: 14 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((_, i) => {
        const angle = (i / particles.length) * 360;
        const distance = 60 + ((i * 7) % 30);
        const colors = ["bg-emerald-400", "bg-cyan-400", "bg-amber-400", "bg-rose-400"];
        const color = colors[i % colors.length];
        const delay = (i % 5) * 60;
        return (
          <span
            key={i}
            className={cn(
              "absolute left-1/2 top-1/2 size-1.5 rounded-full opacity-0",
              color,
              "animate-[parteConfetti_900ms_ease-out_forwards]",
            )}
            style={{
              transform: `rotate(${angle}deg)`,
              ["--burst-distance" as string]: `${distance}px`,
              animationDelay: `${delay}ms`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes parteConfetti {
          0% { opacity: 0; transform: translate(-50%, -50%) rotate(0deg) translateY(0); }
          20% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -50%) translateY(calc(-1 * var(--burst-distance))) rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
