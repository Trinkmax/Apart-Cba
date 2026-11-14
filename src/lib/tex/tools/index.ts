/**
 * La lista de herramientas de Tex, en ORDEN FIJO (nov-2026).
 *
 * El orden importa: las herramientas van primero en el prompt y forman parte
 * del prefijo cacheado (y del que valida los bloques de thinking de Haiku 5.5):
 * reordenar o renombrar invalida la caché de todas las conversaciones. Para
 * agregar una, sumala AL FINAL de su grupo (en read/ o write/).
 */
import type { TexTool } from "../tool";
import { parteDelDia } from "./parte";
import { registrarGasto } from "./gastos";
import { READ_TOOLS } from "./read";
import { ofrecerOpciones } from "./opciones";
import { WRITE_TOOLS } from "./write";

export const TEX_TOOLS: readonly TexTool[] = [
  // Lectura: el día primero (lo más preguntado), después el resto.
  parteDelDia,
  ...READ_TOOLS,
  ofrecerOpciones,
  // Acciones (proponen; la persona confirma).
  registrarGasto,
  ...WRITE_TOOLS,
];

export function findTool(name: string): TexTool | undefined {
  return TEX_TOOLS.find((t) => t.name === name);
}
