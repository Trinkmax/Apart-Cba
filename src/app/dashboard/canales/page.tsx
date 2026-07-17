import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Cable,
  Plus,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  Stethoscope,
} from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getChannelsOverview } from "@/lib/actions/channels";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConnectionsTable } from "@/components/canales/connections-table";
import { IssuesPanel } from "@/components/canales/issues-panel";
import { EmailSettingsCard } from "@/components/canales/email-settings-card";
import { SyncNowButton } from "@/components/canales/sync-now-button";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

export const dynamic = "force-dynamic";

/**
 * Canales de venta — la única pantalla del channel manager. Responde de
 * entrada: ¿estoy protegido? ¿cuándo llegó lo último? ¿qué tengo que resolver?
 */
export default async function CanalesPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "channels", "view")) redirect("/dashboard");

  const overview = await getChannelsOverview();
  const { links, issues } = overview;

  const active = links.filter((l) => l.status === "active");
  const airbnb = links.filter((l) => l.channel === "airbnb");
  const booking = links.filter((l) => l.channel === "booking");
  const airbnbOk = airbnb.filter((l) => l.health_state === "healthy" || l.health_state === "verifying").length;
  const bookingOk = booking.filter((l) => l.health_state === "healthy" || l.health_state === "verifying").length;
  const critical = links.filter((l) => l.health_state === "critical").length;
  const degraded = links.filter((l) => l.health_state === "degraded").length;
  const conflicts = issues.filter((i) => i.issue_type === "conflict").length;
  const lastCheck = active.reduce<string | null>(
    (acc, l) => (l.last_success_at && (!acc || l.last_success_at > acc) ? l.last_success_at : acc),
    null,
  );

  const overall =
    critical > 0 || conflicts > 0 ? "critical" : degraded > 0 || issues.length > 0 ? "warning" : "ok";
  const OverallIcon = overall === "ok" ? ShieldCheck : overall === "warning" ? ShieldAlert : ShieldX;
  const overallText =
    overall === "ok"
      ? active.length > 0
        ? "Protección por calendario activa"
        : "Sin conexiones activas todavía"
      : overall === "warning"
        ? "Protección activa, con puntos para revisar"
        : "Acción requerida: hay departamentos en riesgo";
  const overallClass =
    overall === "ok"
      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
      : overall === "warning"
        ? "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/25"
        : "text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/25";

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Cable className="size-5 text-primary" />
            Canales de venta
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reservas y disponibilidad sincronizadas con Airbnb y Booking. La demora final de
            actualización depende de cada plataforma.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncNowButton disabled={active.length === 0} />
          <Button asChild className="gap-1.5">
            <Link href="/dashboard/canales/conectar">
              <Plus size={15} /> Conectar departamento
            </Link>
          </Button>
        </div>
      </div>

      {/* Estado general de protección */}
      <Card className={`p-4 border ${overallClass}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <OverallIcon className="size-5 shrink-0" />
          <span className="font-medium text-sm">{overallText}</span>
          <span className="text-xs opacity-80 flex items-center gap-1 ml-auto">
            <Clock size={12} />
            {lastCheck
              ? `Última revisión ${formatDistanceToNow(new Date(lastCheck), { addSuffix: true, locale: es })}`
              : "Sin revisiones todavía"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Airbnb conectadas" value={`${airbnbOk}/${airbnb.length}`} />
          <Stat label="Booking conectadas" value={`${bookingOk}/${booking.length}`} />
          <Stat
            label="Requieren atención"
            value={String(critical + degraded)}
            tone={critical > 0 ? "critical" : degraded > 0 ? "warning" : undefined}
          />
          <Stat
            label="Esperando datos del huésped"
            value={String(overview.awaitingData)}
            tone={overview.awaitingData > 0 ? "info" : undefined}
          />
        </div>
      </Card>

      {/* Incidencias accionables */}
      <IssuesPanel issues={issues} units={overview.units} />

      {/* Matriz de conexiones */}
      <ConnectionsTable links={links} />

      {/* Email por organización + diagnóstico secundario */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EmailSettingsCard
          emailAddress={overview.emailAddress}
          verifiedAt={overview.settings?.email_verified_at ?? null}
          lastEmailAt={overview.settings?.last_email_at ?? null}
        />
        <Card className="p-4 sm:p-5 space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Stethoscope size={15} /> Diagnóstico
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Cada conexión sana se revisa automáticamente cada 5 minutos. El detalle técnico de cada
            departamento (lecturas, reservas externas, incidencias) está en su ficha.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Importante: que la OTA haya consultado nuestro calendario confirma el enlace, pero Airbnb
            y Booking deciden cuándo vuelven a leerlo — la sincronización por calendario no es
            instantánea.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "critical" | "warning" | "info";
}) {
  const toneClass =
    tone === "critical"
      ? "text-rose-700 dark:text-rose-400"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "info"
          ? "text-sky-700 dark:text-sky-400"
          : "";
  return (
    <div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
