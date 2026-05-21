// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;
import type { ParsedBookingEvent } from "./types";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Lookup determin\u00edstico contra ota_listings. Si la OTA puso el listing_id en
 * el email y el operador configur\u00f3 el mapping en /dashboard/channel-manager,
 * resuelve sin ambig\u00fcedad. Se llama antes del matcher fuzzy.
 */
export async function matchUnitByListingId(
  admin: AdminClient,
  orgId: string,
  provider: ParsedBookingEvent["source"],
  externalListingId: string | undefined,
): Promise<string | null> {
  if (!externalListingId) return null;
  const { data } = await admin
    .from("ota_listings")
    .select("unit_id")
    .eq("organization_id", orgId)
    .eq("provider", provider)
    .eq("external_listing_id", externalListingId)
    .eq("active", true)
    .maybeSingle();
  return data?.unit_id ?? null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

export interface MatchResult {
  unitId: string;
  unitCode: string;
  ambiguous: boolean;
}

/**
 * Match fuzzy del listing hint contra units.code, units.name, units.marketplace_title.
 */
export async function matchUnit(
  admin: AdminClient,
  orgId: string,
  hint: string | undefined
): Promise<MatchResult | null> {
  if (!hint) return null;

  const { data: units } = await admin
    .from("units")
    .select("id, code, name, marketplace_title")
    .eq("organization_id", orgId)
    .eq("active", true);
  if (!units || units.length === 0) return null;

  const normalHint = normalize(hint);
  type ScoredUnit = { id: string; code: string; score: number };
  const candidates: ScoredUnit[] = [];

  for (const u of units) {
    const fields = [u.code, u.name, u.marketplace_title].filter(Boolean).map(normalize);

    // Exact substring match — highest priority
    if (fields.some((f) => f.includes(normalHint) || normalHint.includes(f))) {
      candidates.push({ id: u.id, code: u.code, score: 0 });
      continue;
    }

    // Levenshtein for strings >= 5 chars
    if (normalHint.length >= 5) {
      const minDist = Math.min(...fields.map((f) => levenshtein(f, normalHint)));
      if (minDist <= 3) {
        candidates.push({ id: u.id, code: u.code, score: minDist });
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  const ambiguous = candidates.filter((c) => c.score === best.score).length > 1;

  return { unitId: best.id, unitCode: best.code, ambiguous };
}

/**
 * Busca guest por email → phone → nombre, o crea uno nuevo.
 */
export async function findOrCreateGuest(
  admin: AdminClient,
  orgId: string,
  parsed: ParsedBookingEvent
): Promise<string> {
  // Search by email
  if (parsed.guestEmail) {
    const { data } = await admin
      .from("guests")
      .select("id")
      .eq("organization_id", orgId)
      .eq("email", parsed.guestEmail)
      .maybeSingle();
    if (data) return data.id;
  }

  // Search by phone
  if (parsed.guestPhone) {
    const { data } = await admin
      .from("guests")
      .select("id")
      .eq("organization_id", orgId)
      .eq("phone", parsed.guestPhone)
      .maybeSingle();
    if (data) return data.id;
  }

  // Search by name (exact)
  if (parsed.guestName) {
    const { data } = await admin
      .from("guests")
      .select("id")
      .eq("organization_id", orgId)
      .eq("full_name", parsed.guestName)
      .maybeSingle();
    if (data) return data.id;
  }

  // Create new guest
  const { data: newGuest, error } = await admin
    .from("guests")
    .insert({
      organization_id: orgId,
      full_name: parsed.guestName || "Huésped sin nombre",
      email: parsed.guestEmail ?? null,
      phone: parsed.guestPhone ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Error creando huésped: ${error.message}`);
  return newGuest.id;
}
