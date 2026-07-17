/**
 * Normalización y dedupe de huéspedes provenientes de OTAs.
 *
 * Reglas (ver mandato de canales):
 *  - emails a lowercase; teléfonos a E.164 solo si es inequívoco
 *  - dedupe por referencia externa, email exacto o teléfono exacto — nunca por
 *    nombre genérico
 *  - NO se crean guests para "Huésped Airbnb", "Guest", "Blocked" y similares
 *  - el guest se crea/enlaza únicamente DESPUÉS de proyectar la reserva
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

const GENERIC_NAMES = new RegExp(
  "^(" +
    [
      "hu[ée]sped(\\s+(airbnb|booking))?",
      "guest",
      "blocked?",
      "reserved",
      "reservation",
      "airbnb(\\s*\\(not available\\))?",
      "booking(\\.com)?",
      "not available",
      "closed(\\s*-\\s*not available)?",
      "unavailable",
      "sin nombre",
      "hu[ée]sped sin nombre",
    ].join("|") +
    ")$",
  "i",
);

export function isGenericGuestName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (n.length < 3) return true;
  return GENERIC_NAMES.test(n);
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (!e) return null;
  // regla mínima: user@dominio.tld — preferimos descartar antes que guardar basura
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return null;
  return e;
}

/**
 * Normaliza a E.164 solo cuando es inequívoco (venía con "+" o "00").
 * Un número local sin código de país NO se adivina: devolvemos null y el raw
 * queda como metadata en channel_reservations.guest.phone_raw.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const hadPlus = s.startsWith("+");
  const hadIntlPrefix = /^00\d/.test(s.replace(/[\s\-().]/g, ""));
  const digits = s.replace(/[^\d]/g, "").replace(/^00/, "");
  if (!hadPlus && !hadIntlPrefix) return null;
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

export interface GuestInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface GuestResolution {
  guestId: string | null;
  action: "linked" | "created" | "skipped";
  reason?: "generic_name" | "no_data";
}

/**
 * Busca (email exacto → teléfono exacto) o crea un huésped. Nunca crea para
 * nombres genéricos sin nombre real. Si encuentra uno existente, completa
 * campos faltantes (sin pisar datos cargados a mano).
 */
export async function resolveGuest(
  admin: AdminClient,
  orgId: string,
  input: GuestInput,
): Promise<GuestResolution> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhoneE164(input.phone);
  const name = (input.name ?? "").trim();
  const hasRealName = !isGenericGuestName(name);

  if (!email && !phone && !hasRealName) {
    return { guestId: null, action: "skipped", reason: hasRealName ? "no_data" : "generic_name" };
  }

  // 1) email exacto
  if (email) {
    const { data } = await admin
      .from("guests")
      .select("id, email, phone, full_name")
      .eq("organization_id", orgId)
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (data) {
      await fillMissing(admin, data, { email, phone, name: hasRealName ? name : null });
      return { guestId: data.id, action: "linked" };
    }
  }

  // 2) teléfono exacto (E.164)
  if (phone) {
    const { data } = await admin
      .from("guests")
      .select("id, email, phone, full_name")
      .eq("organization_id", orgId)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();
    if (data) {
      await fillMissing(admin, data, { email, phone, name: hasRealName ? name : null });
      return { guestId: data.id, action: "linked" };
    }
  }

  // 3) crear — solo con nombre real (no inventamos identidades)
  if (!hasRealName) {
    return { guestId: null, action: "skipped", reason: "generic_name" };
  }

  const { data: created, error } = await admin
    .from("guests")
    .insert({
      organization_id: orgId,
      full_name: name,
      email,
      phone,
    })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`No se pudo crear el huésped: ${error?.message ?? "sin datos"}`);
  }
  return { guestId: created.id, action: "created" };
}

async function fillMissing(
  admin: AdminClient,
  existing: { id: string; email: string | null; phone: string | null; full_name: string | null },
  next: { email: string | null; phone: string | null; name: string | null },
): Promise<void> {
  const patch: Record<string, string> = {};
  if (!existing.email && next.email) patch.email = next.email;
  if (!existing.phone && next.phone) patch.phone = next.phone;
  if (next.name && isGenericGuestName(existing.full_name)) patch.full_name = next.name;
  if (Object.keys(patch).length === 0) return;
  await admin.from("guests").update(patch).eq("id", existing.id);
}
