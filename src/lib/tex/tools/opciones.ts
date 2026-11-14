/**
 * `ofrecer_opciones`: botones para responder con un toque (nov-2026).
 *
 * Cuando Tex le pregunta algo a la persona ("¿Cuántas personas son?", "¿Se
 * corre toda la estadía?"), además de escribir la pregunta ofrece 2 a 4
 * respuestas cortas que aparecen como botones debajo. Tocar uno manda ese
 * texto como respuesta. No consulta ni escribe nada.
 */
import { z } from "zod/v4";
import { defineRead } from "../tool";

export const ofrecerOpciones = defineRead({
  name: "ofrecer_opciones",
  label: "Preparando opciones…",
  description:
    "Muestra 2 a 4 respuestas cortas como botones debajo de tu pregunta, para que la persona conteste con un toque " +
    "(ej. para «¿Cuántas personas son?»: «Somos 2», «Somos 3», «Somos 4»). Usala cada vez que hagas una pregunta con " +
    "respuestas previsibles. Escribí la pregunta en tu texto y después llamá esta herramienta; después terminá el turno " +
    "y esperá la respuesta. No la uses para preguntas abiertas (un nombre, un teléfono) ni para inventar montos: un " +
    "importe sólo va en un botón si salió de una herramienta.",
  input: z.object({
    opciones: z
      .array(z.string().min(1).max(40))
      .min(2)
      .max(4)
      .describe("Respuestas cortas, en primera persona de quien contesta («Sí», «Sin seña», «Son 3»)."),
  }),
  resource: "*",
  action: "view",
  async run(input) {
    return {
      ok: true,
      data: { mostradas: input.opciones, nota: "Ya se ven como botones. Terminá el turno y esperá la respuesta." },
      replies: input.opciones,
    };
  },
});
