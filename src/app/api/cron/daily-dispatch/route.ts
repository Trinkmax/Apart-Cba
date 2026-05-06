import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { generatePaymentReminders } from "@/lib/actions/notifications";
import { dispatchEvent } from "@/lib/crm/workflows/dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min para correr todos los jobs

/**
 * Cron diario consolidado (Vercel Hobby permite 2 crons; libera 1 slot vs tener 3 separados).
 *
 * Corre diariamente (ver vercel.json):
 *   1. Sync iCal feeds (lo que hace /api/cron/sync-ical)
 *   2. Generar payment reminders (lo que hace /api/cron/payment-reminders)
 *   3. Workflow scheduler — workflows con cron_expression "daily" lo dispara
 *   4. Reset mensual de quota AI (sólo el 1° del mes)
 *   5. Templates polling — refresh status de templates pending
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
  const results: Record<string, unknown> = {};

  // 1. Sync iCal
  try {
    const icalRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/sync-ical`, {
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
    });
    results.ical = await icalRes.json();
  } catch (err) {
    results.ical = { error: (err as Error).message };
  }

  // 2. Payment reminders
  try {
    const rem = await generatePaymentReminders(5);
    results.payment_reminders = { orgs_scanned: rem.length };
  } catch (err) {
    results.payment_reminders = { error: (err as Error).message };
  }

  // 3. Workflow scheduler — daily schedules
  try {
    const admin = createAdminClient();
    const { data: dailySchedules } = await admin
      .from("crm_workflow_schedules")
      .select("id,workflow_id,organization_id,cron_expression")
      .eq("active", true)
      .like("cron_expression", "0 % * * *"); // schedules tipo daily
    let fired = 0;
    for (const sch of dailySchedules ?? []) {
      await dispatchEvent({
        organizationId: sch.organization_id,
        eventType: "scheduled.tick",
        payload: { schedule_id: sch.id, workflow_id: sch.workflow_id, daily: true },
      });
      const next = new Date();
      next.setUTCDate(next.getUTCDate() + 1);
      await admin
        .from("crm_workflow_schedules")
        .update({ next_run_at: next.toISOString(), last_run_at: new Date().toISOString() })
        .eq("id", sch.id);
      fired += 1;
    }
    results.workflow_daily = { fired };
  } catch (err) {
    results.workflow_daily = { error: (err as Error).message };
  }

  // 4. Reset mensual quota AI (idempotente: la función ya valida period_started)
  try {
    const admin = createAdminClient();
    const { data: resetCount } = await admin.rpc("crm_reset_monthly_ai_quota");
    results.ai_quota_reset = { count: resetCount };
  } catch (err) {
    results.ai_quota_reset = { error: (err as Error).message };
  }

  // 4.5 Detectar check-ins / check-outs / recordatorios y publicar eventos CRM
  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const { data: checkinsToday } = await admin
      .from("bookings")
      .select("id,organization_id,unit_id,guest_id,status,check_in_date")
      .eq("check_in_date", today)
      .in("status", ["confirmada", "check_in"]);

    const { data: checkoutsToday } = await admin
      .from("bookings")
      .select("id,organization_id,unit_id,guest_id,status,check_out_date")
      .eq("check_out_date", today)
      .in("status", ["check_in", "check_out"]);

    const { data: checkinsTomorrow } = await admin
      .from("bookings")
      .select("id,organization_id,unit_id,guest_id,status,check_in_date")
      .eq("check_in_date", tomorrow)
      .eq("status", "confirmada");

    let crmEventsPublished = 0;
    for (const b of checkinsToday ?? []) {
      await dispatchEvent({
        organizationId: b.organization_id,
        eventType: "booking.checkin_today",
        payload: { booking_id: b.id, unit_id: b.unit_id, guest_id: b.guest_id },
        refType: "booking",
        refId: b.id,
      });
      crmEventsPublished += 1;
    }
    for (const b of checkoutsToday ?? []) {
      await dispatchEvent({
        organizationId: b.organization_id,
        eventType: "booking.checkout_today",
        payload: { booking_id: b.id, unit_id: b.unit_id, guest_id: b.guest_id },
        refType: "booking",
        refId: b.id,
      });
      crmEventsPublished += 1;
    }
    for (const b of checkinsTomorrow ?? []) {
      await dispatchEvent({
        organizationId: b.organization_id,
        eventType: "booking.checkin_tomorrow",
        payload: { booking_id: b.id, unit_id: b.unit_id, guest_id: b.guest_id },
        refType: "booking",
        refId: b.id,
      });
      crmEventsPublished += 1;
    }
    results.crm_pms_events = { published: crmEventsPublished };
  } catch (err) {
    results.crm_pms_events = { error: (err as Error).message };
  }

  // 5. Refresh templates pending
  try {
    const admin = createAdminClient();
    const { data: pendingTemplates } = await admin
      .from("crm_whatsapp_templates")
      .select("id,channel_id,meta_template_id")
      .eq("meta_status", "pending")
      .not("meta_template_id", "is", null)
      .limit(20);

    let refreshed = 0;
    for (const tpl of pendingTemplates ?? []) {
      try {
        const { getProviderForChannel } = await import("@/lib/crm/providers/factory");
        const provider = await getProviderForChannel(tpl.channel_id);
        const status = await provider.getTemplateStatus(tpl.meta_template_id!);
        const newStatus = status.status.toLowerCase();
        const update: Record<string, unknown> = { meta_status: newStatus, last_polled_at: new Date().toISOString() };
        if (newStatus === "approved") update.approved_at = new Date().toISOString();
        if (newStatus === "rejected") update.meta_rejection_reason = status.rejectionReason;
        await admin.from("crm_whatsapp_templates").update(update).eq("id", tpl.id);
        refreshed += 1;
      } catch {
        // continue
      }
    }
    results.templates_refreshed = { count: refreshed };
  } catch (err) {
    results.templates_refreshed = { error: (err as Error).message };
  }

  const duration_ms = Date.now() - startedAt;
  console.log(`[cron/daily-dispatch] completed in ${duration_ms}ms`, results);
  return NextResponse.json({ ok: true, duration_ms, ...results });
}
