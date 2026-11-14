import "server-only";

/**
 * Arma el contexto de Tex para un pedido (nov-2026): quién pregunta, de qué
 * organización, qué día es ALLÁ (no en el servidor, que corre en UTC) y desde
 * qué pantalla. Lo usan la route del chat y las acciones de confirmar.
 */
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz, tomorrowYmdInTz } from "@/lib/dates";
import { ROLE_META } from "@/lib/constants";
import type { Organization, UserProfile, UserRole } from "@/lib/types/database";
import { routeMeta } from "@/components/mobile/routes";
import type { ToolContext } from "./tool";
import { contextBlock } from "./prompt";
import { firstNameOf } from "./names";

export function buildToolContext(opts: {
  organization: Organization;
  role: UserRole;
  userId: string;
  profile: Pick<UserProfile, "full_name">;
  conversationId: string;
}): ToolContext {
  const tz = opts.organization.timezone || DEFAULT_ORG_TIMEZONE;
  return {
    org: {
      id: opts.organization.id,
      name: opts.organization.name,
      timezone: tz,
      currency: opts.organization.default_currency || "ARS",
      rentalsEnabled: Boolean(opts.organization.rentals_enabled),
    },
    user: {
      id: opts.userId,
      name: opts.profile.full_name ?? "",
      firstName: firstNameOf(opts.profile.full_name),
    },
    role: opts.role,
    today: todayYmdInTz(tz),
    tomorrow: tomorrowYmdInTz(tz),
    conversationId: opts.conversationId,
  };
}

/** El bloque `<contexto>` del turno, con la hora de la organización y la pantalla abierta. */
export function turnContext(ctx: ToolContext, pathname: string | null | undefined): string {
  const time = new Intl.DateTimeFormat("es-AR", {
    timeZone: ctx.org.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  let screen: string | null = null;
  if (pathname && pathname.startsWith("/")) {
    const meta = routeMeta(pathname, { role: ctx.role, rentalsEnabled: ctx.org.rentalsEnabled });
    screen = `${meta.title} (${pathname.slice(0, 120)})`;
  }
  return contextBlock({
    today: ctx.today,
    tomorrow: ctx.tomorrow,
    time,
    timezone: ctx.org.timezone,
    orgName: ctx.org.name,
    currency: ctx.org.currency,
    personName: ctx.user.firstName,
    roleLabel: ROLE_META[ctx.role]?.label ?? ctx.role,
    screen,
  });
}
