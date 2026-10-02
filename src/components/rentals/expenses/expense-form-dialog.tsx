"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Wallet, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { formatMoneyEditable } from "@/components/bookings/money-input";
import { prepareImageForUpload } from "@/lib/image-compress";
import { createExpense, getExpenseFormOptions, updateExpense } from "@/lib/actions/rentals-expenses";
import type { RentalExpense, RentalExpenseCategory, RentalExpenseChargedTo, RentalExpensePaidBy } from "@/lib/types/database";
import { chargedToHint, PAID_BY_OPTIONS } from "./expense-meta";
import { CategoryChips, ChargedToPicker, FieldError, FieldLabel, PaidByChips } from "./expense-form-fields";
import type { ExpenseFormOptions } from "./types";

export interface ExpenseFormDialogProps {
  propertyId: string;
  contractId?: string | null;
  expense?: RentalExpense | null;
  children: ReactNode;
  onSaved?: (expense: RentalExpense) => void;
}

interface FormState {
  description: string;
  category: RentalExpenseCategory;
  amount: string;
  currency: string;
  occurredOn: string;
  provider: string;
  chargedTo: RentalExpenseChargedTo;
  paidBy: RentalExpensePaidBy;
  contractId: string;
  notes: string;
  payNow: boolean;
  accountId: string;
  paidAt: string;
}

const MAX_BYTES = 4 * 1024 * 1024;

function initialState(expense: RentalExpense | null | undefined, contractId: string | null | undefined): FormState {
  return {
    description: expense?.description ?? "",
    category: expense?.category ?? "reparacion",
    amount: expense ? formatMoneyEditable(expense.amount).replace(".", ",") : "",
    currency: expense?.currency ?? "",
    occurredOn: expense?.occurred_on ?? "",
    provider: expense?.provider ?? "",
    chargedTo: expense?.charged_to ?? "propietario",
    paidBy: expense?.paid_by ?? "inmobiliaria",
    contractId: expense?.contract_id ?? contractId ?? "",
    notes: expense?.notes ?? "",
    payNow: false,
    accountId: "",
    paidAt: "",
  };
}

/**
 * Alta / edición de un gasto de la propiedad. Envuelve al disparador
 * (`<ExpenseFormDialog propertyId=…><Button/></ExpenseFormDialog>`) y carga
 * sus opciones (contratos, cuentas, dueños) recién al abrirse.
 */
