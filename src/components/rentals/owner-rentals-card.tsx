import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RentalOwnerStatement, RentalProperty } from "@/lib/types/database";
import { formatContractNumber, formatStatementNumber, propertyAddress, statementStatusMeta } from "@/lib/rentals/labels";
import { logRentalsError, rentalsContext } from "@/lib/rentals/server/access";
import { computePendingForOwners, type OwnerPending } from "@/lib/rentals/server/statements";
import { Money, StatusBadge } from "@/components/rentals/ui";
import { shortDate } from "@/components/rentals/adjustments/adjustment-text";

/**
 * Tarjeta "Alquileres tradicionales" en la ficha del propietario: sus
 * propiedades, quién las alquila y a cuánto, lo que tiene pendiente de
 * rendir y su última rendición. Se muestra sólo con el módulo encendido.
 */

type PropertyLite = Pick<RentalProperty, "id" | "code" | "street" | "street_number" | "floor" | "apartment" | "tower" | "availability" | "active">;

interface Row {
  property: PropertyLite;
  pct: number;
  contract: { id: string; number: number; status: string; current_rent: number; currency: string; end_date: string; tenant: string | null } | null;
}

async function load(ownerId: string) {
  const r = await rentalsContext("view");
  if (!r.ok) return null;
  const { ctx } = r;
  const org = ctx.organization.id;
  const { data: links, error } = await ctx.admin
    .from("rental_property_owners")
    .select("ownership_pct, property:rental_properties(id, code, street, street_number, floor, apartment, tower, availability, active)")
    .eq("organization_id", org)
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
  const owned = ((links ?? []) as unknown as { ownership_pct: number | string; property: PropertyLite | null }[]).filter((l) => l.property);
  const ids = owned.map((l) => l.property!.id);
  const [contractsRes, pending, lastRes] = await Promise.all([
    ids.length
      ? ctx.admin
          .from("rental_contracts")
          .select("id, number, status, property_id, current_rent, currency, end_date, parties:rental_contract_parties(role, is_primary, person:rental_people(full_name))")
          .eq("organization_id", org)
          .in("property_id", ids)
          .in("status", ["vigente", "borrador"])
      : Promise.resolve({ data: [], error: null }),
    ids.length ? computePendingForOwners(ctx.admin, org, { cutoff: ctx.today, ownerIds: [ownerId] }) : Promise.resolve([] as OwnerPending[]),
    ctx.admin
      .from("rental_owner_statements")
      .select("id, number, status, net_amount, currency, generated_at, paid_at")
      .eq("organization_id", org)
      .eq("owner_id", ownerId)
      .neq("status", "anulada")
      .order("generated_at", { ascending: false })
      .limit(1),
  ]);
  type C = { id: string; number: number; status: string; property_id: string; current_rent: number | string; currency: string; end_date: string; parties: { role: string; is_primary: boolean; person: { full_name: string } | null }[] | null };
  const contracts = (contractsRes.data ?? []) as unknown as C[];
  const byProperty = new Map<string, C>();
  for (const c of contracts) {
    const prev = byProperty.get(c.property_id);
    if (!prev || (prev.status !== "vigente" && c.status === "vigente")) byProperty.set(c.property_id, c);
  }
  const rows: Row[] = owned.map((l) => {
    const c = byProperty.get(l.property!.id);
    const tenants = (c?.parties ?? []).filter((p) => p.role === "inquilino" && p.person);
    return {
      property: l.property!,
      pct: Number(l.ownership_pct),
      contract: c
        ? {
            id: c.id,
            number: c.number,
            status: c.status,
            current_rent: Number(c.current_rent),
            currency: c.currency,
            end_date: c.end_date,
            tenant: (tenants.find((p) => p.is_primary) ?? tenants[0])?.person?.full_name ?? null,
          }
        : null,
    };
  });
  const last = ((lastRes.data ?? [])[0] ?? null) as Pick<RentalOwnerStatement, "id" | "number" | "status" | "net_amount" | "currency" | "generated_at" | "paid_at"> | null;
  return { rows, pending: pending.filter((p) => Math.abs(p.totals.net) > 0.005 || p.collectedCount > 0), last };
}

