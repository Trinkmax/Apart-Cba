import Link from "next/link";
import { ArrowRight, BanknoteArrowUp, Building, CheckCircle2, Clock, HandCoins, Inbox, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { isYmd } from "@/lib/rentals/ymd";
import { formatDate, formatMoney } from "@/lib/format";
import { listPendingByOwner, listStatements } from "@/lib/actions/rentals-statements";
import { HowItWorks, KpiCard, PageHeader, SectionTitle } from "@/components/rentals/ui";
import { PendingOwners } from "@/components/rentals/statements/pending-owners";
import { CutoffControl } from "@/components/rentals/statements/cutoff-control";
import { StatementsListClient } from "@/components/rentals/statements/statements-list-client";

export const metadata = { title: "Rendiciones" };

/** Suma por moneda → "$ 1.200.000,00" + "y US$ 300,00" (ARS primero). */
function byCurrency(rows: { currency: string; amount: number }[]): { main: string; rest: string | null } {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? 0) + r.amount);
  const entries = [...m.entries()].sort((a, b) => (a[0] === "ARS" ? -1 : b[0] === "ARS" ? 1 : b[1] - a[1]));
  if (!entries.length) return { main: formatMoney(0, "ARS"), rest: null };
  const [first, ...others] = entries;
  return { main: formatMoney(first[1], first[0]), rest: others.length ? `y ${others.map(([c, v]) => formatMoney(v, c)).join(" · ")}` : null };
}

