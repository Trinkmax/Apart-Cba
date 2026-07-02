-- ─────────────────────────────────────────────────────────────────────────────
-- 037: Columna units.city faltante (hotfix producción 2026-07-02)
--
-- El commit a9eb1be ("hardening de disponibilidad, identidad y seguridad para
-- go-live") cambió searchListings/getListingBySlug a una lista explícita de
-- columnas que incluye `units.city`, pero la columna nunca se creó — el `city`
-- de la migración 016 es de guest_profiles. Al deployar, la home del
-- marketplace tiraba "column units.city does not exist" y caía al error
-- boundary ("Algo salió mal").
--
-- Backfill: la operación es Córdoba Capital; es dato de display editable
-- desde el dashboard.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE apartcba.units ADD COLUMN IF NOT EXISTS city text;

UPDATE apartcba.units SET city = 'Córdoba' WHERE city IS NULL;
