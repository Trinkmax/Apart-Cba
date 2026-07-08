"use client";

import { useState, type ComponentProps } from "react";
import { FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GenerateSettlementDialog } from "@/components/settlements/generate-settlement-dialog";
import {
  SettlementsViewTabs,
  type SettlementsTab,
} from "@/components/settlements/settlements-view-tabs";
import { SettlementsListClient } from "@/components/settlements/settlements-list-client";
import { PeriodBatchPanel } from "@/components/settlements/period-batch-panel";
import { formatPeriod } from "@/lib/settlements/labels";

/**
 * Wrapper cliente que unifica las dos vistas de liquidaciones en UNA sola ruta.
 *
 * El tab es estado de cliente → alternar Por propietario / Por período es
 * instantáneo (cero round-trip al server). La URL se sincroniza con la History
 * API nativa (sin navegar), así el deep-link y el refresh siguen respetando el
 * tab activo. Los cambios de período (año/mes/moneda) SÍ navegan, porque traen
 * datos nuevos del server — eso lo maneja `PeriodBatchPanel`.
 */
export function LiquidacionesTabs({
  initialTab,
  settlements,
  owners,
  pendientes,
  year,
  month,
  currency,
  periodRows,
  canCreate,
}: {
  initialTab: SettlementsTab;
  settlements: ComponentProps<typeof SettlementsListClient>["settlements"];
  owners: ComponentProps<typeof GenerateSettlementDialog>["owners"];
  pendientes: number;
  year: number;
  month: number;
  currency: string;
  periodRows: ComponentProps<typeof PeriodBatchPanel>["rows"];
  canCreate: boolean;
}) {
  const [tab, setTab] = useState<SettlementsTab>(initialTab);

  function switchTab(next: SettlementsTab) {
    if (next === tab) return;
    setTab(next);
    // Reflejá el tab en la URL sin round-trip (Next integra la History API con
    // useSearchParams). Mantené año/mes/moneda por si el usuario está en período.
    const params = new URLSearchParams(window.location.search);
    if (next === "periodo") params.set("tab", "periodo");
    else params.delete("tab");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5 md:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileText className="size-5 text-primary" /> Liquidaciones
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {tab === "propietario"
              ? `${settlements.length} generadas · ${pendientes} pendientes de pago`
              : `Generación por período · ${formatPeriod(year, month)}`}
          </p>
        </div>
        {tab === "propietario" && <GenerateSettlementDialog owners={owners} />}
      </div>

      <SettlementsViewTabs value={tab} onChange={switchTab} />

      {tab === "propietario" ? (
        settlements.length === 0 ? (
          <Card className="p-8 sm:p-12 text-center border-dashed">
            <FileText className="size-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium">Sin liquidaciones</p>
            <p className="text-xs text-muted-foreground mt-1">
              Generá la primera para un propietario, o usá la vista{" "}
              <span className="font-medium">Por período</span> para hacerlas en
              lote.
            </p>
          </Card>
        ) : (
          <SettlementsListClient settlements={settlements} />
        )
      ) : (
        <PeriodBatchPanel
          year={year}
          month={month}
          currency={currency}
          rows={periodRows}
          canCreate={canCreate}
        />
      )}
    </div>
  );
}
