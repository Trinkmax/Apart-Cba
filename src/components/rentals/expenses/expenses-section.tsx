import { HandCoins, KeyRound, Plus, User, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { listExpenses } from "@/lib/actions/rentals-expenses";
import { SectionTitle } from "@/components/rentals/ui";
import { ExpenseFormDialog } from "./expense-form-dialog";
import { ExpensesListClient } from "./expenses-list-client";

/**
 * Gastos y arreglos de una propiedad (o de un contrato): alta, estado y a
 * dónde fue a parar cada uno (rendición del propietario / cargo del
 * inquilino / la inmobiliaria). Server component: lo usan la ficha de la
 * propiedad y la pestaña "Gastos" del contrato.
 */
export async function ExpensesSection({ propertyId, contractId }: { propertyId: string; contractId?: string | null }) {
  const res = await listExpenses({ propertyId, contractId: contractId ?? null });

  const addButton = (
    <ExpenseFormDialog propertyId={propertyId} contractId={contractId}>
      <Button size="sm" className="gap-1.5 shrink-0">
        <Plus size={14} /> <span className="hidden sm:inline">Cargar gasto</span>
        <span className="sm:hidden">Gasto</span>
      </Button>
    </ExpenseFormDialog>
  );

  if (!res.ok) {
    return (
      <section className="space-y-3">
        <SectionTitle action={addButton}>Gastos y arreglos</SectionTitle>
        <Card className="p-4 text-sm text-rose-700 dark:text-rose-300 border-rose-500/25 bg-rose-500/5">{res.error}</Card>
      </section>
    );
  }

  const { items, summary } = res;
  const pendingChips = summary.byCurrency.flatMap((c) => [
    c.toDeduct > 0 ? { key: `d-${c.currency}`, label: "A descontar al propietario", value: formatMoney(c.toDeduct, c.currency), tone: "text-amber-700 dark:text-amber-300" } : null,
    c.toCharge > 0 ? { key: `c-${c.currency}`, label: "A cobrar al inquilino", value: formatMoney(c.toCharge, c.currency), tone: "text-sky-700 dark:text-sky-300" } : null,
    c.unpaid > 0 ? { key: `u-${c.currency}`, label: "Sin pagar", value: formatMoney(c.unpaid, c.currency), tone: "text-rose-600 dark:text-rose-400" } : null,
  ]).filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <section className="space-y-3">
      <SectionTitle
        hint={contractId ? "Arreglos y gastos de este contrato, y a quién le tocan." : "Arreglos, impuestos y expensas extraordinarias de la propiedad."}
        action={addButton}
      >
        Gastos y arreglos
      </SectionTitle>

      {items.length === 0 ? (
        <Card className="p-5 sm:p-6 border-dashed gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cyan-500/12 text-cyan-700 dark:text-cyan-400">
              <Wrench size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold">Todavía no hay gastos cargados</p>
              <p className="text-xs text-muted-foreground mt-0.5">Cargá cada arreglo o impuesto una vez y el sistema lo lleva a donde corresponde.</p>
            </div>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: KeyRound, title: "Del propietario", body: "Se descuenta solo en su próxima rendición, según su % de la propiedad." },
              { icon: User, title: "Del inquilino", body: "Se suma a su próximo cargo mensual y lo recupera quien lo pagó." },
              { icon: HandCoins, title: "De la inmobiliaria", body: "Queda registrado; si sale de Caja, se anota el egreso." },
            ].map((s) => (
              <li key={s.title} className="flex gap-2.5 sm:flex-col sm:gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <s.icon size={14} />
                </span>
                <span>
                  <span className="block text-sm font-medium leading-snug">{s.title}</span>
                  <span className="block text-xs text-muted-foreground leading-relaxed">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <>
          {pendingChips.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {pendingChips.map((c) => (
                <div key={c.key} className="rounded-lg border bg-muted/40 px-3 py-2 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{c.label}</div>
                  <div className={`text-base font-semibold tabular-nums truncate ${c.tone}`}>{c.value}</div>
                </div>
              ))}
            </div>
          )}
          <ExpensesListClient items={items} propertyId={propertyId} contractId={contractId} showContract={!contractId} />
        </>
      )}
    </section>
  );
}
