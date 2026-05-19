import Link from "next/link";
import { Wrench, AlertTriangle, Building2, Clock, Wallet } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { listTickets, listMyTicketsToBudget } from "@/lib/actions/tickets";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MobileBudgetList,
  type BudgetItem,
} from "@/components/tickets/mobile-budget-list";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MaintenanceTicket, Unit } from "@/lib/types/database";

type T = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function MobileTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const { vista } = await searchParams;
  const tab = vista === "presupuestar" ? "presupuestar" : "activos";

  // Independientes → en paralelo (sin waterfall).
  const [allOpen, toBudgetRaw] = await Promise.all([
    listTickets({ openOnly: true }) as Promise<T[]>,
    listMyTicketsToBudget() as Promise<T[]>,
  ]);

  const mine = allOpen.filter((t) => t.assigned_to === session.userId);
  const budgetItems: BudgetItem[] = toBudgetRaw.map((t) => ({
    id: t.id,
    title: t.title,
    unitCode: t.unit?.code ?? "",
    unitName: t.unit?.name ?? "",
    status: t.status,
    finishedAt: t.resolved_at ?? t.closed_at ?? null,
  }));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Wrench className="size-5 text-orange-500" />
        <h1 className="text-xl font-semibold">Mantenimiento</h1>
      </div>

      {/* Segmented tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <TabLink
          href="/m/mantenimiento"
          active={tab === "activos"}
          label="Activos"
          count={mine.length}
        />
        <TabLink
          href="/m/mantenimiento?vista=presupuestar"
          active={tab === "presupuestar"}
          label="Para presupuestar"
          count={budgetItems.length}
          accent
        />
      </div>

      {tab === "activos" ? (
        <>
          {budgetItems.length > 0 ? (
            <Link href="/m/mantenimiento?vista=presupuestar" className="block">
              <Card className="p-3 flex items-center gap-3 border-amber-500/40 bg-amber-500/5 active:scale-[0.99] transition-transform">
                <span className="size-9 rounded-full bg-amber-500/15 grid place-items-center shrink-0">
                  <Wallet className="size-4 text-amber-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">
                    {budgetItems.length}{" "}
                    {budgetItems.length === 1
                      ? "trabajo terminado sin presupuesto"
                      : "trabajos terminados sin presupuesto"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tocá para cargar los montos
                  </p>
                </div>
              </Card>
            </Link>
          ) : null}

          {mine.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <Wrench className="size-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium">Sin tickets asignados</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {mine.map((t) => (
                <TicketRow key={t.id} t={t} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Trabajos que terminaste y todavía no tienen monto. Cargá el
            presupuesto de cada uno — al guardar desaparece de la lista.
          </p>
          <MobileBudgetList items={budgetItems} />
        </>
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  label,
  count,
  accent = false,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors",
        active
          ? "bg-background shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {count > 0 ? (
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-5",
            accent && !active
              ? "bg-amber-500/20 text-amber-700"
              : "bg-muted-foreground/15 text-foreground"
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function TicketRow({ t }: { t: T }) {
  const pm = TICKET_PRIORITY_META[t.priority];
  const sm = TICKET_STATUS_META[t.status];
  return (
    <Link href={`/m/mantenimiento/${t.id}`} className="block">
      <Card className="p-4 hover:shadow-md active:scale-[0.99] transition-all">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold leading-snug min-w-0">{t.title}</div>
          <Badge
            className="text-[10px] gap-1 font-normal shrink-0"
            style={{
              color: pm.color,
              backgroundColor: pm.color + "15",
              borderColor: pm.color + "30",
            }}
          >
            <AlertTriangle size={9} />
            {pm.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground min-w-0">
          <Building2 size={11} className="shrink-0" />
          <span className="font-mono shrink-0">{t.unit.code}</span>
          <span className="truncate">· {t.unit.name}</span>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock size={10} /> {formatTimeAgo(t.opened_at)}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {sm.label}
          </Badge>
        </div>
      </Card>
    </Link>
  );
}
