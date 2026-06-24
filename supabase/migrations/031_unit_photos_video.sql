-- 031_unit_photos_video.sql
-- Generaliza unit_photos para alojar también VIDEOS (mismo bucket unit-photos).
-- Aplicado a producción vía Supabase MCP el 2026-06-24; este archivo versiona ese
-- cambio para que un entorno reconstruido desde migraciones quede igual a prod.
-- Idempotente.

-- 1) Columnas nuevas ----------------------------------------------------------
alter table apartcba.unit_photos
  add column if not exists media_type text not null default 'image',
  add column if not exists poster_url text,
  add column if not exists duration_ms integer;

-- 2) media_type ∈ {image, video} ---------------------------------------------
alter table apartcba.unit_photos
  drop constraint if exists unit_photos_media_type_check;
alter table apartcba.unit_photos
  add constraint unit_photos_media_type_check check (media_type in ('image', 'video'));

-- 3) La portada SIEMPRE debe ser una imagen (un video nunca puede ser cover) ---
alter table apartcba.unit_photos
  drop constraint if exists unit_photos_cover_is_image;
alter table apartcba.unit_photos
  add constraint unit_photos_cover_is_image check (not is_cover or media_type = 'image');

comment on column apartcba.unit_photos.media_type is 'image | video — el bucket unit-photos aloja ambos; los videos llevan poster_url + duration_ms';
comment on column apartcba.unit_photos.poster_url is 'thumbnail (primer frame) del video, jpg en el mismo bucket; null para imágenes';
comment on column apartcba.unit_photos.duration_ms is 'duración del video en ms; null para imágenes';

-- 4) Bucket unit-photos: aceptar video/mp4 y subir el límite a 200 MB ----------
-- (los buckets se gestionan normalmente desde el dashboard; se incluye acá para
--  reproducibilidad de entornos nuevos). Las imágenes se siguen validando a 10MB
--  en el código de la app.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
    file_size_limit = 209715200  -- 200 MB
where id = 'unit-photos';
