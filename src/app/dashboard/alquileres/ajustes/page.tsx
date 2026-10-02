import Link from "next/link";
import { CalendarCheck2, CheckCircle2, DatabaseZap, History, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { SegmentedNav } from "@/components/results/results-mode-nav";
import { can } from "@/lib/permissions";
import { formatTimeAgo } from "@/lib/format";
import { isIndexCode, type IndexCode } from "@/lib/rentals/indices";
import { monthLabelOf } from "@/lib/rentals/labels";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { getRentalSettings } from "@/lib/rentals/server/contracts";
import { listAdjustments, type AdjustmentWindowKey } from "@/lib/actions/rentals-adjustments";
import { getIndicesOverview } from "@/lib/actions/rentals-indices";
import { EmptyState, HowItWorks, PageHeader, SectionTitle } from "@/components/rentals/ui";
import { AdjustmentCard } from "@/components/rentals/adjustments/adjustment-card";
import { NotifyAllButton } from "@/components/rentals/adjustments/notify-all-button";
import type { AdjustmentView } from "@/components/rentals/adjustments/adjustment-view";
import { IndexCard } from "@/components/rentals/indices/index-cards";
import { RefreshIndicesButton } from "@/components/rentals/indices/refresh-indices-button";
import { ManualIndexDialog } from "@/components/rentals/indices/manual-index-dialog";
import { AdjustmentCalculator } from "@/components/rentals/indices/adjustment-calculator";

export const metadata = { title: "Ajustes e índices" };

const TABS: { key: AdjustmentWindowKey; label: string }[] = [
  { key: "proximos", label: "Próximos 60 días" },
  { key: "pendientes", label: "Pendientes" },
  { key: "aplicados", label: "Aplicados" },
];

function groupByMonth(items: AdjustmentView[]): { month: string; items: AdjustmentView[] }[] {
  const out: { month: string; items: AdjustmentView[] }[] = [];
  for (const it of items) {
    const m = it.effectiveDate.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.month === m) last.items.push(it);
    else out.push({ month: m, items: [it] });
  }
  return out;
}

