/**
 * `buscar`: el buscador global (reservas, huéspedes, unidades, propietarios y
 * movimientos de Caja). Envuelve `searchEverything`, el mismo del buscador de
 * la hoja «Más»: cada fuente se pide sólo si el rol la puede ver.
 */
import { z } from "zod/v4";
import { searchEverything, type GlobalSearchHit } from "@/lib/actions/global-search";
import type { CardRow, CardTone } from "../../types";
import { attempt, defineRead } from "../../tool";

const KIND: Record<GlobalSearchHit["kind"], { label: string; tone: CardTone }> = {
  reserva: { label: "Reserva", tone: "info" },
  huesped: { label: "Huésped", tone: "neutral" },
  unidad: { label: "Unidad", tone: "good" },
  propietario: { label: "Propietario", tone: "neutral" },
  movimiento: { label: "Caja", tone: "warn" },
};
const ORDER: GlobalSearchHit["kind"][] = ["reserva", "huesped", "unidad", "propietario", "movimiento"];
const CARD_ROWS = 16;

export const buscar = defineRead({
  name: "buscar",
  label: "Buscando…",
  description:
    "Busca de una sola vez en reservas, huéspedes, unidades, propietarios y movimientos de Caja (sólo lo que el usuario puede ver). " +
    "Usala cuando te nombran algo y no sabés qué es: «buscá a Pérez», «¿qué es HMABC123?», «el 525», «el pago de 50.000». " +
    "Devuelve el tipo y el id de cada resultado: para el detalle seguí con ver_reserva (id de una reserva) o ver_huesped (id de un huésped). " +
    "No sirve para saber qué está libre (usá disponibilidad) ni para listar reservas por fecha (usá listar_reservas).",
  input: z.object({
    texto: z
      .string()
      .min(2)
      .max(120)
      .describe(
        "Lo que hay que buscar: nombre o apellido, teléfono, email, documento, código de reserva de Airbnb/Booking, código o nombre de la unidad, o un concepto o importe de Caja.",
      ),
  }),
  resource: "*",
  action: "view",
  async run(input) {
    const texto = input.texto.trim();
    const r = await attempt(() => searchEverything(texto, { limit: 6 }));
    if (!r.ok) return r;
    if (!r.value.ok) return { ok: false, error: r.value.error };

    const hits = [...r.value.hits].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    const porTipo: Partial<Record<GlobalSearchHit["kind"], number>> = {};
    for (const h of hits) porTipo[h.kind] = (porTipo[h.kind] ?? 0) + 1;

    const rows: CardRow[] = hits.slice(0, CARD_ROWS).map((h) => ({
      title: h.title,
      subtitle: h.kind === "movimiento" ? h.subtitle : [h.subtitle, h.meta].filter(Boolean).join(" · ") || undefined,
      meta: h.kind === "movimiento" ? h.meta : undefined,
      badge: { label: KIND[h.kind].label, tone: KIND[h.kind].tone },
      href: h.href,
    }));

    return {
      ok: true,
      data: {
        texto,
        encontrados: hits.length,
        por_tipo: porTipo,
        resultados: hits.slice(0, 40).map((h) => ({
          tipo: h.kind,
          id: h.id,
          nombre: h.title,
          detalle: h.subtitle,
          extra: h.meta,
        })),
        ...(hits.length === 0
          ? { nota: "No apareció nada. Probá con otra parte del nombre, el teléfono o el código de la unidad." }
          : {}),
      },
      card: {
        kind: "list",
        title: hits.length ? `Resultados para «${texto}»` : `Nada para «${texto}»`,
        icon: "search",
        rows,
        more: Math.max(0, hits.length - CARD_ROWS),
        empty: "No encontré nada con ese texto.",
      },
    };
  },
});
