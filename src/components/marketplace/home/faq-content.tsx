import Link from "next/link";
import { depositRuleLabel } from "@/lib/marketplace/sena";
import { hoursLabel, type ResolvedWebSettings } from "@/lib/marketplace/web-settings";
import type { FaqItem } from "./faq-list";

/**
 * Los datos reales del proceso (Configuración → Web y cobros) con los que se
 * arman los textos de la home y de "Cómo reservar". Una sola fuente para que
 * la seña, los plazos y la promesa de respuesta digan lo mismo en todos lados.
 */
export interface ProcessFacts {
  responseHours: number;
  /** "1 noche" · "30 %" · null (sin seña). */
  senaLabel: string | null;
  /** Descripción larga de la seña; null sin seña. */
  senaDetail: string | null;
  /** "24 horas", "2 días". */
  dueLabel: string;
  whatsappUrl: string | null;
}

export function processFacts(settings: ResolvedWebSettings, whatsappUrl: string | null): ProcessFacts {
  const { deposit } = settings;
  const senaLabel = depositRuleLabel(deposit);
  let senaDetail: string | null = null;
  if (senaLabel && deposit.rule === "percent") senaDetail = `el ${senaLabel} del total de tu estadía`;
  else if (senaLabel) senaDetail = "el valor de una noche de tu estadía (sin la limpieza)";
  return {
    responseHours: settings.responseHours,
    senaLabel,
    senaDetail,
    dueLabel: hoursLabel(deposit.dueHours),
    whatsappUrl,
  };
}

/** Horas de vencimiento de un pedido sin respuesta (booking_requests.expires_at: 48 h). */
export const REQUEST_EXPIRY_HOURS = 48;

/** Las cuatro preguntas de la home. */
export function homeFaqItems(f: ProcessFacts): FaqItem[] {
  return [
    {
      q: "¿Pago algo al pedir?",
      a: (
        <p>
          No. Pedir tus fechas no tiene costo y no te pedimos tarjeta. Te confirmamos en menos de{" "}
          {hoursLabel(f.responseHours)}, por WhatsApp y mail, y recién ahí se habla de pagos.
        </p>
      ),
    },
    {
      q: "¿Cuánto es la seña y cómo la pago?",
      a: f.senaDetail ? (
        <>
          <p>
            La seña es {f.senaDetail}. Se paga por transferencia cuando te confirmamos: te pasamos los datos por
            mail y WhatsApp, y tenés {f.dueLabel} para hacerla.
          </p>
          <p>El resto lo pagás el día que llegás, en efectivo o por transferencia. No cobramos nada online.</p>
        </>
      ) : (
        <p>
          No pedimos seña: una vez confirmada tu reserva, pagás la estadía el día que llegás, en efectivo o por
          transferencia. No cobramos nada online.
        </p>
      ),
    },
    {
      q: "¿Qué pasa si no me confirman?",
      a: (
        <p>
          Si esas fechas no están disponibles te avisamos, y como no pagaste nada, no hay nada que
          devolver. Si por algún motivo no te respondimos, el pedido vence solo a las {REQUEST_EXPIRY_HOURS} horas:
          no tenés que cancelar nada.
        </p>
      ),
    },
    {
      q: "¿Cómo es la llegada?",
      a: (
        <p>
          Uno o dos días antes te escribimos para coordinar la entrega de las llaves. El horario de check-in está en
          la ficha de cada departamento. Ese día pagás el saldo y listo: este lugar es tuyo por unos días.{" "}
          <Link href="/como-reservar#llegada">Más sobre la llegada</Link>
        </p>
      ),
    },
  ];
}

/** Preguntas de "Cómo reservar": las de la home que no tienen sección propia, más las del pedido. */
export function howToFaqItems(f: ProcessFacts): FaqItem[] {
  const [pagoAlPedir, , sinConfirmar] = homeFaqItems(f);
  return [
    {
      q: "¿Necesito crear una cuenta?",
      a: (
        <p>
          No. Pedís con tu nombre, tu email y tu WhatsApp. Si tenés cuenta, tus datos se completan solos y ves todas
          tus reservas juntas en <Link href="/mi-cuenta">Mis reservas</Link>.
        </p>
      ),
    },
    pagoAlPedir,
    {
      q: "¿Cómo sigo mi pedido?",
      a: (
        <p>
          Al enviarlo te damos un link personal, que también te llega por mail. Ahí ves en qué etapa está, los datos
          para la seña cuando te confirmamos y, cuando transfieras, nos avisás desde ahí mismo.
        </p>
      ),
    },
    sinConfirmar,
    {
      q: "¿La limpieza se cobra aparte?",
      a: (
        <p>
          Si el departamento tiene costo de limpieza, lo ves separado en el detalle del precio, antes de enviar el
          pedido.
        </p>
      ),
    },
  ];
}
