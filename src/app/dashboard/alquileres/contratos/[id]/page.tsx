import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarRange, DoorOpen, FileSignature, History, MapPin, RefreshCcw, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { RENTALS_ACCENT, StatusBadge } from "@/components/rentals/ui";
import { ContinuationBillingButton, ContractActions, DraftBanner } from "@/components/rentals/contracts/contract-actions";
import { ContractHistory } from "@/components/rentals/contracts/contract-history";
import { ContractOverview } from "@/components/rentals/contracts/contract-overview";
import { ContractSummaryCards } from "@/components/rentals/contracts/contract-summary-cards";
import { ContractTabs, TabSkeleton } from "@/components/rentals/contracts/contract-tabs";
import { ContractTimeline } from "@/components/rentals/contracts/contract-timeline";
import { buildTimelineModel } from "@/components/rentals/contracts/timeline-model";
import { CONTRACT_TABS, type ContractTab } from "@/components/rentals/contracts/types";
import { ContractLedgerSection } from "@/components/rentals/collections/contract-ledger-section";
import { ContractAdjustmentsSection } from "@/components/rentals/adjustments/contract-adjustments-section";
import { ContractProofsSection } from "@/components/rentals/proofs/contract-proofs-section";
import { ExpensesSection } from "@/components/rentals/expenses/expenses-section";
import { DocumentsSection } from "@/components/rentals/documents/documents-section";
import { formatDate, formatMoney } from "@/lib/format";
import { CONTRACT_STATE_META, DEPOSIT_STATUS_LABEL, contractStateLabel, formatContractNumber } from "@/lib/rentals/labels";
import { INDEX_META, isIndexCode } from "@/lib/rentals/indices";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { loadContractDetail, loadContractEvents } from "@/lib/rentals/server/contracts-queries";

