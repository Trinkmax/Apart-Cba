/**
 * Lista de control por defecto de una limpieza.
 *
 * Vive fuera de `src/lib/actions/cleaning.ts` porque ese archivo es
 * `"use server"` y sólo puede exportar funciones async: la pantalla de
 * Configuración → Limpieza necesita la lista para ofrecer "volver a la
 * sugerida".
 *
 * Se usa cuando la organización todavía no armó la suya
 * (`organizations.cleaning_checklist` vacío). Mantener en sync con
 * `apartcba.cleaning_checklist_for_org()` (migración 062), que es la que usa el
 * trigger de check-out.
 */
export const DEFAULT_CHECKLIST = [
  "Cocina (vajilla, electrodomésticos)",
  "Baño (sanitarios, ducha, espejos)",
  "Dormitorios (cambio de sábanas)",
  "Living / comedor",
  "Pisos (aspirar / trapear)",
  "Toallas y blanquería",
  "Reposición amenities (papel, jabón, café)",
  "Ventilación / olores",
  "Verificación de inventario",
] as const;
