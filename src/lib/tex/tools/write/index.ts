/**
 * Las herramientas de escritura de Tex (proponen; la persona confirma), en
 * ORDEN FIJO: van en el prefijo cacheado del prompt, así que reordenar o
 * renombrar invalida la caché. Una nueva se suma AL FINAL.
 */
import type { TexTool } from "../../tool";
import { cargoExtra, registrarCobro, registrarIngreso, transferirEntreCuentas } from "./cobros";
import { cambiarEstadoReserva, crearReserva, extenderReserva } from "./reservas";
import { cancelarReserva, completarPrecio, modificarReserva, moverReserva } from "./reservas-cambios";
import { asignarLimpieza, cambiarEstadoTicket, completarTarea, crearTarea, crearTicket, marcarLimpieza } from "./operacion";
import { responderSolicitud } from "./solicitudes";

export const WRITE_TOOLS: readonly TexTool[] = [
  registrarCobro,
  registrarIngreso,
  crearReserva,
  cambiarEstadoReserva,
  extenderReserva,
  marcarLimpieza,
  crearTicket,
  cambiarEstadoTicket,
  crearTarea,
  completarTarea,
  responderSolicitud,
  // Ronda 2 (nov-2026)
  modificarReserva,
  moverReserva,
  completarPrecio,
  cargoExtra,
  cancelarReserva,
  asignarLimpieza,
  transferirEntreCuentas,
];
