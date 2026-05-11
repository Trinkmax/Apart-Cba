"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import type { OrgDateMark } from "@/lib/types/database";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const colorRegex = /^#[0-9A-Fa-f]{6}$/;

const upsertSchema = z.object({
  date: z.string().regex(dateRegex, "Fecha inválida (YYYY-MM-DD)"),
  color: z.string().regex(colorRegex, "Color inválido (#RRGGBB)"),
  label: z.string().trim().max(80).nullable().optional(),
});

const removeSchema = z.object({
  date: z.string().regex(dateRegex, "Fecha inválida (YYYY-MM-DD)"),
});

export async function listDateMarksInRange(
  startISO: string,
  endISO: string
): Promise<OrgDateMark[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  if (!dateRegex.test(startISO) || !dateRegex.test(endISO)) {
    throw new Error("Rango de fechas inválido");
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_date_marks")
    .select("*")
    .eq("organization_id", organization.id)
    .gte("date", startISO)
    .lte("date", endISO)
    .order("date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as OrgDateMark[]) ?? [];
}

export async function upsertDateMark(input: {
  date: string;
  color: string;
  label?: string | null;
}): Promise<{ ok: true; mark: OrgDateMark } | { ok: false; error: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "date_marks", "create")) {
    return { ok: false, error: "No tenés permiso para marcar fechas" };
  }
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_date_marks")
    .upsert(
      {
        organization_id: organization.id,
        date: parsed.data.date,
        color: parsed.data.color.toUpperCase(),
        label: parsed.data.label?.trim() || null,
        created_by: session.userId,
      },
      { onConflict: "organization_id,date" }
    )
    .select()
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");

  return { ok: true, mark: data as OrgDateMark };
}

export async function removeDateMark(input: {
  date: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "date_marks", "delete")) {
    return { ok: false, error: "No tenés permiso para eliminar marcas" };
  }
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("org_date_marks")
    .delete()
    .eq("organization_id", organization.id)
    .eq("date", parsed.data.date);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");

  return { ok: true };
}
