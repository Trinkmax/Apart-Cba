-- Asegura permisos EXECUTE explícitos en funciones del marketplace.
-- Aunque ALTER DEFAULT PRIVILEGES en 001 cubre la mayoría, las funciones
-- creadas más tarde con CREATE OR REPLACE pueden no heredarlos si la
-- migración corrió con un rol distinto. Este grant es idempotente.
GRANT EXECUTE ON FUNCTION apartcba.generate_unit_slug(text, uuid)
  TO authenticated, service_role;