export default async function AjustesPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const ctx = await requireRentalsPage();
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: AdjustmentWindowKey = TABS.some((t) => t.key === raw) ? (raw as AdjustmentWindowKey) : "proximos";
  const [list, overview, settings] = await Promise.all([
    listAdjustments({ window: tab }),
    getIndicesOverview(),
    getRentalSettings(ctx.admin, ctx.organization.id),
  ]);
  const canEdit = can(ctx.role, "rentals", "update");
  const counts = list.ok ? list.counts : { proximos: 0, pendientes: 0, sinAviso: 0 };
  const subtitle = [
    `${counts.proximos} ${counts.proximos === 1 ? "ajuste" : "ajustes"} en los próximos 60 días`,
    counts.pendientes ? `${counts.pendientes} para resolver` : null,
    counts.sinAviso ? `${counts.sinAviso} sin avisar al inquilino` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const defaultIndex: IndexCode = isIndexCode(settings.default_index) ? settings.default_index : "ipc";

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh tables={["rental_adjustments", "rental_contracts"]} label="ajuste" labelPlural="ajustes" throttleMs={5_000} />
      <PageHeader
        icon={TrendingUp}
        title="Ajustes e índices"
        subtitle={subtitle}
        actions={canEdit ? <NotifyAllButton count={counts.sinAviso} /> : null}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="min-w-0 space-y-4">
          <div className="overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SegmentedNav
              label="Qué ajustes ver"
              items={TABS.map((t) => ({
                key: t.key,
                label: t.key === "pendientes" && counts.pendientes ? `${t.label} (${counts.pendientes})` : t.label,
                href: `/dashboard/alquileres/ajustes?tab=${t.key}`,
                active: t.key === tab,
              }))}
            />
          </div>

          {!list.ok ? (
            <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">{list.error}</Card>
          ) : list.items.length === 0 ? (
            tab === "pendientes" ? (
              <Card className="items-center gap-3 p-8 sm:p-12 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={22} />
                </span>
                <div>
                  <p className="text-base font-semibold">Nada trabado</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    Todos los ajustes que ya rigen tienen su monto. Si falta un índice o hay que cargar un monto a mano, aparece acá.
                  </p>
                </div>
              </Card>
            ) : tab === "aplicados" ? (
              <EmptyState icon={History} title="Todavía no hay ajustes aplicados" description="Acá vas a ver los ajustes de los últimos 6 meses, con el monto que rige y si ya se le avisó al inquilino." />
            ) : (
              <EmptyState
                icon={CalendarCheck2}
                title="No hay ajustes en los próximos 60 días"
                description="Los ajustes aparecen acá a medida que se acercan. El historial está en la pestaña Aplicados."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href="/dashboard/alquileres/contratos">Ver contratos</Link>
                  </Button>
                }
              />
            )
          ) : (
            groupByMonth(list.items).map((g) => (
              <section key={g.month} className="space-y-2.5">
                <SectionTitle>{monthLabelOf(`${g.month}-01`)}</SectionTitle>
                <div className="space-y-3">
                  {g.items.map((a) => (
                    <AdjustmentCard key={a.id} adj={a} today={list.today} canEdit={canEdit} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <aside id="indices" className="scroll-mt-20 space-y-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Índices</h2>
                {overview.ok && overview.fetchedAt && (
                  <p className="text-[11px] text-muted-foreground">Actualizados {formatTimeAgo(overview.fetchedAt)}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {overview.ok && overview.isSuperadmin && (
                  <ManualIndexDialog>
                    <Button variant="ghost" size="icon-sm" aria-label="Cargar un valor de índice a mano">
                      <DatabaseZap size={15} />
                    </Button>
                  </ManualIndexDialog>
                )}
                {canEdit && <RefreshIndicesButton />}
              </div>
            </div>
            {!overview.ok ? (
              <Card className="p-4 text-sm text-muted-foreground border-dashed">{overview.error}</Card>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {overview.indices.map((s) => (
                  <IndexCard key={s.code} s={s} inUse={overview.codesInUse.includes(s.code)} compact={!overview.codesInUse.includes(s.code) && s.code !== "ipc" && s.code !== "icl"} />
                ))}
              </div>
            )}
          </div>
          <AdjustmentCalculator
            today={ctx.today}
            defaults={{
              indexCode: defaultIndex,
              every: settings.default_adjustment_every,
              lagMonths: settings.default_lag_months,
              rounding: settings.default_rounding,
            }}
          />
        </aside>
      </div>

      <HowItWorks title="Cómo se calcula un ajuste">
        <p>
          <strong className="font-medium text-foreground">La cuenta:</strong> alquiler nuevo = alquiler anterior × (índice de llegada ÷ índice de base). Se
          guarda el nivel del índice y no el porcentaje, así no se acumulan redondeos.
        </p>
        <p>
          <strong className="font-medium text-foreground">Último dato publicado</strong> (lo habitual): para un ajuste que rige en junio se usan febrero,
          marzo y abril. El dato de abril sale a mediados de mayo, así que el precio nuevo se puede avisar antes de que empiece junio.
        </p>
        <p>
          <strong className="font-medium text-foreground">Meses del ciclo:</strong> se usan marzo, abril y mayo. El de mayo sale a mediados de junio: el
          primer cargo sale con el precio anterior y la diferencia se cobra sola cuando llega el índice.
        </p>
        <p>
          <strong className="font-medium text-foreground">ICL, UVA y CER</strong> son diarios: se compara el valor del día en que arrancó el ciclo con el del
          día del ajuste. El BCRA los publica con unos días de anticipación.
        </p>
        <p>
          <strong className="font-medium text-foreground">Redondeo, piso y tope:</strong> el redondeo va después de la cuenta y ese monto es la base del ajuste
          siguiente. Si el índice baja, el alquiler queda igual (salvo que el contrato diga otra cosa); si hay tope, el aumento no lo pasa.
        </p>
        <p>
          <strong className="font-medium text-foreground">Aplicar solo o confirmar:</strong> con &quot;Aplicar ajustes automáticamente&quot; encendido en
          Configuración → Alquileres, el monto queda aplicado apenas sale el índice; apagado, queda &quot;Listo para aplicar&quot; hasta que alguien lo
          confirme. Casa Propia no tiene fuente automática: lo carga el equipo de la plataforma cuando el Ministerio lo publica.
        </p>
      </HowItWorks>
    </div>
  );
}
