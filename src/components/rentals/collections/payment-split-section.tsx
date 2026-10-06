"use client";

import Link from "next/link";
import { AlertTriangle, ExternalLink, Landmark, Loader2, RefreshCw, Split, UserRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyButton } from "@/components/rentals/statements/copy-button";
import type { PaymentSplit } from "@/lib/rentals/payment-split";
import type { PaymentOwner, PaymentSetup } from "@/lib/rentals/server/collections-queries";
import type { RentalPaymentMethod } from "@/lib/types/database";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Num } from "./payment-preview-panel";
import {
  agencyBreakdown,
  needsAgencyAccount,
  ownerPartNote,
  pctLabel,
  showsRemainderWarning,
  splitOwnerRows,
  type PayRoute,
  type SplitOwnerRow,
} from "./split-view";

/** CBU / alias con su botón de copiar (en el teléfono el botón es más grande, para el dedo). */
function BankLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 text-xs">
        <span className="text-muted-foreground">{label} </span>
        <span className="font-mono break-all">{value}</span>
      </span>
      <CopyButton value={value} label={label} className="size-10 sm:size-7" />
    </div>
  );
}

function OwnerCard({
  row,
  showShare,
  loading,
  money,
  onRefreshOwners,
  refreshingOwners,
}: {
  row: SplitOwnerRow;
  showShare: boolean;
  loading: boolean;
  money: (n: number) => string;
  onRefreshOwners?: () => void;
  refreshingOwners?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2 space-y-1.5 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium break-words">
          {row.name}
          {showShare && <span className="font-normal text-muted-foreground"> · {pctLabel(row.pct)}</span>}
        </p>
        {showShare && (
          <Num loading={loading} className="text-sm">
            {money(row.amount)}
          </Num>
        )}
      </div>
      {row.bank?.bankName && <p className="text-[11px] text-muted-foreground break-words">{row.bank.bankName}</p>}
      {row.bank?.cbu && <BankLine label="CBU" value={row.bank.cbu} />}
      {row.bank?.alias && <BankLine label="Alias" value={row.bank.alias} />}
      {row.missingBank && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-100 space-y-1">
          <p className="flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span className="min-w-0">Falta el CBU o alias de {row.name}.</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-4">
            <Link
              href={`/dashboard/propietarios/${row.ownerId}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline min-h-9"
            >
              Cargarlo en su ficha <ExternalLink size={11} aria-hidden />
            </Link>
            {onRefreshOwners && (
              <button
                type="button"
                onClick={onRefreshOwners}
                disabled={refreshingOwners}
                className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline min-h-9 disabled:opacity-60"
              >
                {refreshingOwners ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <RefreshCw size={11} aria-hidden />}
                Ya lo cargué
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Las respuestas a "¿Cómo pagó el inquilino?" (lo esperado primero). */
function routeOptions(split: PaymentSplit, agencyName: string, money: (n: number) => string): { value: PayRoute; title: string; hint: string }[] {
  return [
    {
      value: "cada_uno",
      title: "Le pagó a cada uno su parte",
      hint: `${money(split.owner.total)} al propietario y ${money(split.agency.total)} a ${agencyName}`,
    },
    { value: "todo_propietario", title: "Le pagó todo al propietario", hint: `Después él le pasa a ${agencyName} los ${money(split.agency.total)}` },
    { value: "todo_inmobiliaria", title: `Le pagó todo a ${agencyName}`, hint: `Después hay que pasarle al propietario los ${money(split.owner.total)}` },
  ];
}

/** Cuenta de Caja donde entra la parte de la inmobiliaria (o el aviso si no hay ninguna). */
function AccountPicker({
  label,
  hint,
  accounts,
  accountId,
  onAccountChange,
  invalid,
  currency,
  agencyName,
}: {
  label: string;
  hint: string | null;
  accounts: PaymentSetup["accounts"];
  accountId: string;
  onAccountChange: (id: string) => void;
  invalid: boolean;
  currency: string;
  agencyName: string;
}) {
  if (accounts.length === 0) {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
        No hay cuentas de Caja activas en {currency}.{" "}
        <Link href="/dashboard/caja" className="underline hover:no-underline">
          Creá una en Caja
        </Link>{" "}
        para registrar la parte de {agencyName}.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="pay-agency-account">{label}</Label>
      <Select value={accountId} onValueChange={onAccountChange}>
        <SelectTrigger id="pay-agency-account" className="h-10 w-full" aria-invalid={invalid}>
          <SelectValue placeholder="Elegí la cuenta" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && !invalid && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Reparto de un cobro que el inquilino le paga directo al propietario: cuánto
 * va a la cuenta del propietario (con su CBU / alias a la vista), cuánto a la
 * inmobiliaria, cómo pagó de verdad el inquilino y en qué cuenta de Caja entra
 * la parte de la inmobiliaria.
 */
export function PaymentSplitSection({
  split,
  owners,
  agencyName,
  currency,
  method,
  loading,
  stale,
  accounts,
  accountId,
  onAccountChange,
  accountError,
  route,
  onRouteChange,
  ownerPassed,
  onOwnerPassedChange,
  routeError,
  debt,
  onAmountToDebt,
  onRefreshOwners,
  refreshingOwners,
}: {
  split: PaymentSplit;
  owners: PaymentOwner[];
  /** "Apart CBA" (o "la inmobiliaria" si no hay nombre). */
  agencyName: string;
  currency: string;
  /** Medio de pago elegido: cambia el verbo de los textos ("transfiere" / "paga"). */
  method: RentalPaymentMethod;
  /** El servidor está recalculando: los montos pasan a esqueleto. */
  loading: boolean;
  /** No se pudo recalcular: los montos que se ven son de antes. */
  stale: boolean;
  accounts: PaymentSetup["accounts"];
  accountId: string;
  onAccountChange: (id: string) => void;
  accountError: string | null;
  /** Cómo pagó el inquilino (null = todavía no lo eligieron). */
  route: PayRoute | null;
  onRouteChange: (route: PayRoute) => void;
  /** Le pagó todo al propietario y él ya le pasó a la inmobiliaria su parte. */
  ownerPassed: boolean;
  onOwnerPassedChange: (passed: boolean) => void;
  routeError: string | null;
  /** Lo que debe hoy, para el botón "cobrar sólo lo que debe" del aviso de plata que sobra. */
  debt?: number;
  onAmountToDebt?: () => void;
  onRefreshOwners?: () => void;
  refreshingOwners?: boolean;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const rows = splitOwnerRows(split, owners);
  const hasAgency = needsAgencyAccount(split);
  const lines = agencyBreakdown(split, currency);
  const empty = !(split.total > 0.004);
  const showPicker = hasAgency && (route === "cada_uno" || route === "todo_inmobiliaria" || (route === "todo_propietario" && ownerPassed));
  const pickerLabel =
    route === "todo_propietario"
      ? "¿En qué cuenta te los pasó?"
      : route === "todo_inmobiliaria"
        ? "¿En qué cuenta entró la plata?"
        : `¿En qué cuenta entraron los ${money(split.agency.total)}?`;
  const warnBox = "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100";

  return (
    <section className="rounded-xl border bg-card overflow-hidden min-w-0" aria-labelledby="pay-split-title" aria-busy={loading}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <h3 id="pay-split-title" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Split size={13} aria-hidden /> Reparto del cobro
        </h3>
        {loading && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 size={12} className="animate-spin" aria-hidden /> Calculando…
          </span>
        )}
      </div>

      {empty ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Escribí el importe y te mostramos cuánto va a la cuenta del propietario y cuánto a {agencyName}.
        </p>
      ) : (
        <div className={cn("transition-opacity", stale && "opacity-60")}>
          <div className="space-y-2 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <UserRound size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                  {rows.length > 1 ? "A los propietarios" : "Al propietario"}
                </p>
                <p className="text-[11px] text-muted-foreground">{ownerPartNote(route, method, agencyName)}</p>
              </div>
              <Num loading={loading} className="text-sm font-semibold">
                {money(split.owner.total)}
              </Num>
            </div>
            {rows.length === 0 ? (
              <p className="text-[11px] text-amber-800 dark:text-amber-200">La propiedad no tiene propietario cargado: agregalo en la ficha de la propiedad.</p>
            ) : (
              rows.map((row) => (
                <OwnerCard
                  key={row.ownerId}
                  row={row}
                  showShare={rows.length > 1}
                  loading={loading}
                  money={money}
                  onRefreshOwners={onRefreshOwners}
                  refreshingOwners={refreshingOwners}
                />
              ))
            )}
          </div>

          <div className="space-y-2 border-t px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-1.5 min-w-0">
                  <Landmark size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 break-words">A {agencyName}</span>
                </p>
                {!hasAgency ? (
                  <p className="text-[11px] text-muted-foreground">Todo este cobro es del propietario: no entra nada a Caja.</p>
                ) : lines.length === 1 ? (
                  <p className="text-[11px] text-muted-foreground">{lines[0].label}.</p>
                ) : null}
              </div>
              <Num loading={loading} className={cn("text-sm font-semibold", !hasAgency && "text-muted-foreground")}>
                {money(split.agency.total)}
              </Num>
            </div>
            {hasAgency && lines.length > 1 && (
              <ul className="space-y-0.5">
                {lines.map((l) => (
                  <li key={l.label} className="flex items-start justify-between gap-3 text-[11px] text-muted-foreground">
                    <span className="min-w-0">{l.label}</span>
                    <Num loading={loading}>{money(l.amount)}</Num>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {hasAgency && (
            <div className="space-y-2.5 border-t px-3 py-3">
              <fieldset id="pay-route" className="min-w-0" aria-describedby={routeError ? "pay-route-error" : undefined}>
                <legend className="mb-1.5 text-sm font-medium">¿Cómo pagó el inquilino?</legend>
                <div className="grid gap-1.5">
                  {routeOptions(split, agencyName, money).map((o) => {
                    const checked = route === o.value;
                    return (
                      <label
                        key={o.value}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                          "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                          checked ? "border-emerald-600/60 bg-emerald-500/5" : "hover:bg-muted/50",
                          !!routeError && !route && "border-rose-500/50",
                        )}
                      >
                        <input
                          type="radio"
                          name="pay-route"
                          value={o.value}
                          checked={checked}
                          onChange={() => onRouteChange(o.value)}
                          className="mt-0.5 size-4 shrink-0 accent-emerald-600"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium break-words">{o.title}</span>
                          <span className="block text-[11px] text-muted-foreground break-words">{o.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {routeError && (
                <p id="pay-route-error" className="text-xs text-rose-600 dark:text-rose-400">
                  {routeError}
                </p>
              )}

              {route === "todo_propietario" && (
                <div className={cn(warnBox, "space-y-2")}>
                  <p>
                    Los <span className="font-semibold">{money(split.agency.total)}</span> de {agencyName} los tiene el propietario. Registrá el cobro cuando él te
                    los pase: así la Caja no muestra plata que todavía no entró. Mientras tanto, la cuenta del inquilino sigue mostrando la deuda.
                  </p>
                  <div className="flex items-start gap-2 min-h-9">
                    <Checkbox
                      id="pay-owner-passed"
                      checked={ownerPassed}
                      onCheckedChange={(v) => onOwnerPassedChange(v === true)}
                      className="mt-0.5 bg-background"
                    />
                    <Label htmlFor="pay-owner-passed" className="text-xs font-medium leading-snug cursor-pointer">
                      El propietario ya me pasó los {money(split.agency.total)}
                    </Label>
                  </div>
                </div>
              )}
              {route === "todo_inmobiliaria" && (
                <p className={warnBox}>
                  A Caja entran sólo los <span className="font-semibold">{money(split.agency.total)}</span> de {agencyName}. Los{" "}
                  <span className="font-semibold">{money(split.owner.total)}</span> son del propietario: pasáselos desde esa cuenta y no los cargues en Caja.
                </p>
              )}

              {/* Sin cuentas de Caja el aviso aparece enseguida: con cualquier respuesta hace falta una. */}
              {(showPicker || accounts.length === 0) && (
                <AccountPicker
                  label={pickerLabel}
                  hint={route === "cada_uno" ? "Entra a Caja en la cuenta que elijas." : null}
                  accounts={accounts}
                  accountId={accountId}
                  onAccountChange={onAccountChange}
                  invalid={!!accountError}
                  currency={currency}
                  agencyName={agencyName}
                />
              )}
              {accountError && <p className="text-xs text-rose-600 dark:text-rose-400">{accountError}</p>}
            </div>
          )}

          {showsRemainderWarning(split) && (
            <div className={cn(warnBox, "mx-3 mb-3 flex items-start gap-2")}>
              <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p>
                  Sobran <Num loading={loading}>{money(split.remainder)}</Num>: quedan como saldo a favor del inquilino, dentro de la parte del propietario, y no se les
                  cobra comisión. Si es un adelanto, registrá ahora sólo lo que debe y el resto cuando aparezca el cargo del mes que viene: así la comisión sale bien.
                </p>
                {onAmountToDebt && debt != null && debt > 0.004 && (
                  <button
                    type="button"
                    onClick={onAmountToDebt}
                    className="inline-flex items-center font-medium underline underline-offset-2 hover:no-underline min-h-9"
                  >
                    Cobrar sólo lo que debe ({money(debt)})
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
