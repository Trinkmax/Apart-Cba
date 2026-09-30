import type { BookingRequestStatus, BookingStatus } from "@/lib/types/database";
import { isSenaCovered } from "./sena";

/**
 * En qué punto está la reserva de un huésped de la web, visto desde el
 * huésped. No es un estado nuevo en la base: se DERIVA de la solicitud, la
 * reserva, lo cobrado y los avisos de pago. Así la página de seguimiento, la
 * lista de "Mis reservas" y los emails dicen lo mismo.
 *
 *   pedido_enviado ─┬─► sena_pendiente ─► sena_informada ─► reserva_asegurada ─► estadia_en_curso ─► estadia_finalizada
 *                   ├─► pedido_rechazado
 *                   ├─► pedido_vencido
 *                   └─► pedido_cancelado
 *   (cualquier reserva) ─► reserva_cancelada
 */
export type GuestStage =
  | "pedido_enviado"
  | "pedido_vencido"
  | "pedido_rechazado"
  | "pedido_cancelado"
  | "sena_pendiente"
  | "sena_informada"
  | "reserva_asegurada"
  | "estadia_en_curso"
  | "estadia_finalizada"
  | "reserva_cancelada";

export interface GuestStageInput {
  request?: { status: BookingRequestStatus; expires_at: string } | null;
  booking?: { status: BookingStatus; paid_amount: number | null } | null;
  /** Seña vigente (resolveBookingSena). null/0 = no se pide seña. */
  sena: number | null;
  /** Hay un aviso de pago del huésped esperando que el equipo lo mire. */
  hasPendingPaymentReport: boolean;
  /**
   * Fechas de la estadía (YYYY-MM-DD). El PMS no avanza los estados solo (una
   * reserva puede seguir "confirmada" o "check_in" después de irse el
   * huésped), así que las fechas mandan: pasada la salida la estadía terminó y
   * desde la llegada ya no se pide seña ni se pueden avisar pagos.
   */
  stay?: { checkIn: string; checkOut: string } | null;
  now?: Date;
}

