import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  fireParteDiarioReminder,
  generateParteDiarioForCron,
} from "@/lib/actions/parte-diario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron horario multi-tenant. Cada hora `:00` UTC consulta todas las orgs con
 * parte diario habilitado, computa la hora local de cada una, y si coincide
 * con su `draft_hour` genera el borrador para el día siguiente. Si coincide
 * con su `reminder_hour` y el draft sigue en borrador, dispara la notificación.
 *
 * Diseño multi-tenant: un solo cron en vercel.json, pero cada org configura
 * su timezone + draft_hour + reminder_hour por separado en
 * `apartcba.parte_diario_settings`.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const startedAt = Date.now();
  const drafts: { org: string; date: string; ok: boolean; error?: string }[] = [];
  const reminders: { org: string; date: string; ok: boolean; error?: string }[] = [];

  const admin = createAdminClient();
  const { data: settings, error } = await admin
    .from("parte_diario_settings")
    .select("organization_id, timezone, draft_hour, reminder_hour")
    .eq("enabled", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  for (const s of (settings ?? []) as {
    organization_id: string;
    timezone: string;
    draft_hour: number;
    reminder_hour: number | null;
  }[]) {
    const localHour = hourInTimezone(now, s.timezone);
    const localYmd = ymdInTimezone(now, s.timezone);
    const tomorrowYmd = addDaysToYmd(localYmd, 1);

    if (localHour === s.draft_hour) {
      try {
        await generateParteDiarioForCron(s.organization_id, tomorrowYmd);
        drafts.push({ org: s.organization_id, date: tomorrowYmd, ok: true });
      } catch (err) {
        drafts.push({
          org: s.organization_id,
          date: tomorrowYmd,
          ok: false,
          error: (err as Error).message,
        });
      }
    }

    if (s.reminder_hour !== null && localHour === s.reminder_hour) {
      // El recordatorio mira el parte de "mañana" — el que se generó horas antes
      // a las draft_hour, asumiendo reminder_hour > draft_hour en el mismo día.
      try {
        await fireParteDiarioReminder(s.organization_id, tomorrowYmd);
        reminders.push({ org: s.organization_id, date: tomorrowYmd, ok: true });
      } catch (err) {
        reminders.push({
          org: s.organization_id,
          date: tomorrowYmd,
          ok: false,
          error: (err as Error).message,
        });
      }
    }
  }

  const duration_ms = Date.now() - startedAt;
  console.log(
    `[cron/hourly-tick] orgs=${(settings ?? []).length} drafts=${drafts.length} reminders=${reminders.length} dur=${duration_ms}ms`,
  );
  return NextResponse.json({ ok: true, duration_ms, drafts, reminders });
}

function hourInTimezone(date: Date, tz: string): number {
  // Intl con hour12=false → string "14" (00–23)
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  });
  return parseInt(fmt.format(date), 10);
}

function ymdInTimezone(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
