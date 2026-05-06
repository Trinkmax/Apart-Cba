import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings2, Users } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import {
  getParteDiario,
  listParteDiarioRecipients,
  listAssignableCleaners,
} from "@/lib/actions/parte-diario";
import { Button } from "@/components/ui/button";
import { SummaryChips } from "@/components/parte-diario/summary-chips";
import { StatusPill } from "@/components/parte-diario/status-pill";
import { BookingsSection } from "@/components/parte-diario/bookings-section";
import { SuciosSection } from "@/components/parte-diario/sucios-section";
import { MaintenanceSection } from "@/components/parte-diario/maintenance-section";
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

  const params = await searchParams;
  const requestedDate = params.date ?? undefined;
  const payload = await getParteDiario(requestedDate);
  const [recipients, cleaners] = await Promise.all([
    listParteDiarioRecipients().catch(() => []),
    listAssignableCleaners().catch(() => []),
  ]);

  const now = new Date();
  const todayInTz = ymdInTimezone(now, payload.settings.timezone);
  const tomorrowInTz = addDaysToYmd(todayInTz, 1);

  const status = payload.report?.status ?? "borrador";

  return (
    <div className="flex flex-col min-h-[calc(100svh-4rem)]">
      <div className="flex-1 px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide">Parte diario</span>
              <span>·</span>
              <StatusPill status={status} />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              {payload.date_label}
            </h1>
            <p className="text-sm text-muted-foreground">
              {payload.organization_name} · {payload.settings.timezone.split("/").pop()?.replace("_", " ")}
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

        {/* Grid: a partir de lg ponemos 2 columnas. CH OUT/IN/SUCIOS a la izq,
            TAREAS/ARREGLOS a la der. SUCIOS es la columna interactiva (asignación). */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <BookingsSection
              sectionKey="check_outs"
              rows={payload.check_outs}
              emptyMessage="Sin check-outs."
            />
            <BookingsSection
              sectionKey="check_ins"
              rows={payload.check_ins}
              emptyMessage="Sin check-ins."
            />
            <SuciosSection
              date={payload.date}
              rows={payload.sucios}
              cleaners={payload.cleaner_loads}
              canEdit={canEdit}
            />
          </div>
          <div className="space-y-4">
            <MaintenanceSection
              sectionKey="tareas_pendientes"
              rows={payload.tareas_pendientes}
              showPriority={false}
              emptyMessage="Sin tareas menores pendientes."
            />
            <MaintenanceSection
              sectionKey="arreglos"
              rows={payload.arreglos}
              showPriority={true}
              emptyMessage="Sin arreglos pendientes."
            />
            {/* Mini panel de carga del equipo — útil para ver el balance al asignar. */}
            {payload.cleaner_loads.length > 0 ? (
              <CleanerLoads loads={payload.cleaner_loads} />
            ) : null}
          </div>
        </div>

        {/* Aviso de configuración faltante */}
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

      {/* hidden — lo usamos para que TS no marque cleaners como unused si se reusara. */}
      <div className="hidden" aria-hidden>
        {cleaners.length}
      </div>
    </div>
  );
}

function CleanerLoads({
  loads,
}: {
  loads: { user_id: string; full_name: string; count: number }[];
}) {
  const max = Math.max(...loads.map((l) => l.count), 1);
  return (
    <section className="rounded-2xl border bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b bg-muted/30">
        <h2 className="text-sm font-semibold">Carga del equipo</h2>
        <span className="text-xs text-muted-foreground">Tareas asignadas para el día</span>
      </header>
      <ul className="divide-y">
        {loads.map((l) => (
          <li key={l.user_id} className="flex items-center gap-3 px-5 py-2.5">
            <span className="text-sm font-medium flex-1 truncate">{l.full_name}</span>
            <div className="flex items-center gap-2 w-40">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all"
                  style={{ width: `${(l.count / max) * 100}%` }}
                />
              </div>
              <span className="text-xs tabular-nums w-6 text-right">{l.count}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
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
