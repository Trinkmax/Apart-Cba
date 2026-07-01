-- 034_marketplace_auth_rate_limit.sql
-- Rate limiting best-effort para login / signup / reset del marketplace público.
-- Diseño FAIL-OPEN: si la función falla, la app permite el intento (nunca deja
-- afuera a un huésped legítimo por un bug del limiter). Como los server actions
-- corren server-side, Supabase ve la IP de egress de Vercel y su throttle por IP
-- es inefectivo; este limiter usa la IP real del cliente (x-forwarded-for).
-- A futuro conviene mover esto a Vercel Firewall / BotID o Upstash.

create table if not exists apartcba.auth_rate_limits (
  bucket text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

-- Incrementa el contador del bucket dentro de una ventana deslizante y devuelve
-- true si el intento está permitido (count <= max).
create or replace function apartcba.hit_auth_rate_limit(
  p_bucket text,
  p_max integer,
  p_window_secs integer
) returns boolean
language plpgsql
security definer
set search_path = apartcba
as $$
declare
  v_count integer;
begin
  insert into apartcba.auth_rate_limits as t (bucket, count, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update set
    count = case
      when t.window_start < now() - make_interval(secs => p_window_secs) then 1
      else t.count + 1
    end,
    window_start = case
      when t.window_start < now() - make_interval(secs => p_window_secs) then now()
      else t.window_start
    end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;
