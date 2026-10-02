import Link from "next/link";
import { AlertCircle, CalendarClock, FileSignature, Plus, TrendingUp, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { SegmentedNav } from "@/components/results/results-mode-nav";
import { KpiCard, PageHeader } from "@/components/rentals/ui";
import { ContractsList } from "@/components/rentals/contracts/contracts-list";
import { ContractsOnboarding } from "@/components/rentals/contracts/contracts-onboarding";
import type { ContractListRow, ContractListView } from "@/components/rentals/contracts/types";
import { formatMoney } from "@/lib/format";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { loadContractList, viewOfRow } from "@/lib/rentals/server/contracts-queries";

export const metadata = { title: "Contratos · rentOS" };

const VIEWS: { key: ContractListView; label: string }[] = [
  { key: "vigentes", label: "Vigentes" },
  { key: "por_vencer", label: "Por vencer" },
  { key: "borradores", label: "Borradores" },
  { key: "terminados", label: "Terminados" },
];

function isView(v: unknown): v is ContractListView {
  return typeof v === "string" && VIEWS.some((x) => x.key === v);
}

/** Suma por moneda, ARS primero. */
function byCurrency(rows: ContractListRow[], pick: (r: ContractListRow) => number): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = pick(r);
    if (v > 0.004) m.set(r.currency, (m.get(r.currency) ?? 0) + v);
  }
  return [...m.entries()].sort((a, b) => (a[0] === "ARS" ? -1 : b[0] === "ARS" ? 1 : a[0].localeCompare(b[0])));
}

function moneyLines(list: [string, number][]): { main: string; extra: string | null } {
  if (!list.length) return { main: formatMoney(0, "ARS"), extra: null };
  return { main: formatMoney(list[0][1], list[0][0]), extra: list.slice(1).map(([c, v]) => formatMoney(v, c)).join(" · ") || null };
}

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireRentalsPage();
  const sp = await searchParams;
  const result = await loadContractList(ctx);
  const requested = Array.isArray(sp.vista) ? sp.vista[0] : sp.vista;
  const view: ContractListView = isView(requested)
    ? requested
    : result.counts.vigentes === 0 && result.counts.borradores > 0
      ? "borradores"
      : "vigentes";
  const rows = result.rows
    .filter((r) => viewOfRow(r).includes(view))
    .sort((a, b) =>
      view === "por_vencer"
        ? a.endDate.localeCompare(b.endDate)
        : view === "terminados"
          ? (b.terminatedAt ?? b.endDate).localeCompare(a.terminatedAt ?? a.endDate)
          : 0,
    );
  const live = result.rows.filter((r) => r.status === "vigente");
  const rent = moneyLines(byCurrency(live, (r) => r.currentRent));
  const overdue = byCurrency(live, (r) => r.overdue);
  const overdueLines = moneyLines(overdue);
  const debtors = live.filter((r) => r.overdue > 0.004).length;
  const adjusting = live.filter((r) => r.adjustsThisMonth).length;

  const subtitle =
    result.total === 0
      ? "Contratos de alquiler tradicional: plazos, ajustes por índice y cobranza."
      : [
          `${result.counts.vigentes} vigente${result.counts.vigentes === 1 ? "" : "s"}`,
          result.counts.por_vencer ? `${result.counts.por_vencer} por vencer` : null,
          result.counts.borradores ? `${result.counts.borradores} en borrador` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh
        tables={["rental_contracts", "rental_adjustments", "rental_charges", "rental_payments"]}
        label="cambio"
        labelPlural="cambios"
        throttleMs={5_000}
      />
      <PageHeader
        icon={FileSignature}
        title="Contratos"
        subtitle={subtitle}
        actions={
          <>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/dashboard/alquileres/personas">
                <Users size={14} /> <span className="hidden sm:inline">Inquilinos y garantes</span>
                <span className="sm:hidden">Personas</span>
              </Link>
            </Button>
            <Button asChild className="gap-2">
              <Link href="/dashboard/alquileres/contratos/nuevo">
                <Plus size={16} /> Nuevo contrato
              </Link>
            </Button>
          </>
        }
      />

      {result.total === 0 ? (
        <ContractsOnboarding />
      ) : (
        <>
          {view === "vigentes" && live.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard
                icon={Wallet}
                label="Alquileres por mes"
                value={rent.main}
                hint={rent.extra ?? `${live.length} contrato${live.length === 1 ? "" : "s"} vigente${live.length === 1 ? "" : "s"}`}
              />
              <KpiCard
                icon={AlertCircle}
                label="Deuda vencida"
                value={overdueLines.main}
                tone={debtors ? "out" : "neutral"}
                hint={debtors ? `${debtors} inquilino${debtors === 1 ? " debe" : "s deben"}${overdueLines.extra ? ` · ${overdueLines.extra}` : ""}` : "Nadie debe nada vencido"}
              />
              <KpiCard
                icon={TrendingUp}
                label="Ajustan este mes"
                value={adjusting}
                tone={adjusting ? "warn" : "neutral"}
                hint={adjusting ? "Avisales el precio nuevo" : "Ningún ajuste este mes"}
              />
              <KpiCard
                icon={CalendarClock}
                label="Por vencer"
                value={result.counts.por_vencer}
                tone={result.counts.por_vencer ? "warn" : "neutral"}
                hint={result.counts.por_vencer ? "Terminan en 90 días: pensá en la renovación" : "Ninguno en los próximos 90 días"}
                href={result.counts.por_vencer ? "/dashboard/alquileres/contratos?vista=por_vencer" : undefined}
              />
            </div>
          )}
          <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1">
            <SegmentedNav
              label="Estado de los contratos"
              items={VIEWS.map((v) => ({
                key: v.key,
                label: result.counts[v.key] ? `${v.label} · ${result.counts[v.key]}` : v.label,
                href: `/dashboard/alquileres/contratos?vista=${v.key}`,
                active: v.key === view,
              }))}
            />
          </div>
          <ContractsList key={view} rows={rows} view={view} />
        </>
      )}
    </div>
  );
}
