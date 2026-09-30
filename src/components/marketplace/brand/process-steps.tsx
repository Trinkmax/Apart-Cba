import { CalendarHeart, KeyRound, MessageCircleHeart, WalletCards, Check, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineStep } from "@/lib/marketplace/guest-stage";

export interface ProcessStepsProps {
  /** Promesa de respuesta en horas (Configuración → Web y cobros). */
  responseHours: number;
  /** Texto de la seña: "1 noche", "30 %", o monto formateado ("$ 70.000"). null = sin seña. */
  senaLabel: string | null;
  /** Unidad con reserva inmediata: el paso 2 no espera confirmación. */
  instant?: boolean;
  /** vertical para columnas angostas (widget, checkout); horizontal para secciones. */
  layout?: "horizontal" | "vertical";
  className?: string;
}

/**
 * Cómo se reserva en apart, en cuatro pasos. Es el proceso real del equipo:
 * pedido sin pago → confirmación → seña por transferencia → resto al llegar.
 * Se usa en la home, la ficha, el checkout y "Cómo reservar".
 */
export function ProcessSteps({ responseHours, senaLabel, instant = false, layout = "horizontal", className }: ProcessStepsProps) {
  const hours = responseHours === 1 ? "1 hora" : `${responseHours} horas`;
  const steps = [
    {
      icon: CalendarHeart,
      title: instant ? "Reservás tus fechas" : "Pedís tus fechas",
      body: instant
        ? "Elegís el depto y reservás al instante. Todavía no pagás nada."
        : "Elegís el depto y nos mandás el pedido. Todavía no pagás nada.",
    },
    {
      icon: MessageCircleHeart,
      title: instant ? "Te escribimos" : "Te confirmamos",
      body: instant
        ? "Te escribimos por WhatsApp y mail con los datos de tu reserva."
        : `Revisamos la disponibilidad y te respondemos en menos de ${hours}, por WhatsApp y mail.`,
    },
    senaLabel
      ? {
          icon: WalletCards,
          title: `Señás ${senaLabel}`,
          body: instant
            ? "Transferís la seña para asegurar tus fechas. Los datos te aparecen en el link de tu reserva apenas reservás."
            : "Transferís la seña para asegurar tus fechas. Te pasamos los datos al confirmar.",
        }
      : {
          icon: WalletCards,
          title: "Sin seña",
          body: "No hace falta adelantar nada para asegurar tus fechas.",
        },
    {
      icon: KeyRound,
      title: "El resto, al llegar",
      body: "Pagás el saldo el día que te entregamos las llaves, en efectivo o por transferencia.",
    },
  ];

  if (layout === "vertical") {
    return (
      <ol className={cn("relative space-y-4", className)}>
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-3">
            {i < steps.length - 1 ? (
              <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-12px)] w-px bg-forest-700/15" />
            ) : null}
            <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-t-full rounded-b-md bg-leaf-200 text-forest-700">
              <s.icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-bold text-forest-700">{s.title}</p>
              <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-500">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5", className)}>
      {steps.map((s, i) => (
        <li key={s.title} className="relative">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-t-full rounded-b-lg bg-leaf-200 text-forest-700">
              <s.icon className="size-5" aria-hidden />
            </span>
            <span className="font-apart-serif text-3xl italic text-coral-500" aria-hidden>
              {i + 1}
            </span>
          </div>
          <p className="mt-4 text-lg font-extrabold tracking-[-0.01em] text-forest-700">{s.title}</p>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-500">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

const STATE_STYLES: Record<TimelineStep["state"], { dot: string; label: string }> = {
  done: { dot: "bg-forest-700 text-cream", label: "text-forest-700" },
  current: { dot: "bg-coral-500 text-white ring-4 ring-coral-500/20", label: "text-forest-700 font-bold" },
  // ink-500: 5.05:1 sobre cream-200 (el número) y 5.47:1 sobre crema (la etiqueta); ink-400 daba 2.9-3.1.
  upcoming: { dot: "bg-cream-200 text-ink-500 ring-1 ring-inset ring-cream-400", label: "text-ink-500" },
  failed: { dot: "bg-[#fdecea] text-[#b42318] ring-1 ring-inset ring-[#f6c8c3]", label: "text-[#b42318]" },
  skipped: { dot: "bg-cream-200 text-ink-300", label: "text-ink-300 line-through decoration-ink-300/60" },
};

/** Línea de tiempo del estado real de una reserva (página de seguimiento). */
export function StageTimeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={cn("grid grid-cols-4 gap-1", className)} aria-label="Estado de tu reserva">
      {steps.map((s, i) => {
        const st = STATE_STYLES[s.state];
        return (
          <li key={s.key} className="relative flex flex-col items-center text-center">
            {i > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2",
                  s.state === "done" || s.state === "current" ? "bg-forest-700" : "bg-cream-300",
                )}
              />
            ) : null}
            <span className={cn("relative z-10 flex size-8 items-center justify-center rounded-full text-xs font-bold", st.dot)}>
              {s.state === "done" ? (
                <Check className="size-4" aria-hidden />
              ) : s.state === "failed" ? (
                <X className="size-4" aria-hidden />
              ) : s.state === "skipped" ? (
                <Minus className="size-4" aria-hidden />
              ) : (
                i + 1
              )}
            </span>
            <span className={cn("mt-2 text-[0.75rem] leading-tight sm:text-xs", st.label)}>
              {s.label}
              <span className="sr-only">
                {s.state === "done"
                  ? " (listo)"
                  : s.state === "current"
                    ? " (en curso)"
                    : s.state === "failed"
                      ? " (no se concretó)"
                      : s.state === "skipped"
                        ? " (no aplica)"
                        : " (pendiente)"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
