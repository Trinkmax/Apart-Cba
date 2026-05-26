import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Coins } from "lucide-react";
import {
  getSettlement,
  listSettlementAudit,
  listSettlementSiblings,
  listOwnerUnits,
} from "@/lib/actions/settlements";
import { getCurrentOrg, getOrganizationBranding } from "@/lib/actions/org";
import { listAccounts } from "@/lib/actions/cash";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/format";
import { SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import { SettlementStatement } from "@/components/settlements/settlement-statement";
import { EditableSettlementStatement } from "@/components/settlements/editable-settlement-statement";
import { SettlementActions } from "@/components/settlements/settlement-actions";
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

  const [branding, accounts, audit, siblings, ownerUnits] = await Promise.all([
    getOrganizationBranding(),
    listAccounts(),
    listSettlementAudit(id),
    listSettlementSiblings(id),
    listOwnerUnits(settlement.owner_id),
  ]);

  const canCreate = can(role, "settlements", "create");
  const canUpdate = can(role, "settlements", "update");
  const paid =
    settlement.status === "pagada" || !!settlement.paid_movement_id;

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
    unit_order: settlement.unit_order ?? [],
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
      display_order: l.display_order,
      unit: l.unit,
    })),
  };

  const model = buildStatementModel(statementInput);

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

      {siblings.length > 0 && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3">
          <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
            <Coins size={14} className="shrink-0" />
            Este propietario también tiene liquidaciones en otras monedas en
            este período (las monedas no se suman entre sí):
          </div>
          <div className="flex flex-wrap gap-2">
            {siblings.map((sib) => {
              const meta =
                SETTLEMENT_STATUS_META[
                  sib.status as keyof typeof SETTLEMENT_STATUS_META
                ] ?? { label: sib.status, color: "#64748b" };
              return (
                <Link
                  key={sib.id}
                  href={`/dashboard/liquidaciones/${sib.id}`}
                  className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent/40 transition-colors"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {sib.currency}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(sib.net_payable, sib.currency)}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 text-[11px]"
                    style={{ color: meta.color }}
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: meta.color }}
                    />
                    {meta.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {canUpdate ? (
        <EditableSettlementStatement
          model={model}
          settlementId={settlement.id}
          currency={settlement.currency}
          status={settlement.status}
          paid={paid}
          units={ownerUnits}
          audit={audit}
        />
      ) : (
        <SettlementStatement model={model} />
      )}
    </div>
  );
}
