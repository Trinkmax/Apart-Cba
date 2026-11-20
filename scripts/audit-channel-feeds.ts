/**
 * Auditoría de Canales, de SÓLO LECTURA: lo que publica cada OTA ahora mismo
 * contra lo que tiene el sistema, conexión por conexión.
 *
 *   npx tsx scripts/audit-channel-feeds.ts                # todas las organizaciones
 *   npx tsx scripts/audit-channel-feeds.ts --org Habitana
 *   npx tsx scripts/audit-channel-feeds.ts --json /ruta/salida.json
 *   npx tsx scripts/audit-channel-feeds.ts --org Viaggiato --unidad CENTRO   # además lista TODO lo que publica la OTA de esa unidad
 *
 * Lee `.env.local` (clave de servicio). No escribe nada en la base y nunca
 * imprime la dirección de un calendario (llevan un token). Usa el mismo lector
 * que el sincronizador (`parseIcs`), así que ve lo mismo que él.
 *
 * El 19/11/2026 encontró en una pasada lo que no se veía mirando la base sola:
 * una fila trabada en fechas viejas (el calendario había vuelto a un estado
 * anterior, event-dedupe.ts) y un departamento donde Booking deja de publicar
 * cada entrada al leer nuestro calendario (absorbed-closure.ts).
 *
 * Qué significa cada hallazgo:
 *   FECHAS_DISTINTAS          la OTA publica otras fechas que la fila: no debería durar más de una lectura.
 *   SIN_FILA                  la OTA publica algo que el sistema no tiene.
 *   ACTIVA_SIN_RESERVA        la fila está activa y no se pudo cargar (choca con otra): hay un aviso abierto.
 *   PUBLICADA_Y_CANCELADA_ACA la OTA la sigue publicando y acá la reserva está cancelada.
 *   RESERVA_CON_OTRAS_FECHAS  la reserva local tiene otras fechas que la OTA (estadías en curso, mensuales).
 *   NO_PUBLICADA              la fila está activa y la OTA no la publica (las ya empezadas y las que
 *                             alguien decidió mantener son esperables).
 *   NO_SE_PUDO_LEER           el calendario de la OTA no responde.
 */
