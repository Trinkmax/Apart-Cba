-- 038: Perfiles de staff enriquecidos + contacto alternativo por ticket

-- 1) user_profiles: información personal del equipo (mantenimiento, etc.)
--    La cargan los admins desde /dashboard/configuracion/equipo.
alter table apartcba.user_profiles
  add column if not exists job_title text,                 -- especialidad/puesto (plomero, electricista, portero…)
  add column if not exists dni_number text,                -- número de DNI
  add column if not exists cuit_cuil text,                 -- CUIT/CUIL para pagos/facturación
  add column if not exists address text,                   -- domicilio
  add column if not exists birth_date date,                -- fecha de nacimiento
  add column if not exists emergency_contact_name text,    -- contacto de emergencia (nombre)
  add column if not exists emergency_contact_phone text,   -- contacto de emergencia (teléfono)
  add column if not exists notes text;                     -- notas internas

-- 2) maintenance_tickets: contacto para coordinar el arreglo (por si el
--    ocupante no está en el depto). Se guarda con el ticket para que el
--    técnico lo tenga a mano desde el celular al hacer el trabajo.
alter table apartcba.maintenance_tickets
  add column if not exists contact_name text,
  add column if not exists contact_phone text;
