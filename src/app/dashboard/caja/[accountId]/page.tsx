import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  getAccount,
  getAccountStats,
  listAccountMovements,
  listAccounts,
  listLatestAuditByAccount,
} from "@/lib/actions/cash";
import { listUnitRefs } from "@/lib/actions/units";
import { AccountDetailHeader } from "@/components/cash/account-detail-header";
import { AccountMovementsFilterBar } from "@/components/cash/account-movements-filter-bar";
import { AccountMovementsTable } from "@/components/cash/account-movements-table";
import { formatMoney } from "@/lib/format";
import { parseCashSearch } from "@/lib/cash/search";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

interface SearchParams {
  q?: string;
  cat?: string;
  dir?: string;
  bill?: string;
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
  const raw = await searchParams;
  // `?q=a&q=b` llega como array: cada filtro se toma sólo si es un string.
  const sp = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => typeof v === "string"),
  ) as SearchParams;

  const accountResult = await getAccount(accountId);
  if (!accountResult) notFound();
  const { account, balance } = accountResult;

  const page = Math.max(0, Math.floor(Number(sp.page)) || 0);
  const [stats, { rows, total, totals }, accounts, units] = await Promise.all([
    getAccountStats(accountId),
    listAccountMovements({
      accountId,
      search: sp.q,
      category: (sp.cat as never) ?? "all",
      direction: (sp.dir as never) ?? "all",
      billableTo: (sp.bill as never) ?? "all",
      fromDate: sp.from ? new Date(sp.from).toISOString() : undefined,
      toDate: sp.to ? new Date(sp.to + "T23:59:59").toISOString() : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    listAccounts(),
    listUnitRefs(),
  ]);

  const unitsForMovement = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));

  // Resumen de TODO lo filtrado (no sólo de la página visible): con una
  // búsqueda, "Ingresos/Egresos" contesta "¿cuánto entró/salió de esto?".
  const periodIn = totals.reduce((s, t) => s + t.in, 0);
  const periodOut = totals.reduce((s, t) => s + t.out, 0);
  const highlight = parseCashSearch(sp.q).map((t) => t.text);
  const filtered =
    highlight.length > 0 ||
    (!!sp.cat && sp.cat !== "all") ||
    (!!sp.dir && sp.dir !== "all") ||
    (!!sp.bill && sp.bill !== "all") ||
    !!sp.from ||
    !!sp.to;
  const pageHref = (n: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "page") next.set(k, v);
    if (n > 0) next.set("page", String(n));
    const qs = next.toString();
    return `/dashboard/caja/${accountId}${qs ? `?${qs}` : ""}#movimientos`;
  };
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

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
      <div id="movimientos" className="space-y-3 scroll-mt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Movimientos {total > 0 && <span className="text-muted-foreground/70 font-normal">({total})</span>}
          </h2>
        </div>

        <AccountMovementsFilterBar
          category={sp.cat ?? "all"}
          direction={sp.dir ?? "all"}
          billable={sp.bill ?? "all"}
          search={sp.q ?? ""}
          fromDate={sp.from ?? ""}
          toDate={sp.to ?? ""}
        />

        {/* Resumen en mobile (la barra flotante es sólo de escritorio) */}
        {filtered && total > 0 && (
          <div className="md:hidden flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{total}</span> {total === 1 ? "movimiento" : "movimientos"}
            </span>
            <span className="flex items-center gap-3 tabular-nums font-semibold">
              <span className="text-emerald-600 dark:text-emerald-400">+ {formatMoney(periodIn, account.currency)}</span>
              <span className="text-rose-600 dark:text-rose-400">− {formatMoney(periodOut, account.currency)}</span>
            </span>
          </div>
        )}

        <AccountMovementsTable
          rows={rows}
          accounts={accounts}
          units={unitsForMovement}
          accountCurrency={account.currency}
          latestAudit={latestAudit}
          highlight={highlight}
          searchQuery={sp.q}
        />

        {lastPage > 0 && (
          <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Páginas de movimientos">
            <span className="text-xs text-muted-foreground tabular-nums">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
            </span>
            <div className="flex items-center gap-1.5">
              <PagerLink href={pageHref(page - 1)} disabled={page === 0} label="Anterior">
                <ChevronLeft size={14} /> Anterior
              </PagerLink>
              <PagerLink href={pageHref(page + 1)} disabled={page >= lastPage} label="Siguiente">
                Siguiente <ChevronRight size={14} />
              </PagerLink>
            </div>
          </nav>
        )}
      </div>

      {/* Resumen sticky inferior (sólo desktop, mobile el bottom-tab nav lo tapa) */}
      {rows.length > 0 && (
        <div className="hidden md:block fixed bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <Card className="px-4 py-2 shadow-lg backdrop-blur-md bg-background/95 pointer-events-auto">
            <div className="flex items-center gap-5 text-xs">
              <div className="text-muted-foreground">
                {filtered ? (
                  <>
                    <span className="font-semibold tabular-nums text-foreground">{total}</span>{" "}
                    {total === 1 ? "filtrado" : "filtrados"}
                  </>
                ) : (
                  "Histórico"
                )}
              </div>
              <div className="border-l pl-5">
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

function PagerLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const cls = cn(
    "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors",
    disabled ? "pointer-events-none opacity-40" : "hover:bg-accent",
  );
  if (disabled) {
    return (
      <span className={cls} aria-disabled="true" aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cls} aria-label={label}>
      {children}
    </Link>
  );
}