export function ExpenseFormDialog({ propertyId, contractId, expense, children, onSaved }: ExpenseFormDialogProps) {
  const router = useRouter();
  const isEdit = !!expense;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ExpenseFormOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => initialState(expense, contractId));
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const paidFromCaja = !!expense?.cash_movement_id;
  const canPayNow = !paidFromCaja && form.paidBy === "inmobiliaria";
  const accountsForCurrency = (options?.accounts ?? []).filter((a) => a.currency === form.currency);
  const chargeableContracts = (options?.contracts ?? []).filter((c) => c.canCharge);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (error?.field === key) setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setForm(initialState(expense, contractId));
    setFile(null);
    setRemoveFile(false);
    setError(null);
    startLoading(async () => {
      const res = await getExpenseFormOptions(propertyId);
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
      setOptions(res.options);
      const o = res.options;
      setForm((f) => {
        const currency = f.currency || o.defaultCurrency;
        const firstAccount = o.accounts.find((a) => a.currency === currency);
        const vigente = o.contracts.find((c) => c.status === "vigente");
        return {
          ...f,
          currency,
          occurredOn: f.occurredOn || o.today,
          paidAt: o.today,
          accountId: firstAccount?.id ?? "",
          contractId: f.contractId || (f.chargedTo === "inquilino" ? vigente?.id ?? "" : f.contractId),
        };
      });
    });
  }

  function changeChargedTo(next: RentalExpenseChargedTo) {
    setForm((f) => {
      const allowed = PAID_BY_OPTIONS[next];
      const paidBy = allowed.includes(f.paidBy) ? f.paidBy : allowed[0];
      const pick = chargeableContracts.find((c) => c.id === f.contractId) ?? chargeableContracts.find((c) => c.status === "vigente") ?? chargeableContracts[0];
      return { ...f, chargedTo: next, paidBy, contractId: next === "inquilino" ? pick?.id ?? "" : f.contractId };
    });
    if (error?.field === "chargedTo" || error?.field === "contractId" || error?.field === "paidBy") setError(null);
  }

  function changeCurrency(next: string) {
    setForm((f) => ({ ...f, currency: next, accountId: (options?.accounts ?? []).find((a) => a.currency === next)?.id ?? "" }));
  }

  async function pickFile(list: FileList | null) {
    const picked = list?.[0];
    if (!picked) return;
    const ready = picked.type.startsWith("image/") ? await prepareImageForUpload(picked) : picked;
    if (ready.size > MAX_BYTES) {
      toast.error("El archivo pesa más de 4 MB", { description: "Probá con una foto más liviana o un PDF comprimido." });
      return;
    }
    setFile(ready);
    setRemoveFile(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmountInput(form.amount);
    if (!form.description.trim()) return setError({ field: "description", message: "Contá qué fue el gasto." });
    if (amount == null || !(amount > 0)) return setError({ field: "amount", message: "Ingresá un importe válido (por ejemplo 45.000,50)." });
    if (form.chargedTo === "inquilino" && !form.contractId) return setError({ field: "contractId", message: "Elegí el contrato del inquilino." });
    if (canPayNow && form.payNow && !form.accountId) return setError({ field: "accountId", message: "Elegí de qué cuenta sale la plata." });
    const fd = new FormData();
    fd.set("propertyId", propertyId);
    fd.set("contractId", form.contractId);
    fd.set("occurredOn", form.occurredOn);
    fd.set("category", form.category);
    fd.set("description", form.description.trim());
    fd.set("provider", form.provider.trim());
    fd.set("amount", form.amount);
    fd.set("currency", form.currency);
    fd.set("chargedTo", form.chargedTo);
    fd.set("paidBy", form.paidBy);
    fd.set("notes", form.notes.trim());
    if (file) fd.set("file", file);
    if (removeFile) fd.set("removeFile", "1");
    if (!isEdit && canPayNow && form.payNow) {
      fd.set("payNow", "1");
      fd.set("accountId", form.accountId);
      fd.set("paidAt", form.paidAt);
    }
    startSaving(async () => {
      const res = isEdit && expense ? await updateExpense(expense.id, fd) : await createExpense(fd);
      if (!res.ok) {
        setError({ field: res.field, message: res.error });
        toast.error("No se pudo guardar el gasto", { description: res.error });
        return;
      }
      const warning: string | null = "warning" in res && typeof res.warning === "string" ? res.warning : null;
      if (warning) toast.warning("Gasto guardado, con un detalle", { description: warning });
      else toast.success(isEdit ? "Gasto actualizado" : `Gasto de ${formatMoney(amount, form.currency)} cargado`, { description: chargedToHint(form.chargedTo, form.paidBy) });
      setOpen(false);
      router.refresh();
      onSaved?.(res.expense);
    });
  }

  const currentFileName = file?.name ?? (!removeFile && expense?.file_path ? "Archivo adjunto" : null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-700 dark:text-cyan-400">
              <Wrench size={16} />
            </span>
            {isEdit ? "Editar gasto" : "Nuevo gasto"}
          </DialogTitle>
          <DialogDescription>
            {options ? `${options.property.label} · ` : ""}Arreglos, impuestos, expensas extraordinarias… y a quién le toca pagarlos.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{loadError}</p>
        ) : !options ? (
          <div className="space-y-3 py-2" aria-busy={loading}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5 mt-1">
            <div className="space-y-2">
              <FieldLabel htmlFor="exp-desc">¿Qué se hizo?</FieldLabel>
              <Input
                id="exp-desc"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Ej.: Cambio de flexible del calefón"
                maxLength={200}
                className="h-10"
                autoFocus={!isEdit}
              />
              <FieldError message={error?.field === "description" ? error.message : null} />
              <CategoryChips value={form.category} onChange={(v) => set("category", v)} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-start">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="exp-amount">Importe{form.currency ? ` (${form.currency})` : ""}</FieldLabel>
                <Input
                  id="exp-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form.amount}
                  onChange={(e) => set("amount", e.target.value)}
                  disabled={paidFromCaja}
                  className="h-10 text-lg tabular-nums"
                />
                <FieldError message={error?.field === "amount" || error?.field === "currency" ? error.message : null} />
                {paidFromCaja && <p className="text-[11px] text-muted-foreground">Ya salió de Caja: para cambiar el importe, deshacé el pago.</p>}
              </div>
              {options.currencies.length > 1 && (
                <div className="space-y-1.5">
                  <FieldLabel>Moneda</FieldLabel>
                  <Select value={form.currency} onValueChange={changeCurrency} disabled={paidFromCaja}>
                    <SelectTrigger className="h-10 w-full sm:w-24" aria-label="Moneda">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.currencies.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <FieldLabel htmlFor="exp-date">Fecha</FieldLabel>
                <Input id="exp-date" type="date" value={form.occurredOn} max={options.today} onChange={(e) => set("occurredOn", e.target.value)} className="h-10" />
                <FieldError message={error?.field === "occurredOn" ? error.message : null} />
              </div>
            </div>

            <div className="space-y-2">
              <FieldLabel>¿A cargo de quién?</FieldLabel>
              <ChargedToPicker value={form.chargedTo} onChange={changeChargedTo} />
              {form.chargedTo === "propietario" && options.owners.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Se le descuenta a {options.owners.map((o) => (options.owners.length > 1 ? `${o.name} (${o.pct.toLocaleString("es-AR")} %)` : o.name)).join(" y ")}.
                </p>
              )}
              {form.chargedTo === "propietario" && options.owners.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">La propiedad no tiene propietarios cargados: el gasto no va a entrar en ninguna rendición hasta que los cargues.</p>
              )}
            </div>

            {(form.chargedTo === "inquilino" || options.contracts.length > 0) && (
              <div className="space-y-1.5">
                <FieldLabel hint={form.chargedTo === "inquilino" ? undefined : "Opcional"}>Contrato</FieldLabel>
                <Select value={form.contractId || "none"} onValueChange={(v) => set("contractId", v === "none" ? "" : v)}>
                  <SelectTrigger className="h-10 w-full" aria-label="Contrato">
                    <SelectValue placeholder="Elegí el contrato" />
                  </SelectTrigger>
                  <SelectContent>
                    {form.chargedTo !== "inquilino" && <SelectItem value="none">Sin contrato (gasto de la propiedad)</SelectItem>}
                    {(form.chargedTo === "inquilino" ? chargeableContracts : options.contracts).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                        {c.status !== "vigente" ? ` · ${c.status}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.chargedTo === "inquilino" && chargeableContracts.length === 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">No hay un contrato vigente en esta propiedad: no hay a quién cobrárselo.</p>
                )}
                <FieldError message={error?.field === "contractId" ? error.message : null} />
              </div>
            )}

            <div className="space-y-2">
              <FieldLabel>¿Quién lo pagó?</FieldLabel>
              <PaidByChips chargedTo={form.chargedTo} value={form.paidBy} onChange={(v) => set("paidBy", v)} disabled={paidFromCaja} />
              <p className="text-xs text-muted-foreground">{chargedToHint(form.chargedTo, form.paidBy)}</p>
              <FieldError message={error?.field === "paidBy" ? error.message : null} />
            </div>

            {!isEdit && canPayNow && (
              <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Wallet size={16} className="text-rose-600 dark:text-rose-400" /> Registrar el pago en Caja ahora
                  </span>
                  <Switch checked={form.payNow} onCheckedChange={(v) => set("payNow", v)} aria-label="Registrar el pago en Caja ahora" />
                </label>
                {form.payNow &&
                  (accountsForCurrency.length === 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">No hay cuentas activas en {form.currency}. Creá una en Caja o registrá el pago después.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                      <div className="space-y-1.5">
                        <FieldLabel>Sale de la cuenta</FieldLabel>
                        <Select value={form.accountId} onValueChange={(v) => set("accountId", v)}>
                          <SelectTrigger className="h-10 w-full" aria-label="Cuenta de Caja">
                            <SelectValue placeholder="Elegí la cuenta" />
                          </SelectTrigger>
                          <SelectContent>
                            {accountsForCurrency.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldError message={error?.field === "accountId" ? error.message : null} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="exp-paid-at">Fecha del pago</FieldLabel>
                        <Input id="exp-paid-at" type="date" value={form.paidAt} max={options.today} onChange={(e) => set("paidAt", e.target.value)} className="h-10" />
                      </div>
                    </div>
                  ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="exp-provider" hint="Opcional">Proveedor</FieldLabel>
                <Input id="exp-provider" value={form.provider} onChange={(e) => set("provider", e.target.value)} placeholder="Ej.: Plomería Juárez" maxLength={120} className="h-10" />
              </div>
              <div className="space-y-1.5">
                <FieldLabel hint="Opcional">Factura o foto</FieldLabel>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf,.heic,.heif,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    void pickFile(e.target.files);
                    e.target.value = "";
                  }}
                />
                {currentFileName ? (
                  <div className="flex h-10 items-center gap-2 rounded-md border bg-card px-3 text-sm">
                    <FileText size={14} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{currentFileName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (expense?.file_path) setRemoveFile(true);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Quitar archivo"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" className="h-10 w-full justify-start gap-2 font-normal text-muted-foreground" onClick={() => fileRef.current?.click()}>
                    <Paperclip size={14} /> Adjuntar (JPG, PNG, HEIC o PDF)
                  </Button>
                )}
                <FieldError message={error?.field === "file" ? error.message : null} />
              </div>
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="exp-notes" hint="Opcional">Nota interna</FieldLabel>
              <Textarea id="exp-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={1000} placeholder="Ej.: presupuesto aprobado por el propietario por WhatsApp" />
            </div>

            {error && !["description", "amount", "currency", "occurredOn", "contractId", "paidBy", "accountId", "file"].includes(error.field ?? "") && (
              <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error.message}</p>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving && <Loader2 size={14} className="animate-spin" />}
                {isEdit ? "Guardar cambios" : form.payNow && canPayNow ? "Cargar y pagar" : "Cargar gasto"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
