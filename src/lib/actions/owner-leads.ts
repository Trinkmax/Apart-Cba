"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import {
  OWNER_LEAD_LIMITS,
  OWNER_LEAD_ROOMS,
  type OwnerLeadField,
  type OwnerLeadInput,
  type OwnerLeadResult,
} from "@/components/marketplace/owners/owner-lead-options";
import { detailRowsHtml, detailRowsText, paragraphHtml, TEXT_SIGNATURE } from "@/lib/email/apart/blocks";
import { C, escapeHtml, renderApartEmail, safeHref } from "@/lib/email/apart/layout";
import { sendApartEmail } from "@/lib/email/apart/send";
import { absoluteUrl } from "@/lib/app-url";
import { digitsOnly, formatPhoneAR, whatsappLink } from "@/lib/marketplace/display";
import { getResolvedWebSettingsFresh, getSiteContact } from "@/lib/marketplace/web-settings-server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Formulario "Propietarios": un dueño deja sus datos para que el equipo lo
 * contacte. No crea filas propias (no hay tabla de leads): le llega un mail
 * al equipo (responder = escribirle al dueño) y una notificación en el panel.
 *
 * Público y sin sesión → honeypot + rate limit por IP y por contacto
 * (`hit_auth_rate_limit`, fail-open). Los errores se DEVUELVEN en español.
 */

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const schema = z.object({
  name: z
    .string({ required_error: "Contanos tu nombre." })
    .trim()
    .min(2, "Contanos tu nombre.")
    .max(OWNER_LEAD_LIMITS.name, "El nombre es demasiado largo."),
  phone: z
    .string({ required_error: "Dejanos tu WhatsApp." })
    .trim()
    .min(1, "Dejanos tu WhatsApp.")
    .refine((v) => {
      const d = digitsOnly(v);
      return d.length >= 8 && d.length <= 15;
    }, "Revisá el WhatsApp: con código de área, por ejemplo 351 555-1234."),
  email: z
    .string({ required_error: "Dejanos tu email." })
    .trim()
    .min(1, "Dejanos tu email.")
    .max(OWNER_LEAD_LIMITS.email, "El email es demasiado largo.")
    .email("Revisá el email: parece que le falta algo."),
  address: z
    .string({ required_error: "Contanos dónde está el departamento." })
    .trim()
    .min(3, "Contanos el barrio o la dirección del departamento.")
    .max(OWNER_LEAD_LIMITS.address, "La dirección es demasiado larga."),
  rooms: z
    .enum(OWNER_LEAD_ROOMS, { errorMap: () => ({ message: "Elegí una opción de la lista." }) })
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  message: optionalText(OWNER_LEAD_LIMITS.message, "El mensaje es demasiado largo (hasta 2000 caracteres)."),
  website: z.string().optional().nullable(),
});

const RATE_LIMITED = "Recibimos varios mensajes seguidos desde tu conexión. Esperá un rato y probá de nuevo, o escribinos por WhatsApp.";
const GENERIC_ERROR = "No pudimos enviar tu mensaje. Probá de nuevo en unos minutos o escribinos por WhatsApp.";

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  } catch {
    return "unknown";
  }
}

/** Rate limit best-effort y FAIL-OPEN (como `allowAuthAttempt` de guest-auth). */
async function allowAttempt(bucket: string, max: number, windowSecs: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hit_auth_rate_limit", {
      p_bucket: bucket,
      p_max: max,
      p_window_secs: windowSecs,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const FIELDS: readonly OwnerLeadField[] = ["name", "phone", "email", "address", "rooms", "message"];
const isField = (v: unknown): v is OwnerLeadField => typeof v === "string" && (FIELDS as readonly string[]).includes(v);

function uniqueEmails(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const e = (raw ?? "").trim();
    if (e.includes("@") && !out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e);
  }
  return out;
}

/** Día en Córdoba (YYYY-MM-DD) para la clave de deduplicación del aviso. */
function todayKeyAR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba" }).format(new Date());
}