/** "Hoy" en Argentina (UTC-3, sin DST) a partir de un instante. */
function todayAR(now: Date): string {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function deriveGuestStage(input: GuestStageInput): GuestStage {
  const now = input.now ?? new Date();
  const booking = input.booking ?? null;
  const today = todayAR(now);
  const stay = input.stay ?? null;

  if (booking) {
    switch (booking.status) {
      case "cancelada":
      case "no_show":
        return "reserva_cancelada";
      case "check_out":
        return "estadia_finalizada";
    }
    // Activa (pendiente / confirmada / check_in): las fechas mandan.
    // El día de salida todavía es "en curso"; desde el día siguiente, terminó.
    if (stay && today > stay.checkOut) return "estadia_finalizada";
    if (booking.status === "check_in") return "estadia_en_curso";
    if (stay && today >= stay.checkIn) return "estadia_en_curso";
    switch (booking.status) {
      case "confirmada":
      case "pendiente":
      default:
        if (!isSenaCovered(booking.paid_amount, input.sena)) {
          return input.hasPendingPaymentReport ? "sena_informada" : "sena_pendiente";
        }
        return "reserva_asegurada";
    }
  }

  const request = input.request ?? null;
  if (!request) return "reserva_cancelada";
  switch (request.status) {
    case "pendiente":
      // Vencido por plazo o porque la llegada ya pasó sin confirmación.
      if (Date.parse(request.expires_at) <= now.getTime()) return "pedido_vencido";
      if (stay && today >= stay.checkIn) return "pedido_vencido";
      return "pedido_enviado";
    case "expirada":
      return "pedido_vencido";
    case "rechazada":
      return "pedido_rechazado";
    case "cancelada":
      return "pedido_cancelado";
    case "aprobada":
    default:
      // Aprobada pero sin reserva a la vista: la reserva se borró o se anuló.
      return "reserva_cancelada";
  }
}

export type StageTone = "info" | "action" | "ok" | "muted" | "error";

export interface StageCopy {
  /** Titular corto, en la voz de la marca. */
  title: string;
  /** Una o dos frases: qué pasa ahora y qué tiene que hacer el huésped. */
  body: string;
  /** Etiqueta para la pastilla de estado en listas. */
  pill: string;
  tone: StageTone;
}

export const STAGE_COPY: Record<GuestStage, StageCopy> = {
  pedido_enviado: {
    title: "Recibimos tu pedido",
    body: "Estamos revisando la disponibilidad y te respondemos por WhatsApp y por mail. Todavía no pagás nada.",
    pill: "Esperando confirmación",
    tone: "info",
  },
  pedido_vencido: {
    title: "Tu pedido venció sin respuesta",
    body: "Perdón, no llegamos a confirmarte a tiempo. Escribinos y lo resolvemos, o probá con otras fechas.",
    pill: "Vencido",
    tone: "muted",
  },
  pedido_rechazado: {
    title: "No pudimos confirmar tu pedido",
    body: "Esas fechas no están disponibles. Probá con otras o escribinos y te ayudamos a encontrar lugar.",
    pill: "No disponible",
    tone: "error",
  },
  pedido_cancelado: {
    title: "Cancelaste tu pedido",
    body: "No quedó nada pendiente. Cuando quieras, armás uno nuevo.",
    pill: "Cancelado",
    tone: "muted",
  },
  sena_pendiente: {
    title: "¡Confirmado! Falta la seña",
    body: "Para asegurar tus fechas, transferí la seña. El resto lo pagás al llegar.",
    pill: "Falta la seña",
    tone: "action",
  },
  sena_informada: {
    title: "Recibimos tu aviso de pago",
    body: "Estamos verificando la transferencia. Te avisamos apenas la veamos acreditada.",
    pill: "Verificando pago",
    tone: "info",
  },
  reserva_asegurada: {
    title: "Todo listo. Dale, pasá.",
    body: "Tu reserva está asegurada. Uno o dos días antes de tu llegada te escribimos para coordinar la entrega de llaves.",
    pill: "Asegurada",
    tone: "ok",
  },
  estadia_en_curso: {
    title: "¡Qué lindo tenerte por Córdoba!",
    body: "Si necesitás algo durante tu estadía, escribinos. Estamos para ayudarte.",
    pill: "En curso",
    tone: "ok",
  },
  estadia_finalizada: {
    title: "Gracias por quedarte con nosotros",
    body: "Buenas estancias, mejores historias. Te esperamos la próxima.",
    pill: "Finalizada",
    tone: "muted",
  },
  reserva_cancelada: {
    title: "Esta reserva no está activa",
    body: "Si tenés dudas o querés volver a reservar, escribinos.",
    pill: "Cancelada",
    tone: "muted",
  },
};

export type TimelineStepKey = "pedido" | "confirmacion" | "sena" | "llegada";
export type TimelineStepState = "done" | "current" | "upcoming" | "failed" | "skipped";

export interface TimelineStep {
  key: TimelineStepKey;
  label: string;
  state: TimelineStepState;
}

const STEP_LABELS: Record<TimelineStepKey, string> = {
  pedido: "Pedido",
  confirmacion: "Confirmación",
  sena: "Seña",
  llegada: "Llegada",
};

/**
 * Los cuatro pasos del proceso (Pedido → Confirmación → Seña → Llegada) con su
 * estado para una etapa dada. `senaRequired = false` saltea el paso de la seña.
 */
export function stageTimeline(stage: GuestStage, senaRequired: boolean): TimelineStep[] {
  const s = (pedido: TimelineStepState, confirmacion: TimelineStepState, sena: TimelineStepState, llegada: TimelineStepState) => {
    const senaState: TimelineStepState = !senaRequired && sena !== "failed" ? "skipped" : sena;
    return [
      { key: "pedido" as const, label: STEP_LABELS.pedido, state: pedido },
      { key: "confirmacion" as const, label: STEP_LABELS.confirmacion, state: confirmacion },
      { key: "sena" as const, label: STEP_LABELS.sena, state: senaState },
      { key: "llegada" as const, label: STEP_LABELS.llegada, state: llegada },
    ];
  };
  switch (stage) {
    case "pedido_enviado":
      return s("done", "current", "upcoming", "upcoming");
    case "pedido_vencido":
    case "pedido_rechazado":
    case "pedido_cancelado":
      return s("done", "failed", "skipped", "skipped");
    case "sena_pendiente":
    case "sena_informada":
      return s("done", "done", "current", "upcoming");
    case "reserva_asegurada":
      return s("done", "done", "done", "current");
    case "estadia_en_curso":
    case "estadia_finalizada":
      return s("done", "done", "done", "done");
    case "reserva_cancelada":
    default:
      return s("done", "done", "skipped", "failed");
  }
}

/** Etapas en las que la reserva sigue viva (para ordenar y para "Próximas"). */
export function isActiveStage(stage: GuestStage): boolean {
  return (
    stage === "pedido_enviado" ||
    stage === "sena_pendiente" ||
    stage === "sena_informada" ||
    stage === "reserva_asegurada" ||
    stage === "estadia_en_curso"
  );
}

/** Etapas en las que el huésped puede transferir / avisar la seña. */
export function canReportPayment(stage: GuestStage): boolean {
  return stage === "sena_pendiente" || stage === "sena_informada";
}
