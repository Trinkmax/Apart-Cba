import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSettlement } from "@/lib/actions/settlements";
import { getCurrentOrg, getOrganizationBranding } from "@/lib/actions/org";
import { listAccounts } from "@/lib/actions/cash";
import { can } from "@/lib/permissions";
import { SettlementStatement } from "@/components/settlements/settlement-statement";
import { SettlementActions } from "@/components/settlements/settlement-actions";
import {
  SettlementLineEditor,
  type EditorLine,
} from "@/components/settlements/settlement-line-editor";
import {
  buildStatementModel,
  type StatementInput,
} from "@/lib/settlements/statement-model";
import type {
  OwnerSettlement,
  Owner,
  SettlementLine,
} from "@/lib/types/database";

type DetailLine = SettlementLine & {
  unit: { id: string; code: string; name: string } | null;
};
type SettlementDetail = OwnerSettlement & {
  owner: Owner;
  lines: DetailLine[];
};

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) redirect("/dashboard");

  const settlement = (await getSettlement(
    id,
  )) as unknown as SettlementDetail | null;
  if (!settlement) notFound();

  const [branding, accounts] = await Promise.all([
    getOrganizationBranding(),
    listAccounts(),
  ]);

  const canCreate = can(role, "settlements", "create");
  const canUpdate = can(role, "settlements", "update");

  const statementInput: StatementInput = {
    id: settlement.id,
    period_year: settlement.period_year,
    period_month: settlement.period_month,
    status: settlement.status,
    currency: settlement.currency,
    gross_revenue: Number(settlement.gross_revenue),
    commission_amount: Number(settlement.commission_amount),
    deductions_amount: Number(settlement.deductions_amount),
    net_payable: Number(settlement.net_payable),
    generated_at: settlement.generated_at,
    sent_at: settlement.sent_at,
    paid_at: settlement.paid_at,
    owner: {
      full_name: settlement.owner.full_name,
      bank_name: settlement.owner.bank_name,
      cbu: settlement.owner.cbu,
      alias_cbu: settlement.owner.alias_cbu,
    },
    lines: (settlement.lines ?? []).map((l) => ({
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

  // Unidades distintas presentes (para el dropdown del editor de ajustes)
  const unitMap = new Map<string, { id: string; code: string; name: string }>();
  for (const l of settlement.lines ?? []) {
    if (l.unit) unitMap.set(l.unit.id, l.unit);
  }
  const units = Array.from(unitMap.values()).sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  const editorLines: EditorLine[] = (settlement.lines ?? [])
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((l) => ({
      id: l.id,
      line_type: l.line_type,
      description: l.description,
      unit_id: l.unit_id,
      unitCode: l.unit?.code ?? null,
      amount: Number(l.amount),
      sign: l.sign,
      is_manual: l.is_manual,
    }));

  return (
    <div className="page-x page-y max-w-5xl mx-auto space-y-4 sm:space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/dashboard/liquidaciones"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Liquidaciones
        </Link>
      </div>

      <SettlementActions
        settlement={{
          id: settlement.id,
          status: settlement.status,
          owner_id: settlement.owner_id,
          period_year: settlement.period_year,
          period_month: settlement.period_month,
          currency: settlement.currency,
          public_token: settlement.public_token,
          owner_email: settlement.owner.email,
          net_payable: Number(settlement.net_payable),
        }}
        statementInput={statementInput}
        branding={branding}
        accounts={accounts}
        periodLabel={model.periodLabel}
        canCreate={canCreate}
        canUpdate={canUpdate}
      />

      <SettlementStatement model={model} />

      {settlement.status === "borrador" && canUpdate && (
        <SettlementLineEditor
          settlementId={settlement.id}
          currency={settlement.currency}
          lines={editorLines}
          units={units}
        />
      )}
    </div>
  );
}
