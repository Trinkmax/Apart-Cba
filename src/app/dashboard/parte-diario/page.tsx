import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings2, Users } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import {
  getParteDiario,
  listAssignableForMaintenance,
  listAssignableForTareas,
  listParteDiarioRecipients,
} from "@/lib/actions/parte-diario";
import { Button } from "@/components/ui/button";
import { SummaryChips } from "@/components/parte-diario/summary-chips";
import { StatusPill } from "@/components/parte-diario/status-pill";
import { BookingsSection } from "@/components/parte-diario/bookings-section";
import { SuciosSection } from "@/components/parte-diario/sucios-section";
import { MaintenanceSection } from "@/components/parte-diario/maintenance-section";
import { TareasSection } from "@/components/parte-diario/tareas-section";
import { CleanerLoadsBanner } from "@/components/parte-diario/cleaner-loads-banner";
import { ActionBar } from "@/components/parte-diario/action-bar";
import { DateNav } from "@/components/parte-diario/date-nav";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ date?: string }>;
}

function ymdInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export default async function ParteDiarioPage({ searchParams }: PageProps) {
  const { role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "view")) redirect("/dashboard");
  const canEdit = can(role, "parte_diario", "update");

  const sp = await searchParams;
  const requestedDate = sp.date ?? undefined;
  const payload = await getParteDiario(requestedDate);
  const [recipients, maintenanceAssignables, tareasAssignables] = await Promise.all([
    listParteDiarioRecipients().catch(() => []),
    listAssignableForMaintenance().catch(() => []),
    listAssignableForTareas().catch(() => []),
  ]);

  const now = new Date();
  const todayInTz = ymdInTimezone(now, payload.settings.timezone);
  const tomorrowInTz = addDaysToYmd(todayInTz, 1);

  const status = payload.report?.status ?? "borrador";

  return (
    <div className="flex flex-col min-h-[calc(100svh-4rem)]">
      <div className="flex-1 px-4 sm:px-6 py-6 space-y-5">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide">Parte diario</span>
              <span>·</span>
              <StatusPill status={status} />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">{payload.date_label}</h1>
            <p className="text-sm text-muted-foreground">
              {payload.organization_name} ·{" "}
              {payload.settings.timezone.split("/").pop()?.replace("_", " ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateNav date={payload.date} todayInTz={todayInTz} tomorrowInTz={tomorrowInTz} />
            {canEdit ? (
              <>
                <Button variant="outline" size="sm" asChild className="gap-1.5">
                  <Link href="/dashboard/parte-diario/destinatarios">
                    <Users className="size-3.5" />
                    Destinatarios
                  </Link>
                </Button>
                <Button variant="outline" size="sm" asChild className="gap-1.5">
                  <Link href="/dashboard/parte-diario/configuracion">
                    <Settings2 className="size-3.5" />
                    Configuración
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
        </header>

        <SummaryChips
          chips={[
            { key: "check_outs", count: payload.check_outs.length },
            { key: "check_ins", count: payload.check_ins.length },
            { key: "sucios", count: payload.sucios.length },
            { key: "tareas_pendientes", count: payload.tareas_pendientes.length },
            { key: "arreglos", count: payload.arreglos.length },
          ]}
        />

        {/* Fila 1: CH IN (izquierda) | CH OUT (derecha) — paralelos para
            comparar movimientos del día de un vistazo */}
        <div className="grid gap-4 lg:grid-cols-2">
          <BookingsSection
            sectionKey="check_ins"
            rows={payload.check_ins}
            emptyMessage="Sin check-ins."
          />
          <BookingsSection
            sectionKey="check_outs"
            rows={payload.check_outs}
            emptyMessage="Sin check-outs."
          />
        </div>

        {/* Banner: Carga del equipo — full-width, da contexto antes de asignar */}
        <CleanerLoadsBanner loads={payload.cleaner_loads} />

        {/* Fila 2: Mantenimiento | Sucios | Tareas. SUCIOS al centro porque
            es la columna con más interacción y mayor prioridad operativa
            (asignación de limpieza). */}
        <div className="grid gap-4 lg:grid-cols-3">
          <MaintenanceSection
            rows={payload.arreglos}
            assignables={maintenanceAssignables}
            canEdit={canEdit}
            emptyMessage="Sin arreglos pendientes."
          />
          <SuciosSection
            date={payload.date}
            rows={payload.sucios}
            cleaners={payload.cleaner_loads}
            canEdit={canEdit}
          />
          <TareasSection
            rows={payload.tareas_pendientes}
            assignables={tareasAssignables}
            canEdit={canEdit}
            emptyMessage="Sin tareas pendientes desde el módulo Tareas."
          />
        </div>

        {!payload.settings.enabled || !payload.settings.channel_id ? (
          <ConfigCallout
            enabled={payload.settings.enabled}
            channelMissing={!payload.settings.channel_id}
          />
        ) : null}
      </div>

      <ActionBar
        date={payload.date}
        snapshot={payload}
        report={payload.report}
        settings={payload.settings}
        recipients={recipients}
        canEdit={canEdit}
      />
    </div>
  );
}

function ConfigCallout({ enabled, channelMissing }: { enabled: boolean; channelMissing: boolean }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
      <Settings2 className="size-4 text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-400">
          {!enabled
            ? "El parte diario automático está deshabilitado"
            : "Falta configurar el canal de WhatsApp"}
        </p>
        <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
          {!enabled
            ? "Activalo para que se genere automáticamente cada noche."
            : "El canal define desde qué número WA se envía el parte."}
          {channelMissing
            ? " Sin canal podés revisar y descargar el PDF, pero no enviarlo."
            : null}
        </p>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link href="/dashboard/parte-diario/configuracion">Configurar</Link>
      </Button>
    </div>
  );
}