import { readFileSync, writeFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { parseIcs, toReservationEvent } from "../src/lib/channels/ical-adapter";
import type { Channel } from "../src/lib/channels/types";

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

const args = process.argv.slice(2);
const argOf = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const onlyOrg = argOf("--org");
const jsonOut = argOf("--json");
const onlyUnit = argOf("--unidad");
// Hoy en Córdoba (UTC-3, sin horario de verano).
const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const CONCURRENCY = 8;

interface LinkRow {
  id: string;
  channel: Channel;
  organization_id: string;
  unit_id: string;
  feed_secret_id: string;
  consecutive_failures: number;
}
interface LocalRow {
  status: string;
  check_in_date: string;
  check_out_date: string;
  cancelled_at: string | null;
}
interface ReservationRow {
  id: string;
  ical_uid: string;
  check_in: string | null;
  check_out: string | null;
  external_status: string;
  booking_id: string | null;
  is_block: boolean;
  missing_runs: number;
  confirmation_code: string | null;
  cancellation_locked_at: string | null;
  local: LocalRow | null;
}
type Finding = { kind: string; org: string; unit: string; canal: Channel } & Record<string, unknown>;

async function main() {
  const { data: linkData, error } = await admin
    .from("channel_links")
    .select("id, channel, organization_id, unit_id, feed_secret_id, consecutive_failures")
    .eq("status", "active")
    .not("feed_secret_id", "is", null);
  if (error) throw new Error(error.message);
  const [{ data: orgs }, { data: units }] = await Promise.all([
    admin.from("organizations").select("id, name"),
    admin.from("units").select("id, code"),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const unitCode = new Map((units ?? []).map((u) => [u.id as string, u.code as string]));
  const links = ((linkData ?? []) as LinkRow[]).filter(
    (l) =>
      (!onlyOrg || (orgName.get(l.organization_id) ?? "").toLowerCase() === onlyOrg.toLowerCase()) &&
      (!onlyUnit || (unitCode.get(l.unit_id) ?? "").toLowerCase() === onlyUnit.toLowerCase()),
  );
  const published: string[] = [];

  const findings: Finding[] = [];
  const stats = { conexiones: links.length, leidas: 0, sin_leer: 0, entradas: 0, coinciden: 0 };
  const queue = [...links];

  async function audit(link: LinkRow) {
    const where = {
      org: orgName.get(link.organization_id) ?? "?",
      unit: unitCode.get(link.unit_id) ?? "?",
      canal: link.channel,
    };
    try {
      const { data: feedUrl, error: secretErr } = await admin.rpc("crm_get_secret", { p_secret_id: link.feed_secret_id });
      if (secretErr || typeof feedUrl !== "string" || !feedUrl) throw new Error("sin enlace cargado");
      const res = await fetch(feedUrl, {
        signal: AbortSignal.timeout(25_000),
        headers: { "User-Agent": "rentOS-audit/1.0" },
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const events = parseIcs(await res.text(), link.channel).filter((e) => e.checkOut >= today);
      stats.leidas++;
      stats.entradas += events.length;
      if (onlyUnit) {
        published.push(
          `${where.unit} ${where.canal}: ` +
            (events.length === 0
              ? "(no publica nada de hoy en adelante)"
              : events
                  .map((e) => `${e.checkIn}>${e.checkOut}${e.isBlock ? " cierre" : ""} uid=${e.uid.slice(0, 6)}`)
                  .join(" | ")),
        );
      }

      const { data: rowData, error: rowsErr } = await admin
        .from("channel_reservations")
        .select(
          "id, ical_uid, check_in, check_out, external_status, booking_id, is_block, missing_runs, confirmation_code, cancellation_locked_at, local:bookings!channel_reservations_booking_id_fkey(status, check_in_date, check_out_date, cancelled_at)",
        )
        .eq("link_id", link.id)
        .not("ical_uid", "is", null);
      if (rowsErr) throw new Error(rowsErr.message);
      const rows = (rowData ?? []) as unknown as ReservationRow[];
      const byUid = new Map(rows.map((r) => [r.ical_uid, r]));
      const seen = new Set<string>();

      for (const ev of events) {
        seen.add(ev.uid);
        const row = byUid.get(ev.uid);
        const publica = `${ev.checkIn}>${ev.checkOut}`;
        if (!row) {
          const rev = toReservationEvent({
            event: ev,
            organizationId: link.organization_id,
            linkId: link.id,
            unitId: link.unit_id,
            channel: link.channel,
          });
          const { data: stored } = await admin
            .from("channel_events")
            .select("status")
            .eq("organization_id", link.organization_id)
            .eq("dedupe_key", rev.dedupeKey)
            .maybeSingle();
          findings.push({ ...where, kind: "SIN_FILA", publica, cierre: ev.isBlock, evento: stored?.status ?? "nunca visto" });
          continue;
        }
        const local = row.local;
        if (row.check_in !== ev.checkIn || row.check_out !== ev.checkOut) {
          findings.push({
            ...where,
            kind: "FECHAS_DISTINTAS",
            publica,
            fila: `${row.check_in}>${row.check_out}`,
            estado: row.external_status,
            local: local ? `${local.status} ${local.check_in_date}>${local.check_out_date}` : "sin reserva",
            cierre: ev.isBlock || row.is_block,
          });
        } else if (ev.isBlock || row.is_block) {
          stats.coinciden++;
        } else if (row.external_status === "active" && !row.booking_id) {
          findings.push({ ...where, kind: "ACTIVA_SIN_RESERVA", publica, numero: row.confirmation_code });
        } else if (row.external_status === "active" && local?.status === "cancelada") {
          findings.push({
            ...where,
            kind: "PUBLICADA_Y_CANCELADA_ACA",
            publica,
            numero: row.confirmation_code,
            cancelada: local.cancelled_at?.slice(0, 16),
          });
        } else if (
          row.external_status === "active" &&
          local &&
          (local.check_in_date !== ev.checkIn || local.check_out_date !== ev.checkOut)
        ) {
          findings.push({
            ...where,
            kind: "RESERVA_CON_OTRAS_FECHAS",
            publica,
            local: `${local.status} ${local.check_in_date}>${local.check_out_date}`,
          });
        } else if (row.external_status !== "active") {
          findings.push({ ...where, kind: `PUBLICADA_Y_${row.external_status.toUpperCase()}`, publica });
        } else {
          stats.coinciden++;
        }
      }

      for (const r of rows) {
        if (seen.has(r.ical_uid) || r.ical_uid.includes("#")) continue;
        if (!r.check_out || r.check_out < today) continue;
        if (r.external_status !== "active" && r.external_status !== "pending") continue;
        findings.push({
          ...where,
          kind: "NO_PUBLICADA",
          fila: `${r.check_in}>${r.check_out}`,
          estado: r.external_status,
          local: r.local ? r.local.status : "sin reserva",
          ya_empezo: Boolean(r.check_in && r.check_in <= today),
          mantenida: Boolean(r.cancellation_locked_at),
          lecturas_sin_verla: r.missing_runs,
        });
      }
    } catch (err) {
      stats.sin_leer++;
      findings.push({
        ...where,
        kind: "NO_SE_PUDO_LEER",
        error: String((err as Error).message).replace(/https?:\/\/\S+/g, "[enlace]").slice(0, 120),
        fallas_seguidas: link.consecutive_failures,
      });
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let link = queue.shift(); link; link = queue.shift()) await audit(link);
    }),
  );

  findings.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.org.localeCompare(b.org) || a.unit.localeCompare(b.unit),
  );
  const porTipo: Record<string, number> = {};
  for (const f of findings) porTipo[f.kind] = (porTipo[f.kind] ?? 0) + 1;

  console.log(JSON.stringify({ hoy: today, ...stats, hallazgos: porTipo }));
  for (const line of published) console.log(`PUBLICA                    ${line}`);
  for (const f of findings) {
    const { kind, org, unit, canal, ...rest } = f;
    const detail = Object.entries(rest)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`${kind.padEnd(26)} ${org.slice(0, 12).padEnd(12)} ${unit.padEnd(10)} ${canal.padEnd(7)} ${detail}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), stats, findings }, null, 1));
}

main().catch((e) => {
  console.error("falló:", String((e as Error).message).replace(/https?:\/\/\S+/g, "[enlace]"));
  process.exit(1);
});
