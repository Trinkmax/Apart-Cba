"use server";

/**
 * Buscador global (nov-2026): reservas, huéspedes, unidades, propietarios y
 * movimientos de Caja con un solo texto. Lo usan la hoja «Más» del celular
 * (desde el navegador, mientras se tipea) y Tex (`buscar`).
 *
 * Cada fuente corre en paralelo y por separado (`Promise.allSettled`): si una
 * falla, las otras responden igual. Cada una pide su permiso (`can(role, …,
 * "view")`) y los links salen según el rol, para no llevar a nadie a una
 * pantalla que lo rebota. Los errores se DEVUELVEN: en producción Next
 * enmascara el mensaje de todo lo que se lanza desde una Server Action.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { can, isAdminLevel } from "@/lib/permissions";
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz } from "@/lib/dates";
import { clip, fold, money, shortDate } from "@/lib/tex/format";
import {
  bookingStatusLabel,
  cashCategoryLabel,
  localYmd,
  sourceLabel,
  stayLabel,
  unitLabel,
} from "@/lib/tex/tools/read/_shared";
import type { UserRole } from "@/lib/types/database";
import { getSession } from "./auth";
import { getCurrentOrg } from "./org";
import { searchBookingsGlobal } from "./bookings";
import { searchGuests } from "./guests";
import { listUnitRefs } from "./units";
import { listOwners } from "./owners";
import { searchCashMovements } from "./cash";

export type GlobalSearchHit = {
  kind: "reserva" | "huesped" | "unidad" | "propietario" | "movimiento";
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  href: string;
};

type SearchEnv = { q: string; fq: string; per: number; role: UserRole; orgId: string; tz: string; today: string };

/** La ficha de una unidad, según adónde puede ir cada rol. */
function unitHref(role: UserRole, unitId: string): string {
  if (isAdminLevel(role)) return `/dashboard/unidades/${unitId}`;
  // El propietario no abre la ficha (lista blanca de route-access): va al calendario.
  if (role === "owner_view") return "/dashboard/unidades/kanban";
  // Limpieza y mantenimiento viven en /m: los consejos del depto.
  return `/m/consejos/${unitId}`;
}

async function bookingHits(env: SearchEnv): Promise<GlobalSearchHit[]> {
  const rows = await searchBookingsGlobal(env.q, env.per);
  // searchBookingsGlobal no mira `is_block`: un cierre de calendario de la OTA
  // no es una reserva. Los cierres nunca tienen huésped, así que alcanza con
  // revisar las filas sin huésped (una consulta, y casi nunca).
  const guestless = rows.filter((r) => !r.guest).map((r) => r.id);
  let blocks = new Set<string>();
  if (guestless.length > 0) {
    const { data, error } = await createAdminClient()
      .from("bookings")
      .select("id")
      .eq("organization_id", env.orgId)
      .in("id", guestless)
      .eq("is_block", true);
    if (!error) blocks = new Set((data ?? []).map((r) => r.id as string));
  }
  return rows
    .filter((r) => !blocks.has(r.id))
    .map((r) => ({
      kind: "reserva" as const,
      id: r.id,
      title: r.guest?.full_name?.trim() || "Sin huésped cargado",
      subtitle: `${unitLabel(r.unit)} · ${stayLabel(r.check_in_date, r.check_out_date, env.today)}`,
      meta: [bookingStatusLabel(r.status), sourceLabel(r.source), r.external_id].filter(Boolean).join(" · "),
      href: `/dashboard/reservas/${r.id}`,
    }));
}

async function guestHits(env: SearchEnv): Promise<GlobalSearchHit[]> {
  const rows = await searchGuests(env.q);
  return rows.slice(0, env.per).map((g) => ({
    kind: "huesped" as const,
    id: g.id,
    title: g.full_name,
    subtitle: [g.phone, g.email, g.document_number].filter(Boolean).join(" · ") || undefined,
    meta: g.total_bookings > 0 ? `${g.total_bookings} ${g.total_bookings === 1 ? "estadía" : "estadías"}` : undefined,
    // Los huéspedes no tienen ficha propia: la lista abre el perfil.
    href: "/dashboard/huespedes",
  }));
}

