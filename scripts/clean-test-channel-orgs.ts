/**
 * Borra las organizaciones DESCARTABLES que crea `npm run test:db`
 * (pipeline-db.test.ts) cuando una corrida se cortó sin limpiar.
 *
 *   npx tsx scripts/clean-test-channel-orgs.ts
 *
 * Con la red lenta los tests se pasan de tiempo y el `afterAll` no llega a
 * correr: quedan dos organizaciones `zz-test-canales-*` en la base. No las ve
 * nadie, pero el sincronizador reclama sus conexiones y las búsquedas globales
 * de la corrida siguiente chocan con sus filas (3 tests fallaban por eso el
 * 19/11/2026). Sólo toca organizaciones con ese slug, ese nombre y sin gente.
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const admin = createClient(url, key, { db: { schema: "apartcba" }, auth: { persistSession: false } });

// El mismo orden que el `cleanup()` del test.
const TABLES = [
  "channel_issues",
  "channel_cancellation_requests",
  "channel_events",
  "booking_external_refs",
  "channel_export_reads",
  "channel_reservations",
  "channel_links",
  "channel_settings",
  "notifications",
  "cleaning_tasks",
  "bookings",
  "guests",
  "units",
];

async function main() {
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, slug, created_at")
    .like("slug", "zz-test-canales%")
    .like("name", "ZZ Test Canales%");
  if (error) throw new Error(error.message);
  for (const org of orgs ?? []) {
    const { count: members } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.id);
    if ((members ?? 0) > 0) {
      console.log(`salteada (tiene miembros): ${org.slug}`);
      continue;
    }
    for (const table of TABLES) {
      const { error: delErr } = await admin.from(table).delete().eq("organization_id", org.id);
      if (delErr) console.log(`  ${table}: ${delErr.message}`);
    }
    const { error: orgErr } = await admin.from("organizations").delete().eq("id", org.id);
    console.log(orgErr ? `NO se pudo borrar ${org.slug}: ${orgErr.message}` : `borrada ${org.slug} (creada ${org.created_at})`);
  }
  const { count } = await admin
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .like("slug", "zz-test-canales%");
  console.log(`organizaciones de prueba restantes: ${count ?? 0}`);
}

main().catch((e) => {
  console.error("falló:", (e as Error).message);
  process.exit(1);
});
