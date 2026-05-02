import { getCurrentOrg } from "@/lib/actions/org";
import { getSession } from "@/lib/actions/auth";
import { getDaypart, getFirstName } from "@/lib/contextual-messages";
import { formatDate } from "@/lib/format";
import { ContextualMessage } from "./contextual-message";

/**
 * Saludo principal del dashboard. Server component — la franja horaria
 * cambia naturalmente con cada render (el dashboard es no-store).
 *
 * UX:
 *  - Saluda con el primer nombre del usuario (no la org).
 *  - Tres franjas horarias en zona Argentina/Córdoba.
 *  - Línea contextual hidratada en cliente (clima/día/motivacional)
 *    para no bloquear el TTFB.
 */
export async function DashboardGreeting() {
  const [{ organization, role }, session] = await Promise.all([
    getCurrentOrg(),
    getSession(),
  ]);

  const firstName = getFirstName(session?.profile.full_name, organization.name);
  const { greeting } = getDaypart();

  // Día capitalizado.
  const dateLong = formatDate(new Date(), "EEEE d 'de' MMMM, yyyy");
  const datePretty = dateLong.charAt(0).toUpperCase() + dateLong.slice(1);

  return (
    <div className="space-y-1 sm:space-y-1.5 min-w-0">
      <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">
        {greeting},{" "}
        <span className="brand-text-gradient">{firstName}</span>
      </h1>
      <ContextualMessage
        firstName={firstName}
        userId={session?.userId ?? "anon"}
      />
      <p className="text-[10px] sm:text-xs text-muted-foreground/80">
        {datePretty} · Rol: {role}
      </p>
    </div>
  );
}
