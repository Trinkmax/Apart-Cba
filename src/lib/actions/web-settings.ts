"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { isAdminLevel } from "@/lib/permissions";
import type { OrgWebSettings } from "@/lib/types/database";
import { resolveWebSettings, type ResolvedWebSettings } from "@/lib/marketplace/web-settings";
import { WEB_SETTINGS_TAG } from "@/lib/marketplace/web-settings-server";
import { validateWebSettingsInput, type WebSettingsInput } from "@/lib/marketplace/staff-helpers";


/**
 * Configuración → Web y cobros: lo que ve el huésped en la web (contacto,
 * promesa de respuesta), cómo se calcula la seña y a dónde se transfiere.
 * Sólo admin (isAdminLevel). La lectura pública con caché vive en
 * `@/lib/marketplace/web-settings-server`; guardar la invalida por tag.
 */

export async function getWebSettingsForCurrentOrg(): Promise<{
  settings: OrgWebSettings | null;
  resolved: ResolvedWebSettings;
  orgContactEmail: string | null;
}> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  // Los datos de cobro (CBU, CUIT) son del negocio: fuera del nivel admin no se leen.
  if (!isAdminLevel(role)) throw new Error("forbidden");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_web_settings")
    .select("*")
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) console.error("[web-settings] lectura falló:", error.message);
  const settings = (data as OrgWebSettings | null) ?? null;
  return {
    settings,
    resolved: resolveWebSettings(settings, {
      email: organization.contact_email ?? null,
      phone: organization.contact_phone ?? null,
    }),
    orgContactEmail: organization.contact_email ?? null,
  };
}

/** Forma del input (tipos); las reglas de negocio las aplica validateWebSettingsInput. */
const inputSchema = z.object({
  whatsapp_number: z.string().max(40, "Revisá el número de WhatsApp."),
  public_email: z.string().max(254, "Revisá el email."),
  instagram_handle: z.string().max(120, "Revisá el usuario de Instagram."),
  response_hours: z.union([z.number(), z.string().max(10)]),
  deposit_rule: z.enum(["one_night", "percent", "none"], { message: "Elegí cómo se calcula la seña." }),
  deposit_percent: z.union([z.number(), z.string().max(10)]).nullable(),
  deposit_due_hours: z.union([z.number(), z.string().max(10)]),
  transfer_holder: z.string().max(400),
  transfer_cuit: z.string().max(40),
  transfer_bank: z.string().max(400),
  transfer_cbu: z.string().max(60),
  transfer_alias: z.string().max(60),
  transfer_notes: z.string().max(2000),
  cancellation_text: z.string().max(8000),
});

export async function saveWebSettings(
  input: WebSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) {
    return { ok: false, error: "Sólo un administrador puede cambiar la configuración de la web." };
  }

  const shape = inputSchema.safeParse(input);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    const field = typeof issue?.path?.[0] === "string" ? (issue.path[0] as string) : undefined;
    return { ok: false, error: issue?.message || "Revisá los datos.", field };
  }
  const checked = validateWebSettingsInput(shape.data as WebSettingsInput);
  if (!checked.ok) return { ok: false, error: checked.error, field: checked.field };

  const admin = createAdminClient();
  const { error } = await admin.from("org_web_settings").upsert(
    {
      organization_id: organization.id,
      ...checked.value,
      updated_by: session.userId,
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    console.error("[web-settings] guardado falló:", error.message);
    return { ok: false, error: saveErrorMessage(error.message) };
  }

  // Web pública, mails y crons leen la versión cacheada por tag.
  updateTag(WEB_SETTINGS_TAG);
  revalidatePath("/dashboard/configuracion/web");
  revalidatePath("/dashboard/reservas-pendientes", "layout");
  return { ok: true };
}

/** Constraints de org_web_settings → texto para una persona. */
function saveErrorMessage(raw: string): string {
  if (raw.includes("whatsapp_digits")) return "Revisá el número de WhatsApp.";
  if (raw.includes("cbu_digits")) return "El CBU o CVU tiene 22 números.";
  if (raw.includes("response_hours")) return "\"Respondemos en\" va de 1 a 48 horas.";
  if (raw.includes("due_hours")) return "El plazo para transferir va de 1 a 168 horas.";
  if (raw.includes("deposit_percent") || raw.includes("percent_needs_value")) return "El porcentaje de la seña va de 1 a 100.";
  return "No pudimos guardar la configuración. Probá de nuevo en un rato.";
}