export async function OwnerRentalsCard({ ownerId }: { ownerId: string }) {
  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(ownerId);
  } catch (e) {
    logRentalsError("OwnerRentalsCard", e);
    return (
      <Card className="p-5 lg:col-span-3 text-sm text-muted-foreground border-dashed">No se pudieron leer sus alquileres tradicionales.</Card>
    );
  }
  if (!data) return null;
  const { rows, pending, last } = data;

  return (
    <Card className="p-5 lg:col-span-3 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-[#0d9488]" />
        <h2 className="font-medium">Alquileres tradicionales</h2>
        {rows.length > 0 && <Badge variant="secondary">{rows.length} {rows.length === 1 ? "propiedad" : "propiedades"}</Badge>}
        <Link href="/dashboard/alquileres/rendiciones" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Rendiciones <ArrowRight size={12} />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tiene propiedades en alquiler tradicional.{" "}
          <Link href="/dashboard/alquileres/propiedades" className="font-medium text-foreground underline-offset-4 hover:underline">
            Cargá una en Propiedades
          </Link>{" "}
          y elegilo como dueño.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-900/60 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-800/80 dark:text-emerald-300/80">Pendiente de rendir</p>
              {pending.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Nada: todo lo cobrado ya se rindió.</p>
              ) : (
                pending.map((p) => (
                  <div key={p.currency} className="mt-1 flex flex-wrap items-baseline gap-x-2">
                    <Money amount={p.totals.net} currency={p.currency} tone="in" className="text-lg font-semibold" />
                    <span className="text-xs text-muted-foreground">
                      {p.collectedCount} {p.collectedCount === 1 ? "cobro" : "cobros"}
                      {p.lastPaidAt ? ` · el último el ${shortDate(p.lastPaidAt.slice(0, 10))}` : ""}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="rounded-lg border bg-muted/40 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Última rendición</p>
              {last ? (
                <Link href={`/dashboard/alquileres/rendiciones/${last.id}`} className="mt-1 flex flex-wrap items-center gap-2 hover:underline underline-offset-4">
                  <span className="font-mono text-xs text-muted-foreground">N° {formatStatementNumber(last.number)}</span>
                  <Money amount={Number(last.net_amount)} currency={last.currency} className="text-sm font-semibold" />
                  <StatusBadge meta={statementStatusMeta(last.status, Number(last.net_amount))} compact />
                </Link>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Todavía no se le hizo ninguna.</p>
              )}
            </div>
          </div>

          <ul className="divide-y rounded-lg border">
            {rows.map((r) => {
              const c = r.contract;
              return (
                <li key={r.property.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/alquileres/propiedades/${r.property.id}`} className="block truncate text-sm font-medium hover:underline underline-offset-4">
                      {propertyAddress(r.property)}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {c ? (
                        <>
                          <Link href={`/dashboard/alquileres/contratos/${c.id}`} className="font-mono hover:text-foreground">
                            {formatContractNumber(c.number)}
                          </Link>
                          {" · "}
                          {c.status === "borrador" ? "Contrato en borrador" : c.tenant ?? "Sin inquilino cargado"}
                        </>
                      ) : (
                        "Vacante"
                      )}
                      {r.pct < 100 ? ` · ${r.pct.toLocaleString("es-AR", { maximumFractionDigits: 2 })} % suyo` : ""}
                    </p>
                  </div>
                  {c && c.status === "vigente" && (
                    <div className="flex items-baseline gap-3 text-xs text-muted-foreground sm:text-right">
                      <Money amount={c.current_rent} currency={c.currency} className="text-sm font-semibold text-foreground" />
                      <span>vence {shortDate(c.end_date)}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
