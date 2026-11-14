/**
 * Las herramientas de LECTURA de Tex, en orden fijo (nov-2026).
 *
 * El orden importa igual que en `../index.ts`: es parte del prefijo cacheado
 * del prompt. Para agregar una, sumala al final de su grupo. `parte_del_dia`
 * (../parte.ts) no está acá: la lista general la ubica aparte.
 */
import type { TexTool } from "../../tool";
import { buscar } from "./buscar";
import { disponibilidad, solicitudesPendientes } from "./disponibilidad";
import { listarReservas, verHuesped, verReserva } from "./reservas";
import { liquidaciones, resultadosDelMes, resumenDelNegocio } from "./negocio";
import { buscarMovimientos, caja, cuotasPorCobrar, movimientos } from "./caja";
import { avisos, limpieza, tareas, tickets } from "./operacion";
import { abrirPantalla } from "./navegar";

export const READ_TOOLS: readonly TexTool[] = [
  // Encontrar
  buscar,
  // Reservas
  disponibilidad,
  listarReservas,
  verReserva,
  verHuesped,
  solicitudesPendientes,
  // El negocio
  resumenDelNegocio,
  resultadosDelMes,
  // Caja y cobranza
  caja,
  movimientos,
  buscarMovimientos,
  cuotasPorCobrar,
  liquidaciones,
  // Operación
  avisos,
  limpieza,
  tickets,
  tareas,
  // Navegar
  abrirPantalla,
];