async function unitHits(env: SearchEnv): Promise<GlobalSearchHit[]> {
  const units = await listUnitRefs();
  return units
    .map((u) => {
      const code = fold(u.code);
      const name = fold(u.name);
      const title = fold(u.marketplace_title);
      const score =
        code === env.fq || name === env.fq
          ? 3
          : code.startsWith(env.fq) || name.startsWith(env.fq)
            ? 2
            : code.includes(env.fq) || name.includes(env.fq) || title.includes(env.fq) || (code.length >= 3 && env.fq.includes(code))
              ? 1
              : 0;
      return { u, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.u.code.localeCompare(b.u.code))
    .slice(0, env.per)
    .map(({ u }) => ({
      kind: "unidad" as const,
      id: u.id,
      title: unitLabel(u),
      subtitle: u.marketplace_title && fold(u.marketplace_title) !== fold(u.name) ? u.marketplace_title : undefined,
      href: unitHref(env.role, u.id),
    }));
}

async function ownerHits(env: SearchEnv): Promise<GlobalSearchHit[]> {
  const owners = await listOwners();
  const digits = env.q.replace(/\D/g, "");
  return owners
    .filter((o) => {
      if (fold(o.full_name).includes(env.fq) || fold(o.email).includes(env.fq)) return true;
      if (o.document_number && fold(o.document_number).includes(env.fq)) return true;
      return digits.length >= 6 && (o.phone ?? "").replace(/\D/g, "").includes(digits);
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.full_name.localeCompare(b.full_name))
    .slice(0, env.per)
    .map((o) => {
      const codes = (o.unit_owners ?? []).map((uo) => uo.unit?.code).filter(Boolean) as string[];
      const units = codes.length > 4 ? `${codes.slice(0, 4).join(", ")} y ${codes.length - 4} más` : codes.join(", ");
      return {
        kind: "propietario" as const,
        id: o.id,
        title: o.full_name,
        subtitle: units || undefined,
        meta: o.active ? undefined : "Inactivo",
        href: `/dashboard/propietarios/${o.id}`,
      };
    });
}

async function movementHits(env: SearchEnv): Promise<GlobalSearchHit[]> {
  const r = await searchCashMovements({ query: env.q, offset: 0, limit: Math.min(env.per, 5), withTotals: false });
  if (!r.ok) throw new Error(r.error);
  return r.rows.map((m) => {
    const ymd = localYmd(m.occurred_at, env.tz);
    return {
      kind: "movimiento" as const,
      id: m.id,
      title: `${m.direction === "in" ? "+" : "−"}${money(Math.abs(m.amount), m.currency)} · ${clip(m.description, 80) ?? cashCategoryLabel(m.category)}`,
      subtitle:
        [m.party_name, m.place_label ?? m.unit?.code ?? null, m.account?.name].filter(Boolean).join(" · ") || undefined,
      meta: ymd ? shortDate(ymd, env.today) : undefined,
      href: `/dashboard/caja/${m.account_id}`,
    };
  });
}

/** Busca en todo lo que el rol puede ver. Nunca lanza. */
export async function searchEverything(
  query: string,
  opts?: { limit?: number },
): Promise<{ ok: true; hits: GlobalSearchHit[] } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Tu sesión se cerró. Volvé a entrar." };
  const q = String(query ?? "").trim().slice(0, 120);
  if (q.length < 2) return { ok: true, hits: [] };

  // getCurrentOrg redirige (sin membresía, superadmin sin org): adentro de una
  // action eso sería una navegación a ciegas. Se devuelve como error.
  let current: Awaited<ReturnType<typeof getCurrentOrg>>;
  try {
    current = await getCurrentOrg();
  } catch {
    return { ok: false, error: "No hay una organización activa para buscar." };
  }
  const { organization, role } = current;
  const tz = organization.timezone || DEFAULT_ORG_TIMEZONE;
  const env: SearchEnv = {
    q,
    fq: fold(q),
    per: Math.max(1, Math.min(20, Math.trunc(Number(opts?.limit) || 8))),
    role,
    orgId: organization.id,
    tz,
    today: todayYmdInTz(tz),
  };

  const sources: Array<[string, () => Promise<GlobalSearchHit[]>]> = [];
  if (can(role, "bookings", "view")) sources.push(["reservas", () => bookingHits(env)]);
  if (can(role, "guests", "view")) sources.push(["huéspedes", () => guestHits(env)]);
  if (can(role, "units", "view")) sources.push(["unidades", () => unitHits(env)]);
  if (can(role, "owners", "view")) sources.push(["propietarios", () => ownerHits(env)]);
  if (can(role, "cash", "view") && role !== "owner_view") sources.push(["caja", () => movementHits(env)]);
  if (sources.length === 0) return { ok: true, hits: [] };

  const settled = await Promise.allSettled(sources.map(([, run]) => run()));
  const hits: GlobalSearchHit[] = [];
  let failed = 0;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") hits.push(...s.value);
    else {
      failed++;
      console.error(`[global-search] ${sources[i][0]}`, s.reason);
    }
  });
  if (failed === sources.length) return { ok: false, error: "No se pudo buscar. Probá de nuevo en un momento." };
  return { ok: true, hits };
}
