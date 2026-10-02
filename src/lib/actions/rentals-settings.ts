"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { can, isAdminLevel } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { INDEX_CODES } from "@/lib/rentals/indices";
import { getRentalSettings as loadRentalSettings } from "@/lib/rentals/server/contracts";
import { logRentalsError, type ActionResult } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import type { RentalSettingsValues } from "@/components/rentals/settings/settings-model";

/**
 * Configuración del módulo Alquileres (Configuración → Alquileres).
 *
 * No usa `rentalsContext`: esa puerta exige el módulo encendido, y acá es
 * justamente donde se enciende. Leer: cualquiera que pueda ver alquileres;
 * escribir: nivel administración (igual que el resto de Configuración).
 */

const ADMIN_ONLY = "Sólo administración puede cambiar la configuración de alquileres.";

export async function getRentalSettings(): Promise<ActionResult<{ settings: RentalSettingsValues; enabled: boolean; saved: boolean }>> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role) && !can(role, "rentals", "view")) {
    return { ok: false, error: "No tenés permiso para ver la configuración de alquileres." };
  }
  const admin = createAdminClient();
  const row = await loadRentalSettings(admin, organization.id);
  const { organization_id, created_at, updated_at, updated_by, ...settings } = row;
  void organization_id;
  void created_at;
  return { ok: true, settings, enabled: organization.rentals_enabled, saved: updated_by != null || updated_at !== created_at };
}

const optText = (max: number, label: string) =>
  z
    .union([z.string().max(max, `${label}: máximo ${max} caracteres`), z.null()])
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null));

const commission = (who: string) =>
  z
    .object({
      basis: z.enum(["pct_total_contrato", "meses", "monto_fijo", "ninguna"]),
      value: z.coerce.number().min(0, `Honorarios ${who}: no puede ser negativo`).max(100_000_000),
      vat: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.basis === "pct_total_contrato" && v.value > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Honorarios ${who}: el porcentaje no puede pasar de 100` });
      }
      if (v.basis === "meses" && v.value > 12) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Honorarios ${who}: más de 12 meses no parece correcto` });
      }
    });

const int = (min: number, max: number, label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label}: ingresá un número` })
    .int(`${label}: tiene que ser un número entero`)
    .min(min, `${label}: mínimo ${min}`)
    .max(max, `${label}: máximo ${max}`);

const settingsSchema = z
  .object({
    payment_window_days: int(1, 28, "Plazo para pagar"),
    grace_days: int(0, 30, "Días de gracia"),
    late_fee_type: z.enum(["diario_pct", "mensual_pct", "fijo_diario", "ninguno"]),
    late_fee_value: z.coerce.number().min(0, "El punitorio no puede ser negativo").max(100_000_000),
    late_fee_payee: z.enum(["propietario", "inmobiliaria"]),
    admin_fee_pct: z.coerce.number().min(0, "Administración: mínimo 0 %").max(100, "Administración: máximo 100 %"),
    admin_fee_vat: z.boolean(),
    tenant_commission: commission("del inquilino"),
    owner_commission: commission("del propietario"),
    default_index: z.enum(INDEX_CODES as [string, ...string[]]),
    default_adjustment_every: int(1, 12, "Frecuencia de ajuste"),
    default_lag_months: int(0, 3, "Meses del índice"),
    default_rounding: z.enum(["none", "unit", "ten", "hundred", "thousand"]),
    default_duration_months: int(1, 120, "Duración"),
    auto_apply_adjustments: z.boolean(),
    stamp_tax_rate_pct: z.coerce.number().min(0, "Sellado: mínimo 0 %").max(10, "Sellado: máximo 10 %"),
    stamp_tax_exempt_monthly: z.coerce.number().min(0, "El tope de exención no puede ser negativo").max(10_000_000_000).nullable(),
    stamp_tax_tenant_share_pct: z.coerce.number().min(0, "Parte del inquilino: mínimo 0 %").max(100, "Parte del inquilino: máximo 100 %"),
    vat_condition: z.enum(["responsable_inscripto", "monotributo", "exento"]),
    broker_name: optText(120, "Corredor"),
    broker_license: optText(60, "Matrícula"),
    payment_instructions: optText(1000, "Datos para transferir"),
    receipt_footer: optText(1000, "Leyenda del recibo"),
    charge_lead_days: int(0, 28, "Anticipación del cargo"),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.late_fee_type === "diario_pct" && v.late_fee_value > 5) issue("late_fee_value", "Punitorio diario: máximo 5 % por día");
    if (v.late_fee_type === "mensual_pct" && v.late_fee_value > 100) issue("late_fee_value", "Punitorio mensual: máximo 100 %");
    if (v.late_fee_type !== "ninguno" && !(v.late_fee_value > 0)) issue("late_fee_value", "Cargá el valor del punitorio o elegí \"Sin punitorios\"");
  });

export async function updateRentalSettings(input: RentalSettingsValues): Promise<ActionResult> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) return { ok: false, error: ADMIN_ONLY };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Revisá los datos.", field: first?.path?.[0]?.toString() };
  }
  const v = parsed.data;
  const admin = createAdminClient();
  const { error } = await admin.from("rental_settings").upsert(
    {
      organization_id: organization.id,
      ...v,
      late_fee_value: v.late_fee_type === "ninguno" ? 0 : v.late_fee_value,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    logRentalsError("updateRentalSettings", error);
    return { ok: false, error: "No se pudo guardar la configuración. Probá de nuevo en un momento." };
  }
  revalidatePath("/dashboard/configuracion/alquileres");
  if (organization.rentals_enabled) revalidateRentals();
  return { ok: true };
}

export async function setRentalsEnabled(enabled: boolean): Promise<ActionResult<{ enabled: boolean }>> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) return { ok: false, error: ADMIN_ONLY };
  if (typeof enabled !== "boolean") return { ok: false, error: "Valor inválido." };
  const admin = createAdminClient();
  const { error } = await admin.from("organizations").update({ rentals_enabled: enabled }).eq("id", organization.id);
  if (error) {
    logRentalsError("setRentalsEnabled", error);
    return { ok: false, error: "No se pudo cambiar el módulo. Probá de nuevo en un momento." };
  }
  // La org viaja en la sesión: refrescar todo el layout (sidebar incluido).
  revalidatePath("/", "layout");
  revalidatePath("/dashboard/configuracion/alquileres");
  return { ok: true, enabled };
}

/**
 * Qué se frena si se apaga el módulo, en números, para la confirmación:
 * `active` = contratos vigentes (la tarea diaria deja de generarles cargos y
 * ajustes); `links` = links de inquilino que hoy funcionan (el portal sirve
 * cualquier contrato que no sea borrador con el link encendido, y con el
 * módulo apagado los rechaza a todos).
 */
export async function getRentalsShutdownImpact(): Promise<ActionResult<{ active: number; links: number }>> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) return { ok: false, error: ADMIN_ONLY };
  const admin = createAdminClient();
  const contracts = () => admin.from("rental_contracts").select("id", { count: "exact", head: true }).eq("organization_id", organization.id);
  const [activeRes, linksRes] = await Promise.all([
    contracts().eq("status", "vigente"),
    contracts().eq("portal_enabled", true).neq("status", "borrador"),
  ]);
  if (activeRes.error || linksRes.error) {
    logRentalsError("getRentalsShutdownImpact", activeRes.error ?? linksRes.error);
    return { ok: false, error: "No se pudo contar los contratos." };
  }
  return { ok: true, active: activeRes.count ?? 0, links: linksRes.count ?? 0 };
}
