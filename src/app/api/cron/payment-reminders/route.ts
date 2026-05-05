import { NextResponse } from "next/server";
import { generatePaymentReminders } from "@/lib/actions/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron diario: marca cuotas vencidas y crea recordatorios in-app
 * para las que vencen en los próximos 5 días hábiles.
 *
 * Idempotente vía dedup_key por cuota+ventana.
 * Vercel cron schedule en vercel.json.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const startedAt = Date.now();
  try {
    const results = await generatePaymentReminders(5);
    const totals = results.reduce(
      (acc, r) => ({
        upcoming: acc.upcoming + r.upcoming_created,
        overdue: acc.overdue + r.overdue_created,
        markedOverdue: r.marked_overdue,
      }),
      { upcoming: 0, overdue: 0, markedOverdue: 0 }
    );
    const ms = Date.now() - startedAt;
    console.log(
      `[cron/payment-reminders] OK orgs=${results.length} upcoming=${totals.upcoming} overdue=${totals.overdue} markedOverdue=${totals.markedOverdue} duration=${ms}ms`
    );
    return NextResponse.json({
      ok: true,
      orgs_scanned: results.length,
      duration_ms: ms,
      ...totals,
      details: results,
    });
  } catch (e) {
    const ms = Date.now() - startedAt;
    console.error(
      `[cron/payment-reminders] FAILED duration=${ms}ms error=${(e as Error).message}`
    );
    return NextResponse.json(
      { ok: false, error: (e as Error).message, duration_ms: ms },
      { status: 500 }
    );
  }
}