export default async function RendicionesPage({ searchParams }: { searchParams: Promise<{ corte?: string }> }) {
  const ctx = await requireRentalsPage();
  const sp = await searchParams;
  const cutoff = sp.corte && isYmd(sp.corte) && sp.corte <= ctx.today ? sp.corte : ctx.today;
  const [pendingRes, listRes] = await Promise.all([listPendingByOwner(cutoff), listStatements()]);
  const board = pendingRes.ok ? pendingRes.board : null;
  const items = listRes.ok ? listRes.items : [];

  const pendingNet = byCurrency((board?.cards ?? []).filter((c) => c.totals.net > 0).map((c) => ({ currency: c.currency, amount: c.totals.net })));
  const open = items.filter((i) => i.status === "borrador" || i.status === "emitida");
  const openNet = byCurrency(open.filter((i) => i.net > 0).map((i) => ({ currency: i.currency, amount: i.net })));
  const openDrafts = open.filter((i) => i.status === "borrador").length;
  const month = ctx.today.slice(0, 7);
  // Una rendición cerrada con saldo a cuenta (neto <= 0) no es un pago: no suma acá.
  const paidOut = items.filter((i) => i.status === "pagada" && i.net > 0);
  const paidMonth = paidOut.filter((i) => i.paidAt?.slice(0, 7) === month);
  const paidNet = byCurrency(paidMonth.map((i) => ({ currency: i.currency, amount: i.net })));
  const firstRun = !!board && board.ownersWithProperties === 0 && items.length === 0;

  return (
    <div className="page-x page-y mx-auto max-w-[1400px] space-y-4 sm:space-y-5 md:space-y-6">
      <LiveRefresh tables={["rental_payments", "rental_charges", "rental_owner_statements", "rental_expenses"]} label="novedad" labelPlural="novedades" throttleMs={5_000} />
      <PageHeader
        icon={BanknoteArrowUp}
        title="Rendiciones"
        subtitle={
          firstRun
            ? "Lo que cobrás para cada propietario, menos honorarios y gastos, listo para transferir."
            : `${board?.cards.length ?? 0} para rendir · ${open.length} sin pagar · ${paidOut.length} ${paidOut.length === 1 ? "pagada" : "pagadas"}`
        }
      />

      {!firstRun && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <KpiCard label="Para rendir" icon={HandCoins} value={pendingNet.main} hint={pendingNet.rest ?? `cobros hasta el ${formatDate(cutoff)}`} tone="in" />
          <KpiCard label="Propietarios esperando" icon={Clock} value={board?.cards.length ?? 0} hint="con cobros sin rendir" />
          <KpiCard
            label="Sin pagar"
            icon={Send}
            value={open.length}
            hint={
              open.length
                ? `${openNet.main}${openNet.rest ? ` ${openNet.rest}` : ""} a transferir${openDrafts ? ` · ${openDrafts} en borrador` : ""}`
                : "nada pendiente"
            }
            tone={open.length ? "warn" : "neutral"}
          />
          <KpiCard label="Pagado este mes" icon={CheckCircle2} value={paidNet.main} hint={paidNet.rest ?? `${paidMonth.length} ${paidMonth.length === 1 ? "rendición" : "rendiciones"}`} />
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <SectionTitle hint="Se rinde lo cobrado, no lo facturado.">Para rendir</SectionTitle>
          {!firstRun && <CutoffControl cutoff={cutoff} today={ctx.today} />}
        </div>
        {!pendingRes.ok ? (
          <Card className="border-rose-500/25 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-300">{pendingRes.error}</Card>
        ) : firstRun ? (
          <Onboarding />
        ) : board && board.cards.length > 0 ? (
          <PendingOwners board={board} today={ctx.today} brandColor={ctx.organization.primary_color} />
        ) : (
          <Card className="flex-row items-center gap-3 border-dashed p-4 sm:p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox size={18} />
            </span>
            <div>
              <p className="text-sm font-medium">Nada para rendir con cobros hasta el {formatDate(cutoff)}</p>
              <p className="text-xs text-muted-foreground">Cada cobro que registres en Cobranzas aparece acá, agrupado por propietario.</p>
            </div>
          </Card>
        )}
      </section>

      {!firstRun && (
        <section className="space-y-3">
          <SectionTitle>Rendiciones</SectionTitle>
          {!listRes.ok ? (
            <Card className="border-rose-500/25 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-300">{listRes.error}</Card>
          ) : items.length === 0 ? (
            <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">Todavía no generaste ninguna rendición.</Card>
          ) : (
            <StatementsListClient items={items} />
          )}
        </section>
      )}

      <HowItWorks title="Cómo se arma una rendición">
        <p>
          <strong className="text-foreground">Se rinde lo cobrado, no lo facturado.</strong> Entra cada pago del inquilino (alquiler, diferencias por ajuste,
          intereses por mora) a conceptos del propietario, una sola vez: si se cobró en partes, cada parte entra en la rendición de su fecha.
        </p>
        <p>
          <strong className="text-foreground">Honorarios de administración:</strong> el % pactado en el contrato sobre el alquiler cobrado (en Córdoba, si no se pactó
          otro, la Ley 9445 fija 10 % de lo cobrado, o 15 % si la propiedad es de otra plaza), más IVA si la inmobiliaria es responsable inscripta. Los
          honorarios por la locación se descuentan una sola vez.
        </p>
        <p>
          <strong className="text-foreground">Gastos:</strong> los arreglos e impuestos cargados “a cargo del propietario” en la propiedad se descuentan en la próxima
          rendición. Con varios dueños, cada uno ve su parte (se trunca al centavo para no rendir de más).
        </p>
        <p>
          <strong className="text-foreground">Si algo salió mal:</strong> anulá la rendición y sus cobros y gastos vuelven a quedar para rendir. Si ya estaba pagada,
          se borran también los egresos de Caja.
        </p>
      </HowItWorks>
    </div>
  );
}

function Onboarding() {
  const steps = [
    { icon: Building, title: "Propiedad y dueños", body: "Cargá la propiedad y quiénes son los propietarios, con su %.", href: "/dashboard/alquileres/propiedades", cta: "Ir a Propiedades" },
    { icon: HandCoins, title: "Cobrá el alquiler", body: "Registrá los pagos del inquilino: cada cobro queda listo para rendir.", href: "/dashboard/alquileres/cobranzas", cta: "Ir a Cobranzas" },
    { icon: Send, title: "Rendí y transferí", body: "Generá la rendición, mandala por mail o WhatsApp y registrá la transferencia.", href: null, cta: null },
  ];
  return (
    <Card className="border-dashed p-5 sm:p-6">
      <p className="text-sm font-semibold">Cómo funciona</p>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 sm:flex-col sm:gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">{i + 1}</span>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium leading-snug">
                <s.icon size={14} /> {s.title}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">{s.body}</p>
              {s.href && (
                <Link href={s.href} className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
                  {s.cta} <ArrowRight size={12} />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
