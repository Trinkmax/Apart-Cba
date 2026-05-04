import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import {
  getAccount,
  getAccountStats,
  listAccountMovements,
  listAccounts,
  listLatestAuditByAccount,
} from "@/lib/actions/cash";
import { listUnitsEnriched } from "@/lib/actions/units";
import { AccountDetailHeader } from "@/components/cash/account-detail-header";
import { AccountMovementsFilterBar } from "@/components/cash/account-movements-filter-bar";
import { AccountMovementsTable } from "@/components/cash/account-movements-table";
import { formatMoney } from "@/lib/format";

interface SearchParams {
  q?: string;
  cat?: string;
  dir?: string;
  from?: string;
  to?: string;
  page?: string;
}

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { accountId } = await params;
  const sp = await searchParams;

  const accountResult = await getAccount(accountId);
  if (!accountResult) notFound();
  const { account, balance } = accountResult;

  const [stats, { rows, total }, accounts, units] = await Promise.all([
    getAccountStats(accountId),
    listAccountMovements({
      accountId,
      search: sp.q,
      category: (sp.cat as never) ?? "all",
      direction: (sp.dir as never) ?? "all",
      fromDate: sp.from ? new Date(sp.from).toISOString() : undefined,
      toDate: sp.to ? new Date(sp.to + "T23:59:59").toISOString() : undefined,
      page: sp.page ? Number(sp.page) : 0,
      pageSize: 50,
    }),
    listAccounts(),
    listUnitsEnriched(),
  ]);

  const unitsForMovement = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));

  // Resumen del período filtrado (visible en la barra inferior)
  const periodIn = rows.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount, 0);
  const periodOut = rows.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount, 0);

  // Última auditoría por movimiento (informativo en la lista)
  const latestAudit = await listLatestAuditByAccount(
    accountId,
    rows.map((r) => r.id)
  );

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto pb-24">
      <AccountDetailHeader
        account={account}
        balance={balance}
        stats={stats}
        accounts={accounts}
        units={unitsForMovement}
      />

      {/* Movimientos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Movimientos {total > 0 && <span className="text-muted-foreground/70 font-normal">({total})</span>}
          </h2>
        </div>

        <AccountMovementsFilterBar
          category={sp.cat ?? "all"}
          direction={sp.dir ?? "all"}
          search={sp.q ?? ""}
          fromDate={sp.from ?? ""}
          toDate={sp.to ?? ""}
        />

        <AccountMovementsTable
          rows={rows}
          accounts={accounts}
          units={unitsForMovement}
          accountCurrency={account.currency}
          latestAudit={latestAudit}
        />
      </div>

      {/* Resumen sticky inferior (sólo desktop, mobile el bottom-tab nav lo tapa) */}
      {rows.length > 0 && (
        <div className="hidden md:block fixed bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <Card className="px-4 py-2 shadow-lg backdrop-blur-md bg-background/95 pointer-events-auto">
            <div className="flex items-center gap-5 text-xs">
              <div>
                <span className="text-muted-foreground">Ingresos: </span>
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  + {formatMoney(periodIn, account.currency)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Egresos: </span>
                <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                  − {formatMoney(periodOut, account.currency)}
                </span>
              </div>
              <div className="border-l pl-5">
                <span className="text-muted-foreground">Neto: </span>
                <span
                  className={`font-semibold tabular-nums ${
                    periodIn - periodOut >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {formatMoney(periodIn - periodOut, account.currency)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
