import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { generateParteDiarioForCron } from "@/lib/actions/parte-diario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron diario del parte. Vercel Hobby restringe crons a "once per day", así
 * que disparamos a una hora UTC fija (23:00 UTC = 20:00 hora Argentina) y
 * generamos el borrador para "mañana" según la timezone de cada organización.
 *
 * Para orgs en otras timezones, el draft se genera al equivalente local de
 * 23:00 UTC. Si una org necesita otro horario puede generar manualmente desde
 * /dashboard/parte-diario/configuracion → "Generar borrador ahora".
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

  const admin = createAdminClient();
  const { data: settings, error } = await admin
    .from("parte_diario_settings")
    .select("organization_id, timezone")
    .eq("enabled", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  for (const s of (settings ?? []) as {
    organization_id: string;
    timezone: string;
  }[]) {
    const localYmd = ymdInTimezone(now, s.timezone);
    const tomorrowYmd = addDaysToYmd(localYmd, 1);
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

  const duration_ms = Date.now() - startedAt;
  console.log(
    `[cron/parte-diario-draft] orgs=${(settings ?? []).length} drafts=${drafts.length} dur=${duration_ms}ms`,
  );
  return NextResponse.json({ ok: true, duration_ms, drafts });
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
