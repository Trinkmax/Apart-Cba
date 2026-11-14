/**
 * `abrir_pantalla`: lleva a una pantalla de la app. Sale del mismo mapa que la
 * barra de abajo y la hoja «Más» (`reachableScreens`), así que nunca ofrece una
 * pantalla que rebota a ese rol.
 */
import { z } from "zod/v4";
import { reachableScreens, type ScreenLink } from "@/components/mobile/routes";
import { defineRead } from "../../tool";
import { fold } from "../../format";

/** Palabras de relleno: «abrime la pantalla de caja» → «caja». */
const STOPWORDS = new Set([
  "a", "al", "abri", "abrime", "abrir", "de", "del", "el", "en", "ir", "la", "las", "llevame", "lo", "los",
  "mi", "mis", "mostrame", "pantalla", "quiero", "seccion", "ver", "y",
]);

/** Cómo lo dice la gente → id de pantalla (de `routes.ts`). */
const SYNONYMS: Record<string, string[]> = {
  hoy: ["resumen", "inicio"],
  inicio: ["inicio", "resumen"],
  dashboard: ["resumen", "inicio"],
  tablero: ["resumen", "inicio"],
  // La pestaña «Reservas» abre el calendario; «lista de reservas» gana por nombre.
  reservas: ["calendario", "reservas"],
  agenda: ["calendario"],
  ocupacion: ["calendario"],
  pedidos: ["solicitudes"],
  clientes: ["huespedes"],
  mensajes: ["chats"],
  chat: ["chats"],
  conserjeria: ["tareas"],
  arreglos: ["mantenimiento", "tickets"],
  tickets: ["mantenimiento", "tickets"],
  roturas: ["mantenimiento", "tickets"],
  notificaciones: ["avisos"],
  alertas: ["avisos"],
  campana: ["avisos"],
  duenos: ["propietarios"],
  deptos: ["unidades"],
  departamentos: ["unidades"],
  alquileres: ["tradicionales"],
  contratos: ["tradicionales"],
  inquilinos: ["tradicionales"],
  airbnb: ["canales"],
  booking: ["canales"],
  ical: ["canales"],
  ajustes: ["configuracion"],
  equipo: ["configuracion"],
  ganancias: ["resultados"],
  ventas: ["resultados"],
  rendiciones: ["liquidaciones"],
  saldos: ["caja"],
  gastos: ["caja"],
  cobros: ["caja"],
  movimientos: ["caja"],
  limpiezas: ["limpieza"],
  sucios: ["limpieza"],
  llegadas: ["parte"],
  salidas: ["parte"],
  perfil: ["perfil"],
};

function words(s: string): string[] {
  return fold(s)
    .replace(/[^a-z0-9ñ ]/g, " ")
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w));
}

function score(screen: ScreenLink, qWords: string[]): number {
  const q = qWords.join(" ");
  if (!q) return 0;
  const label = fold(screen.label);
  const id = fold(screen.id);
  if (q === label || q === id) return 100;
  // Nombrada con todas sus palabras («lista de reservas», «liquidaciones de octubre»).
  const labelWords = words(screen.label);
  if ((labelWords.length > 0 && labelWords.every((w) => qWords.includes(w))) || qWords.includes(id)) return 85;
  if (qWords.some((w) => SYNONYMS[w]?.includes(screen.id))) return 80;
  if (label.startsWith(q) || qWords.some((w) => w.length >= 4 && label.includes(w))) return 60;
  const keywords = words(screen.keywords ?? "");
  if (qWords.some((w) => keywords.includes(w))) return 40;
  if (qWords.some((w) => w.length >= 4 && fold(screen.href).includes(w))) return 20;
  return 0;
}

export const abrirPantalla = defineRead({
  name: "abrir_pantalla",
  label: "Buscando la pantalla…",
  description:
    "Lleva a la persona a una pantalla de la app (muestra un botón para ir): «abrí Caja», «llevame al calendario», «quiero ver las liquidaciones». " +
    "Sólo ofrece pantallas que este usuario puede abrir. Si no hay una que coincida, devuelve la lista de pantallas disponibles para que elijas o preguntes. " +
    "Usala cuando piden IR a un lugar; si piden un dato, buscalo con la herramienta que corresponde.",
  input: z.object({
    pantalla: z
      .string()
      .min(1)
      .max(80)
      .describe("La pantalla como la nombró la persona (ej. «caja», «calendario», «avisos», «liquidaciones», «parte diario»)."),
  }),
  resource: "*",
  action: "view",
  async run(input, ctx) {
    const screens = reachableScreens({ role: ctx.role, rentalsEnabled: ctx.org.rentalsEnabled });
    const qWords = words(input.pantalla);
    const ranked = screens
      .map((s) => ({ s, score: score(s, qWords) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const disponibles = screens.map((s) => s.label);

    if (ranked.length === 0) {
      return {
        ok: true,
        data: { no_encontre: input.pantalla, pantallas_disponibles: disponibles },
      };
    }
    const best = ranked.filter((x) => x.score === ranked[0].score);
    if (best.length > 1) {
      return {
        ok: true,
        data: {
          necesito_elegir: `¿Cuál de estas pantallas? ${best.map((x) => x.s.label).join(", ")}.`,
          opciones: best.map((x) => x.s.label),
        },
        card: {
          kind: "list",
          title: "¿Adónde querés ir?",
          icon: "list",
          rows: best.slice(0, 8).map((x) => ({ title: x.s.label, href: x.s.href })),
        },
      };
    }
    const screen = best[0].s;
    return {
      ok: true,
      data: { abrir: screen.label, ruta: screen.href },
      navigate: { href: screen.href, label: screen.label },
      card: { kind: "link", title: screen.label, description: `Te dejo el acceso a ${screen.label}.`, href: screen.href, cta: "Abrir" },
    };
  },
});
