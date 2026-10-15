import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSettlementByToken } from "@/lib/actions/settlements";
import {
  buildStatementModel,
  statementInputFromRecord,
} from "@/lib/settlements/statement-model";
import { SettlementStatement } from "@/components/settlements/settlement-statement";
import { SettlementExportButtons } from "@/components/settlements/settlement-export-buttons";
import type { SettlementLine, SettlementLineMeta } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Liquidación",
  robots: { index: false, follow: false },
};

type TokenLine = {
  id: string;
  line_type: SettlementLine["line_type"];
  ref_type: string | null;
  ref_id: string | null;
  unit_id: string | null;
  description: string;
  amount: number;
  sign: "+" | "-";
  currency: string | null;
  is_manual: boolean;
  meta: SettlementLineMeta | null;
  display_order: number | null;
  unit: { id: string; code: string; name: string } | null;
};

export default async function PublicSettlementPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await getSettlementByToken(token);
  if (!res) notFound();

  const s = res.settlement as unknown as {
    id: string;
    period_year: number;
    period_month: number;
    period_index: number | null;
    period_cycle: number | null;
    period_note: string | null;
    unit_periods: unknown;
    status: string;
    currency: string;
    gross_revenue: number;
    commission_amount: number;
    deductions_amount: number;
    net_payable: number;
    generated_at: string | null;
    sent_at: string | null;
    paid_at: string | null;
    unit_order: string[] | null;
    exchange_rates: Record<string, number> | null;
    owner: {
      full_name: string;
      bank_name: string | null;
      cbu: string | null;
      alias_cbu: string | null;
    } | null;
    lines: TokenLine[];
  };
  const org = res.org;

  // Mismo armado que el detalle del panel (orden, monedas, TC y período por
  // depto): el link público tiene que mostrar el documento tal cual lo revisó
  // el operador (la columna "Canal" también sale del modelo, así que aparece
  // sola).
  const statementInput = statementInputFromRecord(s);
  const model = buildStatementModel(statementInput);
  const branding = {
    name: org?.name ?? "Liquidación",
    legal_name: org?.legal_name ?? null,
    tax_id: org?.tax_id ?? null,
    logo_url: org?.logo_url ?? null,
    primary_color: org?.primary_color ?? null,
  };

  return (
    <div className="min-h-screen bg-muted/30 py-6 sm:py-10 px-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {branding.name}
            </div>
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">
              Liquidación · {model.periodFullLabel}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <SettlementExportButtons
              input={statementInput}
              branding={branding}
            />
          </div>
        </div>

        <SettlementStatement model={model} />

        <p className="text-center text-xs text-muted-foreground pt-2">
          Documento de solo lectura · {model.number}
        </p>
      </div>
    </div>
  );
}
