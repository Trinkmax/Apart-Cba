import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CalendarRange, Clock, FileSignature, HandCoins, ReceiptText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { EmptyState, HowItWorks, KpiCard, PageHeader, StackedBar } from "@/components/rentals/ui";
import { CollectionsBoardList } from "@/components/rentals/collections/collections-board";
import { CollectionsMonthNav } from "@/components/rentals/collections/month-nav";
import { ExpensasSheet } from "@/components/rentals/collections/expensas-sheet";
import { GenerateChargesButton } from "@/components/rentals/collections/generate-charges-button";
import { collectedPct, parseBoardMonth } from "@/components/rentals/collections/board-helpers";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { loadCollectionsBoard } from "@/lib/rentals/server/collections-queries";
import { monthLabelOf } from "@/lib/rentals/labels";
import { monthOf } from "@/lib/rentals/ymd";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Cobranzas" };

export default async function CobranzasPage({ searchParams }: { searchParams: Promise<{ mes?: string | string[] }> }) {
  const ctx = await requireRentalsPage();
  const sp = await searchParams;
  const month = parseBoardMonth(sp.mes, ctx.today);
  const board = await loadCollectionsBoard(ctx.admin, ctx.organization.id, month, ctx.today);
  const current = monthOf(ctx.today);
  const monthName = monthLabelOf(month);
  const main = board.totals[0] ?? null;
  const others = board.totals.slice(1);
  const overdueRows = board.rows.filter((r) => r.state === "vencido").length;
  const paidRows = board.rows.filter((r) => r.state === "pagado").length;
  const noContractsAtAll = board.activeContracts === 0 && board.rows.length === 0 && board.previousRows.length === 0;

  const subtitle = noContractsAtAll
    ? "Lo que deben los inquilinos, mes a mes"
    : board.rows.length === 0
      ? `${monthName} · sin cargos todavía`
      : `${monthName} · ${board.rows.length} ${board.rows.length === 1 ? "contrato" : "contratos"}${overdueRows ? ` · ${overdueRows} ${overdueRows === 1 ? "vencido" : "vencidos"}` : ""}${paidRows ? ` · ${paidRows} al día` : ""}`;

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh tables={["rental_charges", "rental_payments", "rental_contracts"]} label="cobro" labelPlural="cobros" throttleMs={5_000} />
      <PageHeader
        icon={HandCoins}
        title="Cobranzas"
        subtitle={subtitle}
        actions={
          <>
            <CollectionsMonthNav month={month} today={ctx.today} />
            {board.expensasContracts > 0 && <ExpensasSheet month={month} count={board.expensasContracts} />}
          </>
        }
      />

      {board.failed && (
        <Card className="p-4 border border-rose-500/30 bg-rose-500/5 flex-row items-center gap-3">
          <AlertTriangle className="size-5 shrink-0 text-rose-500" />
          <p className="text-sm">No pudimos leer todas las cobranzas. Recargá la página; si sigue, avisanos.</p>
        </Card>
      )}

      {noContractsAtAll ? (
        <EmptyState
          icon={FileSignature}
          title="Todavía no hay contratos vigentes"
          description="Cuando actives un contrato, acá vas a ver cada mes lo que debe cada inquilino, quién está vencido y los recibos."
          action={
            <div className="flex flex-col items-center gap-3">
              <ol className="grid gap-2 text-left text-xs text-muted-foreground sm:grid-cols-3 sm:gap-4 max-w-2xl">
                {[
                  ["1", "Cargá el contrato", "Propiedad, inquilino, precio e índice de ajuste."],
                  ["2", "Activalo", "Se arma el cronograma y los cargos salen solos cada mes."],
                  ["3", "Cobrá desde acá", "Con punitorios al día, recibo en PDF y aviso por WhatsApp."],
                ].map(([n, t, d]) => (
                  <li key={n} className="flex gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{n}</span>
                    <span>
                      <span className="block text-sm font-medium text-foreground">{t}</span>
                      {d}
                    </span>
                  </li>
                ))}
              </ol>
              <Link href="/dashboard/alquileres/contratos/nuevo" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Cargar el primer contrato <ArrowRight size={14} />
              </Link>
            </div>
          }
        />
      ) : (
        <>
          {main ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
                <KpiCard label="Esperado" icon={CalendarRange} value={formatMoney(main.expected, main.currency)} hint={`Lo facturado de ${monthName}`} />
                <KpiCard
                  label="Cobrado"
                  icon={HandCoins}
                  tone="in"
                  value={formatMoney(main.collected, main.currency)}
                  hint={`${collectedPct(main)} % de lo esperado`}
                />
                <KpiCard label="Por cobrar" icon={Clock} value={formatMoney(main.pending, main.currency)} hint="Todavía en fecha" />
                <KpiCard
                  label="Vencido"
                  icon={AlertTriangle}
                  tone={main.overdue > 0 ? "out" : "neutral"}
                  value={formatMoney(main.overdue, main.currency)}
                  hint={overdueRows ? `${overdueRows} ${overdueRows === 1 ? "contrato" : "contratos"} con saldo vencido` : "Nadie vencido"}
                />
              </div>
              <Card className="p-3 sm:p-4 gap-2">
                <StackedBar
                  className="h-3"
                  segments={[
                    { value: main.collected, color: "#10b981", label: "Cobrado" },
                    { value: main.pending, color: "#94a3b8", label: "Por cobrar" },
                    { value: main.overdue, color: "#f43f5e", label: "Vencido" },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  {[
                    { c: "#10b981", l: "Cobrado", v: main.collected },
                    { c: "#94a3b8", l: "Por cobrar", v: main.pending },
                    { c: "#f43f5e", l: "Vencido", v: main.overdue },
                  ].map((x) => (
                    <span key={x.l} className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-[2px]" style={{ backgroundColor: x.c }} /> {x.l}{" "}
                      <span className="tabular-nums text-foreground">{formatMoney(x.v, main.currency)}</span>
                    </span>
                  ))}
                  {others.map((o) => (
                    <span key={o.currency} className="tabular-nums">
                      · En {o.currency}: {formatMoney(o.collected, o.currency)} de {formatMoney(o.expected, o.currency)}
                    </span>
                  ))}
                </div>
              </Card>
            </>
          ) : null}

          {board.missing.length > 0 && (
            <Card className="p-4 border border-amber-500/30 bg-amber-500/10 gap-0">
              <div className="flex flex-wrap items-center gap-3">
                <AlertTriangle className="size-5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {board.missing.length === 1 ? "1 contrato todavía no tiene" : `${board.missing.length} contratos todavía no tienen`} el cargo de {monthName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{board.missing.map((m) => `${m.tenantName} (${m.address})`).join(" · ")}</p>
                </div>
                <GenerateChargesButton />
              </div>
            </Card>
          )}
          {board.upcoming.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
              <CalendarClock size={14} className="mt-px shrink-0" />
              <span>
                {board.upcoming.length === 1 ? "1 cargo" : `${board.upcoming.length} cargos`} de {monthName} se {board.upcoming.length === 1 ? "genera" : "generan"} solos{" "}
                {board.chargeLeadDays} días antes de cada período (el primero, el {formatDate(board.upcoming[0].generatesOn)}).
              </span>
            </p>
          )}

          {board.rows.length === 0 && board.missing.length === 0 && (
            <EmptyState
              icon={ReceiptText}
              title={month > current ? `Los cargos de ${monthName} todavía no salieron` : `No hay cargos en ${monthName}`}
              description={
                month > current
                  ? `Se generan solos ${board.chargeLeadDays} días antes de que empiece cada período, con el alquiler vigente y los ajustes aplicados.`
                  : "Ningún contrato tenía un período para cobrar este mes."
              }
            />
          )}

          {(board.rows.length > 0 || board.previousRows.length > 0) && (
            <CollectionsBoardList rows={board.rows} previousRows={board.previousRows} today={ctx.today} />
          )}

          <HowItWorks title="Cómo funciona la cobranza">
            <p>
              Cada mes, {board.chargeLeadDays} días antes de que empiece el período, se genera el cargo del alquiler con el precio vigente (y las expensas, si las cobra la
              inmobiliaria). Si un ajuste llega tarde porque el índice no salió, la diferencia se suma después.
            </p>
            <p>
              <strong>Vencido</strong> = pasó la fecha de pago y queda saldo. Los intereses por mora no se cargan solos: se calculan al día en que paga, según lo que dice el contrato,
              y se pueden condonar.
            </p>
            <p>
              Al cobrar, el pago cubre primero lo más viejo; si el inquilino dice qué paga, se imputa ahí (art. 900 del Código Civil y Comercial). Si sobra, queda como saldo a
              favor y se descuenta solo del próximo cargo.
            </p>
            <p>
              El recibo deja constancia de lo que queda pendiente: sin eso, un recibo posterior hace suponer pagados los anteriores (art. 899).
            </p>
            <p>&quot;Cobrado&quot; es lo que se imputó a los cargos del mes; lo que se debe de meses anteriores aparece aparte.</p>
          </HowItWorks>
        </>
      )}
    </div>
  );
}
