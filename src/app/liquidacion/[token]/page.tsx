import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSettlementByToken } from "@/lib/actions/settlements";
import {
  buildStatementModel,
  type StatementInput,
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
  is_manual: boolean;
  meta: SettlementLineMeta | null;
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
    status: string;
    currency: string;
    gross_revenue: number;
    commission_amount: number;
    deductions_amount: number;
    net_payable: number;
    generated_at: string | null;
    sent_at: string | null;
    paid_at: string | null;
    owner: {
      full_name: string;
      bank_name: string | null;
      cbu: string | null;
      alias_cbu: string | null;
    } | null;
    lines: TokenLine[];
  };
  const org = res.org;

  const statementInput: StatementInput = {
    id: s.id,
    period_year: s.period_year,
    period_month: s.period_month,
    status: s.status,
    currency: s.currency,
    gross_revenue: Number(s.gross_revenue),
    commission_amount: Number(s.commission_amount),
    deductions_amount: Number(s.deductions_amount),
    net_payable: Number(s.net_payable),
    generated_at: s.generated_at,
    sent_at: s.sent_at,
    paid_at: s.paid_at,
    owner: s.owner
      ? {
          full_name: s.owner.full_name,
          bank_name: s.owner.bank_name,
          cbu: s.owner.cbu,
          alias_cbu: s.owner.alias_cbu,
        }
      : null,
    lines: (s.lines ?? []).map((l) => ({
      id: l.id,
      line_type: l.line_type,
      ref_type: l.ref_type,
      ref_id: l.ref_id,
      unit_id: l.unit_id,
      description: l.description,
      amount: Number(l.amount),
      sign: l.sign,
      is_manual: l.is_manual,
      meta: l.meta,
      unit: l.unit,
    })),
  };

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
              Liquidación · {model.periodLabel}
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
