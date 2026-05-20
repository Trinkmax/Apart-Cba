import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { syncAllFeedsCron } from "@/lib/ical/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const results = await syncAllFeedsCron(admin, "cron");

  return NextResponse.json({ ok: true, ...results });
}