export async function submitOwnerLead(input: OwnerLeadInput): Promise<OwnerLeadResult> {
  // Honeypot: se responde "ok" para no darle pistas a un bot.
  if (typeof input?.website === "string" && input.website.trim() !== "") return { ok: true };

  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    const error = issue?.message ?? "Revisá los datos del formulario.";
    return isField(field) ? { ok: false, error, field } : { ok: false, error };
  }
  const lead = parsed.data;
  const email = lead.email.toLowerCase();
  const phoneDigits = digitsOnly(lead.phone);

  const ip = await clientIp();
  const [ipOk, contactOk] = await Promise.all([
    allowAttempt(`owner-lead:ip:${ip}`, 5, 60 * 60),
    allowAttempt(`owner-lead:contact:${shortHash(email)}`, 3, 24 * 60 * 60),
  ]);
  if (!ipOk || !contactOk) return { ok: false, error: RATE_LIMITED };

  const contact = await getSiteContact();
  const orgId = contact.organizationId;
  if (!orgId) {
    console.error("[owner-leads] no hay organización en la vidriera para recibir el contacto");
    return { ok: false, error: GENERIC_ERROR };
  }

  const admin = createAdminClient();
  const [orgRes, settings] = await Promise.all([
    admin.from("organizations").select("contact_email").eq("id", orgId).maybeSingle(),
    getResolvedWebSettingsFresh(orgId).catch(() => null),
  ]);
  const orgEmail = (orgRes.data as { contact_email: string | null } | null)?.contact_email ?? null;
  const recipients = uniqueEmails([orgEmail, settings?.publicEmail ?? contact.publicEmail]);
  const responseHours = settings?.responseHours ?? contact.responseHours;

  const phoneLabel = formatPhoneAR(lead.phone) ?? lead.phone;
  const firstName = lead.name.split(/\s+/)[0] ?? lead.name;
  const waUrl = whatsappLink(phoneDigits, `Hola ${firstName}, te escribimos de apart por tu departamento.`);
  const rows = [
    { label: "Nombre", value: lead.name },
    {
      label: "WhatsApp",
      value: phoneLabel,
      valueHtml: waUrl
        ? `<a href="${safeHref(waUrl)}" target="_blank" rel="noopener" style="color:${C.forest};font-weight:700;">${escapeHtml(phoneLabel)}</a>`
        : null,
    },
    { label: "Email", value: lead.email },
    { label: "Departamento", value: lead.address },
    { label: "Ambientes", value: lead.rooms ?? null },
    { label: "Mensaje", value: lead.message },
  ];
  const promise = `Le dijimos que le escribimos en menos de ${responseHours} ${responseHours === 1 ? "hora" : "horas"}.`;

  const { html } = renderApartEmail({
    preheader: `${lead.name} quiere que cuidemos su departamento (${lead.address}).`,
    title: "Un propietario quiere sumarse",
    intro: "Dejó sus datos en la página de Propietarios de la web. Respondé este mail para escribirle directo.",
    bodyHtml: detailRowsHtml(rows) + paragraphHtml(promise, { muted: true, small: true }),
    ...(waUrl ? { cta: { label: "Escribirle por WhatsApp", url: waUrl } } : {}),
    secondary: { label: "Abrir propietarios en el panel", url: absoluteUrl("/dashboard/propietarios") },
  });
  const text = [
    "Un propietario quiere sumarse.",
    "Dejó sus datos en la página de Propietarios de la web.",
    "",
    detailRowsText(rows),
    "",
    waUrl ? `Escribirle por WhatsApp: ${waUrl}` : null,
    promise,
    "",
    TEXT_SIGNATURE,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const sent = await Promise.all(
    recipients.map((to) =>
      sendApartEmail({
        organizationId: orgId,
        to,
        subject: `Propietario interesado: ${lead.name}`,
        html,
        text,
        replyTo: lead.email,
      }),
    ),
  );
  if (!recipients.length) console.warn("[owner-leads] la organización no tiene mail de contacto:", orgId);

  let inApp = false;
  try {
    const body = [lead.address, lead.rooms, phoneLabel, lead.email].filter(Boolean).join(" · ");
    const { error } = await admin.from("notifications").insert({
      organization_id: orgId,
      type: "manual",
      severity: "info",
      title: `Propietario interesado: ${lead.name}`,
      body: lead.message ? `${body}\n${lead.message.slice(0, 280)}` : body,
      ref_type: "owner_lead",
      ref_id: null,
      target_role: "admin",
      action_url: "/dashboard/propietarios",
      dedup_key: `owner-lead:${shortHash(`${email}|${phoneDigits}`)}:${todayKeyAR()}`,
    });
    // 23505 = el mismo contacto ya avisó hoy: el aviso ya está en el panel.
    inApp = !error || error.code === "23505";
    if (error && error.code !== "23505") console.warn("[owner-leads] in-app:", error.message);
  } catch (e) {
    console.warn("[owner-leads] in-app:", e);
  }

  if (!sent.some(Boolean) && !inApp) return { ok: false, error: GENERIC_ERROR };
  return { ok: true };
}
