import { Plus, ArrowDownToLine, ArrowUpFromLine, Wallet } from "lucide-react";
import { listAccounts, listMovements, getAccountBalance } from "@/lib/actions/cash";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccountFormDialog } from "@/components/cash/account-form-dialog";
import { MovementFormDialog } from "@/components/cash/movement-form-dialog";
import { TransferFormDialog } from "@/components/cash/transfer-form-dialog";
import { MovementsList } from "@/components/cash/movements-list";
import { formatMoney } from "@/lib/format";

export default async function CajaPage() {
  const accounts = await listAccounts();
  const balances = await Promise.all(accounts.map((a) => getAccountBalance(a.id)));
  const movements = await listMovements({ limit: 100 });

  // Agrupar saldos por moneda
  const totalsByCurrency = accounts.reduce<Record<string, number>>((acc, a, i) => {
    acc[a.currency] = (acc[a.currency] ?? 0) + balances[i];
    return acc;
  }, {});

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Wallet className="size-5 text-primary" /> Caja
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {accounts.length} cuentas · {movements.length} movimientos recientes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TransferFormDialog accounts={accounts}>
            <Button variant="outline" className="gap-2">⇄ Transferir</Button>
          </TransferFormDialog>
          <MovementFormDialog accounts={accounts}>
            <Button className="gap-2"><Plus size={16} /> Movimiento</Button>
          </MovementFormDialog>
        </div>
      </div>

      {/* Totals por moneda */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(totalsByCurrency).map(([currency, total]) => (
          <Card key={currency} className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Total {currency}</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((acc, i) => (
              <Card key={acc.id} className="p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="size-8 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0"
                      style={{ backgroundColor: acc.color ?? "#0F766E" }}
                    >
                      <Wallet size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{acc.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{acc.type} · {acc.currency}</div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-2xl font-semibold tabular-nums">
                  {formatMoney(balances[i], acc.currency)}
                </div>
              </Card>
            ))}
          </div>
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
