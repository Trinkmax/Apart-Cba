-- 062 — La lista de tareas de limpieza se puede editar
--
-- Pedido (Habitana, 07/09/2026): "¿cómo puedo editar la check list de
-- limpieza?". No se podía: los nueve ítems estaban escritos a mano en el código
-- (`DEFAULT_CHECKLIST` en src/lib/actions/cleaning.ts) y repetidos dentro del
-- trigger `tg_bookings_sync_unit`. La pantalla de una limpieza sólo dejaba
-- tildar; agregar, sacar o renombrar un ítem era imposible.
--
-- Ahora la lista vive en la organización y se edita desde
-- Configuración → Limpieza. Vacío = se usa la lista por defecto, así que nada
-- cambia hasta que alguien la toque.
--
-- Cada limpieza sigue guardando SU copia de la lista (`cleaning_tasks.checklist`):
-- cambiar la plantilla no reescribe las limpiezas ya hechas, que son el registro
-- de lo que efectivamente se controló ese día.

begin;

alter table apartcba.organizations
  add column if not exists cleaning_checklist jsonb not null default '[]'::jsonb;

-- Array de textos. Se valida acá para que ningún camino futuro guarde otra cosa.
alter table apartcba.organizations
  drop constraint if exists organizations_cleaning_checklist_is_array;
alter table apartcba.organizations
  add constraint organizations_cleaning_checklist_is_array
  check (jsonb_typeof(cleaning_checklist) = 'array');

comment on column apartcba.organizations.cleaning_checklist is
  'Plantilla de la checklist de limpieza: array de textos. Vacío = lista por defecto (ver DEFAULT_CHECKLIST en src/lib/actions/cleaning.ts). Se copia a cada cleaning_task al crearla.';

-- El trigger de check-out también arma una limpieza: que use la plantilla de la
-- organización en vez de su copia hardcodeada.
CREATE OR REPLACE FUNCTION apartcba.cleaning_checklist_for_org(p_org_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = apartcba, public AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object('item', item, 'done', false))
        FROM apartcba.organizations o,
             LATERAL jsonb_array_elements_text(o.cleaning_checklist) AS item
       WHERE o.id = p_org_id
         AND jsonb_array_length(o.cleaning_checklist) > 0
    ),
    '[
      {"item": "Cocina (vajilla, electrodomésticos)", "done": false},
      {"item": "Baño (sanitarios, ducha, espejos)", "done": false},
      {"item": "Dormitorios (cambio de sábanas)", "done": false},
      {"item": "Living / comedor", "done": false},
      {"item": "Pisos (aspirar / trapear)", "done": false},
      {"item": "Toallas y blanquería", "done": false},
      {"item": "Reposición amenities (papel, jabón, café)", "done": false},
      {"item": "Ventilación / olores", "done": false},
      {"item": "Verificación de inventario", "done": false}
    ]'::jsonb
  );
$$;

commit;