export const metadata = { title: "Contrato · rentOS" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_TAB: Partial<Record<ContractTab, string>> = {
  cuenta: "Todavía no hay cargos ni cobros en este contrato.",
  ajustes: "Todavía no hay ajustes para mostrar.",
  servicios: "Todavía no hay comprobantes de expensas ni servicios.",
  gastos: "No hay gastos cargados para esta propiedad.",
  documentos: "No hay documentos subidos. Subí el contrato firmado para tenerlo a mano.",
};

/** Contenedor de una sección de otra tajada: si todavía no renderiza nada, muestra un vacío amable. */
function Slot({ tab, children }: { tab: ContractTab; children: ReactNode }) {
  return (
    <div>
      <div className="peer empty:hidden">{children}</div>
      <p className="hidden peer-empty:block rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {EMPTY_TAB[tab] ?? "No hay nada para mostrar todavía."}
      </p>
    </div>
  );
}

async function HistorySection({ contractId }: { contractId: string }) {
  const ctx = await requireRentalsPage();
  const events = await loadContractEvents(ctx, contractId);
  return <ContractHistory events={events} />;
}

export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireRentalsPage();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [detail, sp] = await Promise.all([loadContractDetail(ctx, id), searchParams]);
  if (!detail) notFound();

  const c = detail.contract;
  const draft = c.status === "borrador";
  const ended = c.status === "finalizado" || c.status === "rescindido";
  const tabs = CONTRACT_TABS.filter((t) => !(draft && (t === "cuenta" || t === "servicios")));
  const requested = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: ContractTab = tabs.includes(requested as ContractTab) ? (requested as ContractTab) : "resumen";
  const tenant = detail.parties.find((p) => p.role === "inquilino" && p.isPrimary) ?? detail.parties.find((p) => p.role === "inquilino") ?? null;
  const otherTenants = detail.parties.filter((p) => p.role === "inquilino").length - 1;
  const model = buildTimelineModel({
    startDate: c.start_date,
    endDate: c.end_date,
    today: detail.today,
    initialRent: Number(c.initial_rent),
    schedule: detail.schedule,
    adjustments: detail.adjustments,
    terminatedAt: ended ? c.terminated_at : null,
  });
  const indexLabel = c.adjustment_method === "indice" && c.index_code && isIndexCode(c.index_code) ? INDEX_META[c.index_code].label : null;
  const org = ctx.organization;
  const basePath = `/dashboard/alquileres/contratos/${c.id}`;

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 max-w-5xl mx-auto">
      <LiveRefresh
        tables={["rental_contracts", "rental_adjustments", "rental_charges", "rental_payments", "rental_proofs", "rental_payment_reports"]}
        label="novedad"
        labelPlural="novedades"
        throttleMs={5_000}
      />
      <Link href="/dashboard/alquileres/contratos" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={14} /> Contratos
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className="size-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm text-white"
            style={{ backgroundColor: RENTALS_ACCENT }}
            aria-hidden
          >
            <FileSignature size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight font-mono">{formatContractNumber(c.number)}</h1>
              <StatusBadge meta={{ ...CONTRACT_STATE_META[detail.displayState], label: contractStateLabel(c, detail.today) }} />
            </div>
            <div className="mt-1 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-4 gap-y-1 text-sm">
              <Link href={`/dashboard/alquileres/propiedades/${detail.property.id}`} className="inline-flex items-center gap-1.5 hover:underline min-w-0">
                <MapPin size={14} className="text-muted-foreground shrink-0" />
                <span className="truncate">
                  {detail.property.address}
                  {detail.property.city ? <span className="text-muted-foreground"> · {detail.property.city}</span> : null}
                </span>
              </Link>
              {tenant && (
                <Link href={`/dashboard/alquileres/personas/${tenant.personId}`} className="inline-flex items-center gap-1.5 hover:underline min-w-0">
                  <UserRound size={14} className="text-muted-foreground shrink-0" />
                  <span className="truncate">
                    {tenant.name}
                    {otherTenants > 0 ? <span className="text-muted-foreground"> +{otherTenants}</span> : null}
                  </span>
                </Link>
              )}
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <CalendarRange size={14} className="shrink-0" />
                {formatDate(c.start_date)} → {formatDate(c.end_date)}
              </span>
            </div>
          </div>
        </div>
        <ContractActions detail={detail} org={{ name: org.name, legal_name: org.legal_name, tax_id: org.tax_id, logo_url: org.logo_url, primary_color: org.primary_color }} />
      </div>

      {draft && <DraftBanner detail={detail} />}
      {detail.displayState === "vencido_ocupado" && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/[0.07] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <AlertTriangle size={18} className="text-orange-600 shrink-0 mt-0.5" />
            <p className="text-sm">
              El contrato venció el {formatDate(c.end_date)} y el inquilino sigue en la propiedad: rige en las mismas condiciones hasta que alguien lo cierre (art. 1218 CCyC).{" "}
              {c.continuation_billing ? (
                <>Se están cobrando los meses de continuación al último alquiler, sin ajustes nuevos. </>
              ) : (
                <span className="font-medium">Los meses siguientes no se cobran hasta que actives el cobro de la continuación. </span>
              )}
              <span className="text-muted-foreground">Renovalo o, cuando entregue las llaves, finalizalo desde «Más».</span>
            </p>
          </div>
          <ContinuationBillingButton contractId={c.id} on={Boolean(c.continuation_billing)} />
        </div>
      )}
      {(detail.displayState === "rescision_notificada" || detail.displayState === "salida_programada") && c.terminated_at && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 flex items-start gap-3">
          <DoorOpen size={18} className="text-rose-600 shrink-0 mt-0.5" />
          <p className="text-sm">
            {c.termination_notice_date
              ? `El inquilino notificó la rescisión el ${formatDate(c.termination_notice_date)} y desocupa el ${formatDate(c.terminated_at)}.`
              : `Entrega las llaves el ${formatDate(c.terminated_at)}.`}{" "}
            Hasta ese día el contrato sigue vigente y se le sigue cobrando el alquiler; ese día se cierra solo y se anulan los cargos posteriores.
            {c.termination_penalty ? ` Indemnización: ${formatMoney(c.termination_penalty, c.currency)}.` : ""}{" "}
            <span className="text-muted-foreground">Si entrega las llaves antes, registralo desde «Más».</span>
          </p>
        </div>
      )}
      {ended && (
        <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm space-y-1">
          <p>
            <span className="font-medium">{c.status === "rescindido" ? "Rescindido" : "Finalizado"}</span>
            {c.terminated_at ? ` el ${formatDate(c.terminated_at)}` : ""}
            {c.termination_reason ? ` · ${c.termination_reason}` : ""}
            {c.termination_penalty ? ` · indemnización ${formatMoney(c.termination_penalty, c.currency)}` : ""}
          </p>
          {c.deposit_amount > 0 && (c.deposit_status === "retenido" || c.deposit_status === "pendiente") && (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Depósito de {formatMoney(c.deposit_amount, c.deposit_currency || c.currency)}: {DEPOSIT_STATUS_LABEL[c.deposit_status].toLowerCase()}. Acordate de devolverlo o aplicarlo a deudas.
            </p>
          )}
        </div>
      )}
      {(detail.renewal || detail.renewedFrom) && (
        <div className="flex flex-wrap gap-2">
          {detail.renewedFrom && (
            <Link href={`/dashboard/alquileres/contratos/${detail.renewedFrom.id}`} className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent/40 transition-colors">
              <History size={14} className="text-muted-foreground" /> Renovación de <span className="font-mono font-semibold">{formatContractNumber(detail.renewedFrom.number)}</span>
            </Link>
          )}
          {detail.renewal && (
            <Link href={`/dashboard/alquileres/contratos/${detail.renewal.id}`} className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent/40 transition-colors">
              <RefreshCcw size={14} className="text-muted-foreground" /> Renovado por <span className="font-mono font-semibold">{formatContractNumber(detail.renewal.number)}</span>
              <span className="text-muted-foreground">· {CONTRACT_STATE_META[detail.renewal.status].label.toLowerCase()}</span>
            </Link>
          )}
        </div>
      )}

      <Card className="p-4 sm:p-5 gap-3">
        <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-muted-foreground">Línea de tiempo</h2>
        <ContractTimeline
          model={model}
          currency={c.currency}
          startDate={c.start_date}
          endDate={c.end_date}
          draft={draft}
          indexLabel={indexLabel}
          endedOn={ended ? (c.terminated_at ?? c.end_date) : null}
        />
      </Card>

      <ContractSummaryCards detail={detail} />

      <ContractTabs basePath={basePath} active={tab} tabs={[...tabs]}>
        <Suspense key={tab} fallback={<TabSkeleton />}>
          {tab === "resumen" && <ContractOverview detail={detail} />}
          {tab === "cuenta" && (
            <Slot tab="cuenta">
              <ContractLedgerSection contractId={c.id} />
            </Slot>
          )}
          {tab === "ajustes" && (
            <Slot tab="ajustes">
              <ContractAdjustmentsSection contractId={c.id} />
            </Slot>
          )}
          {tab === "servicios" && (
            <Slot tab="servicios">
              <ContractProofsSection contractId={c.id} />
            </Slot>
          )}
          {tab === "gastos" && (
            <Slot tab="gastos">
              <ExpensesSection propertyId={c.property_id} contractId={c.id} />
            </Slot>
          )}
          {tab === "documentos" && (
            <Slot tab="documentos">
              <DocumentsSection scope={{ contractId: c.id }} />
            </Slot>
          )}
          {tab === "historial" && <HistorySection contractId={c.id} />}
        </Suspense>
      </ContractTabs>
    </div>
  );
}
