import Link from "next/link";
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Wallet, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { RunningBalanceSparkline } from "./running-balance-sparkline";
import { MovementFormDialog } from "./movement-form-dialog";
import { TransferFormDialog } from "./transfer-form-dialog";
import type { CashAccount, Unit } from "@/lib/types/database";
import type { AccountStats } from "@/lib/actions/cash";

interface Props {
  account: CashAccount;
  balance: number;
  stats: AccountStats;
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  banco: "Banco",
  mp: "Mercado Pago",
  crypto: "Crypto",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

export function AccountDetailHeader({ account, balance, stats, accounts, units }: Props) {
  const netMtd = stats.mtd_in - stats.mtd_out;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard/caja"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} /> Caja
        </Link>
        <div className="flex items-center gap-2">
          <TransferFormDialog accounts={accounts}>
            <Button variant="outline" size="sm" className="gap-1.5">
              ⇄ <span className="hidden sm:inline">Transferir</span>
            </Button>
          </TransferFormDialog>
          <MovementFormDialog accounts={accounts} units={units}>
            <Button size="sm" className="gap-1.5">
              <Plus size={14} /> <span className="hidden sm:inline">Movimiento</span>
            </Button>
          </MovementFormDialog>
        </div>
      </div>

      <Card className="p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          {/* Identidad de la cuenta */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="size-12 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0"
              style={{ backgroundColor: account.color ?? "#0F766E" }}
            >
              <Wallet size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{account.name}</h1>
                <Badge variant="secondary" className="font-normal capitalize">
                  {ACCOUNT_TYPE_LABEL[account.type] ?? account.type}
                </Badge>
                <Badge variant="outline" className="font-mono">{account.currency}</Badge>
              </div>
              {(account.account_number || account.bank_name) && (
                <div className="text-xs text-muted-foreground mt-1">
                  {[account.bank_name, account.account_number].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          </div>

          {/* Saldo + sparkline */}
          <div className="lg:text-right min-w-0 lg:max-w-md w-full">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Saldo actual</div>
            <div className="text-3xl sm:text-4xl font-semibold tabular-nums truncate">
              {formatMoney(balance, account.currency)}
            </div>
            <div className="mt-1.5">
              <RunningBalanceSparkline data={stats.daily_balance} currency={account.currency} />
            </div>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <KpiCard
          label="Ingresos del mes"
          value={stats.mtd_in}
          currency={account.currency}
          tone="emerald"
          icon={<ArrowDownToLine size={14} />}
        />
        <KpiCard
          label="Egresos del mes"
          value={stats.mtd_out}
          currency={account.currency}
          tone="rose"
          icon={<ArrowUpFromLine size={14} />}
        />
        <KpiCard
          label="Neto del mes"
          value={netMtd}
          currency={account.currency}
          tone={netMtd >= 0 ? "emerald" : "rose"}
        />
        <KpiCard
          label="Neto del año"
          value={stats.ytd_in - stats.ytd_out}
          currency={account.currency}
          tone={stats.ytd_in - stats.ytd_out >= 0 ? "emerald" : "rose"}
        />
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  currency,
  tone,
  icon,
}: {
  label: string;
  value: number;
  currency: string;
  tone: "emerald" | "rose";
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  return (
    <Card className="p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-base sm:text-xl font-semibold tabular-nums truncate mt-1 ${toneCls}`}>
        {formatMoney(value, currency)}
      </div>
    </Card>
  );
}
