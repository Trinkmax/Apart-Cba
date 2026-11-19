/**
 * `estado_canales`: cómo está la conexión de un departamento con Airbnb y
 * Booking, dicho en frases (src/lib/channels/link-status-summary.ts).
 *
 * Existe por una pregunta que Tex no podía contestar: «lo cargué acá y en
 * Airbnb sigue disponible» (Apart CBA, 19/11/2026) y «¿por qué figura cerrado
 * en las OTAs?» (Viaggiato, 18/11/2026). La respuesta casi siempre es que la
 * OTA todavía no vino a leer el calendario, y eso ahora se sabe.
 */
import { z } from "zod/v4";
import { getChannelsOverview } from "@/lib/actions/channels";
import { summarizeLinkStatus } from "@/lib/channels/link-status-summary";
import { attempt, defineRead, type ReadResult } from "../../tool";
import type { CardRow } from "../../types";
import { clip } from "../../format";
import { resolveUnit } from "../_resolve";

const HOW_IT_WORKS =
  "A Airbnb y a Booking no se les puede avisar un cambio: vienen solas a leer el calendario del departamento (Airbnb cada 3 horas, Booking cada 2, más o menos). Hasta que pasan, siguen mostrando lo que vieron la última vez.";

export const estadoCanales = defineRead({
  name: "estado_canales",
  label: "Mirando Airbnb y Booking…",
  description:
    "Cómo está la conexión de un departamento con Airbnb y Booking (o de todos, si no nombran ninguno): si la OTA ya leyó tu calendario, " +
    "cada cuánto lo lee, qué noches le falta cerrar o liberar y a qué hora las va a ver, si el calendario de la OTA se puede leer, " +
    "y cuántos avisos hay para resolver. Usala para «¿por qué Airbnb me muestra disponible el 648?», «cargué una reserva y Booking no la cerró», " +
    "«¿está sincronizado X?», «¿qué pasa con los canales?». No dice qué reservas hay ni si una fecha está libre: para eso van " +
    "listar_reservas y disponibilidad. No cambia nada en la OTA: si un cambio no puede esperar, la respuesta trae cómo pedirle que lea ya.",
  input: z.object({
    unidad: z
      .string()
      .max(80)
      .describe("Código o nombre del departamento por el que preguntan (por ejemplo SAL648). Sin unidad: todas las conexiones que tienen algo para mirar.")
      .optional(),
  }),
  resource: "channels",
  action: "view",
  async run(input): Promise<ReadResult> {
    let unit: { id: string; code: string; name: string } | null = null;
    if (input.unidad?.trim()) {
      const u = await resolveUnit(input.unidad);
      if (u.ok === false) return u;
      if (u.ok === "choose") return { ok: true, data: { necesito_elegir: u.question, opciones: u.options } };
      unit = u.value;
    }

    const overview = await attempt(() => getChannelsOverview());
    if (!overview.ok) return overview;
    const now = new Date();
    const all = overview.value.links
      .filter((l) => l.status !== "draft")
      .map((l) => ({ link: l, s: summarizeLinkStatus(l, now) }));

    if (unit) {
      const mine = all.filter((x) => x.link.unit.id === unit.id);
      if (mine.length === 0) {
        return {
          ok: true,
          data: {
            unidad: `${unit.code} · ${unit.name}`,
            sin_conexion: "Este departamento no está conectado con Airbnb ni con Booking: lo que se cargue acá no se cierra en ninguna OTA.",
          },
          card: {
            kind: "link",
            title: `${unit.code} no está conectado`,
            description: "Se conecta desde Canales de venta.",
            href: "/dashboard/canales/conectar",
            cta: "Conectar",
          },
        };
      }
      return {
        ok: true,
        data: { como_funciona: HOW_IT_WORKS, conexiones: mine.map((x) => toData(x.s)) },
        card: {
          kind: "list",
          title: `Canales · ${unit.code}`,
          icon: "calendar",
          rows: mine.map((x) => toRow(x.s)),
          footer: { label: "Abrir Canales de venta", href: "/dashboard/canales" },
        },
      };
    }

    const attention = all.filter((x) => x.s.needsAttention);
    const shown = attention.slice(0, 30);
    return {
      ok: true,
      data: {
        como_funciona: HOW_IT_WORKS,
        conexiones_activas: all.filter((x) => x.link.status === "active").length,
        sin_novedad: all.filter((x) => x.link.status === "active" && !x.s.needsAttention).length,
        para_mirar: shown.map((x) => toData(x.s)),
        ...(attention.length > shown.length ? { y_mas: attention.length - shown.length } : {}),
        avisos_para_resolver: overview.value.issues.slice(0, 8).map((i) => ({
          unidad: i.unit ? i.unit.code : null,
          aviso: i.title,
        })),
      },
      card: {
        kind: "list",
        title: "Canales de venta",
        icon: "calendar",
        rows: attention.slice(0, 12).map((x) => toRow(x.s)),
        more: Math.max(0, attention.length - 12),
        empty: "Todas las conexiones están al día.",
        footer: { label: "Abrir Canales de venta", href: "/dashboard/canales" },
      },
    };
  },
});

function toData(s: ReturnType<typeof summarizeLinkStatus>) {
  return {
    unidad: s.unidad,
    canal: s.canal,
    estado: s.estado,
    la_ota_lee_tu_calendario: s.publicacion,
    ...(s.le_falta_cerrar.length > 0 ? { ocupado_aca_y_libre_en_la_ota: s.le_falta_cerrar } : {}),
    ...(s.le_falta_liberar.length > 0 ? { liberado_aca_y_cerrado_en_la_ota: s.le_falta_liberar } : {}),
    traemos_sus_reservas: s.recepcion,
    ...(s.como_forzar ? { si_no_puede_esperar: s.como_forzar } : {}),
    ...(s.avisos_abiertos > 0 ? { avisos_abiertos: s.avisos_abiertos } : {}),
  };
}

function toRow(s: ReturnType<typeof summarizeLinkStatus>): CardRow {
  const pending = [...s.le_falta_cerrar, ...s.le_falta_liberar];
  return {
    title: `${s.unidad} · ${s.canal}`,
    subtitle: clip(pending.length > 0 ? `${s.publicacion} ${pending.join(" · ")}` : s.publicacion, 200),
    badge: { label: pending.length > 0 && s.tone === "warn" ? "Falta que lea" : s.estado, tone: s.tone },
    href: `/dashboard/canales/${s.id}`,
  };
}
