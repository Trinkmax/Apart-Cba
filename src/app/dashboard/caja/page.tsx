import { Plus, Wallet, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { listAccounts, listMovements, getAccountBalance } from "@/lib/actions/cash";
import { listUnitsEnriched } from "@/lib/actions/units";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccountFormDialog } from "@/components/cash/account-form-dialog";
import { AccountsGrid } from "@/components/cash/accounts-grid";
import { MovementFormDialog } from "@/components/cash/movement-form-dialog";
import { TransferFormDialog } from "@/components/cash/transfer-form-dialog";
import { MovementsList } from "@/components/cash/movements-list";
import { ExportMovementsDialog } from "@/components/cash/export-movements-dialog";
import { formatMoney } from "@/lib/format";

export default async function CajaPage() {
  const [accounts, movements, units, { role }] = await Promise.all([
    listAccounts(),
    listMovements({ limit: 100 }),
    listUnitsEnriched(),
    getCurrentOrg(),
  ]);
  const balances = await Promise.all(accounts.map((a) => getAccountBalance(a.id)));
  const unitsForMovement = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));
  const canManageAccounts = can(role, "cash", "update") && can(role, "cash", "delete");

  // Agrupar saldos por moneda
  const totalsByCurrency = accounts.reduce<Record<string, number>>((acc, a, i) => {
    acc[a.currency] = (acc[a.currency] ?? 0) + balances[i];
    return acc;
  }, {});

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Wallet className="size-5 text-primary" /> Caja
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {accounts.length} cuentas · {movements.length} movimientos
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <ExportMovementsDialog accounts={accounts} />
          <TransferFormDialog accounts={accounts}>
            <Button variant="outline" className="gap-1.5 sm:gap-2 flex-1 sm:flex-none">
              ⇄ <span className="hidden xs:inline sm:inline">Transferir</span>
            </Button>
          </TransferFormDialog>
          <MovementFormDialog accounts={accounts} units={unitsForMovement} defaultDirection="out">
            <Button
              variant="outline"
              className="gap-1.5 sm:gap-2 flex-1 sm:flex-none border-rose-300/60 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-800/50 dark:text-rose-300 dark:hover:bg-rose-950/40"
            >
              <ArrowUpFromLine size={15} /> <span className="hidden xs:inline sm:inline">Egreso</span>
            </Button>
          </MovementFormDialog>
          <MovementFormDialog accounts={accounts} units={unitsForMovement} defaultDirection="in">
            <Button
              variant="outline"
              className="gap-1.5 sm:gap-2 flex-1 sm:flex-none border-emerald-300/60 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              <ArrowDownToLine size={15} /> <span className="hidden xs:inline sm:inline">Ingreso</span>
            </Button>
          </MovementFormDialog>
          <MovementFormDialog accounts={accounts} units={unitsForMovement}>
            <Button className="gap-1.5 sm:gap-2 flex-1 sm:flex-none">
              <Plus size={16} /> <span className="hidden xs:inline sm:inline">Movimiento</span>
            </Button>
          </MovementFormDialog>
        </div>
      </div>

      {/* Totals por moneda */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {Object.entries(totalsByCurrency).map(([currency, total]) => (
          <Card key={currency} className="p-3 sm:p-4">
            <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Total {currency}</div>
            <div className="text-lg sm:text-2xl font-semibold mt-1 tabular-nums truncate">
              {formatMoney(total, currency)}
            </div>
          </Card>
        ))}
      </div>

      {/* Cuentas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Cuentas</h2>
          <AccountFormDialog>
            <Button size="sm" variant="outline" className="gap-1.5"><Plus size={14} /> Nueva cuenta</Button>
          </AccountFormDialog>
        </div>
        {accounts.length === 0 ? (
          <Card className="p-12 text-center border-dashed text-sm text-muted-foreground">
            No hay cuentas. Creá la primera para empezar a registrar movimientos.
          </Card>
        ) : (
          <AccountsGrid accounts={accounts} balances={balances} canManage={canManageAccounts} />
        )}
      </div>

      {/* Movimientos */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Movimientos recientes
        </h2>
        <MovementsList movements={movements as never} />
      </div>
    </div>
  );
}
