"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Plus, Rocket, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { formatDate, formatMoney, parseAmountInput } from "@/lib/format";
import { formatContractNumber } from "@/lib/rentals/labels";
import { isValidConsent, joinNamesEs } from "@/lib/rentals/renewal";
import { activateRentalContract } from "@/lib/actions/rentals-contracts";
import type { EntryChargeItemDraft, EntryChargeKind } from "./entry-breakdown";
import { editableNumber } from "./wizard-state";

/**
 * Activar un borrador: confirma el cargo de ingreso (depósito, honorarios,
 * sellado…) con los ítems editables. El primer mes NO va acá: lo cubre el
 * cargo mensual del período 1, que se genera solo.
 */

const KIND_LABEL: Record<EntryChargeKind, string> = {
  deposito: "Depósito",
  honorarios: "Honorarios",
  sellado: "Sellado",
  otro: "Otro",
};

interface ItemRow {
  key: string;
  kind: EntryChargeKind;
  description: string;
  amount: string;
}

let seq = 0;
const rowOf = (i: EntryChargeItemDraft): ItemRow => ({ key: `i${++seq}`, kind: i.kind, description: i.description, amount: editableNumber(i.amount) });

export function ActivateContractDialog({
  contractId,
  open,
  onOpenChange,
  suggestion,
  currency,
  startDate,
  today,
  renewalOf = null,
  guarantors = [],
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion: EntryChargeItemDraft[];
  currency: string;
  startDate: string;
  /** Si el contrato ya venía corriendo, el cargo de ingreso vence hoy (no en el pasado). */
  today: string;
  /** Número del contrato que renueva (null si no es renovación). */
  renewalOf?: number | null;
  /** Garantes, con la fecha en que firmaron la renovación si ya se cargó. */
  guarantors?: { personId: string; name: string; consentAt: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [generate, setGenerate] = useState(suggestion.length > 0);
  const [items, setItems] = useState<ItemRow[]>(() => suggestion.map(rowOf));
  const [dueDate, setDueDate] = useState(startDate > today ? startDate : today);
  // Renovación (art. 1225 CCyC): la fecha en que firmó cada garante, o que no firmó y sale del contrato.
  const [consents, setConsents] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  // Una fecha futura guardada tampoco cuenta: se vuelve a pedir acá en vez de trabar la activación.
  const unsigned = renewalOf != null ? guarantors.filter((g) => !isValidConsent(g.consentAt, today)) : [];

  const parsed = items.map((i) => parseAmountInput(i.amount));
  const total = parsed.reduce<number>((s, n) => s + (n ?? 0), 0);

  function update(key: string, patch: Partial<ItemRow>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function submit() {
    let entryItems: EntryChargeItemDraft[] = [];
    if (generate) {
      const bad = items.findIndex((i, idx) => !i.description.trim() || parsed[idx] == null || (parsed[idx] as number) <= 0);
      if (bad >= 0) {
        toast.error("Revisá el cargo de ingreso", { description: `El renglón ${bad + 1} necesita concepto e importe mayor a cero.` });
        return;
      }
      entryItems = items.map((i, idx) => ({ kind: i.kind, description: i.description.trim(), amount: parsed[idx] as number }));
    }
    const removeGuarantors = unsigned.filter((g) => removed.has(g.personId)).map((g) => g.personId);
    const signing = unsigned.filter((g) => !removed.has(g.personId));
    const future = signing.filter((g) => (consents[g.personId] ?? "") > today);
    if (future.length) {
      toast.error("Revisá la fecha de firma", {
        description: `${future.length > 1 ? "Las de" : "La de"} ${joinNamesEs(future.map((g) => g.name))} ${future.length > 1 ? "son posteriores" : "es posterior"} a hoy.`,
      });
      return;
    }
    const missing = signing.filter((g) => !consents[g.personId]);
    if (missing.length) {
      toast.error(missing.length === 1 ? "Falta la firma de un garante" : "Faltan las firmas de los garantes", {
        description:
          missing.length > 1
            ? `Cargá la fecha en que firmaron la renovación ${joinNamesEs(missing.map((g) => g.name))}, o marcá quién no firmó.`
            : `Cargá la fecha en que ${missing[0].name} firmó la renovación, o marcá que no firmó.`,
      });
      return;
    }
    const guarantorConsents = signing.map((g) => ({ personId: g.personId, consentAt: consents[g.personId] }));
    startTransition(async () => {
      const res = await activateRentalContract(contractId, { entryItems, entryDueDate: dueDate || null, guarantorConsents, removeGuarantors });
      if (!res.ok) {
        toast.error("No se pudo activar el contrato", { description: res.error });
        return;
      }
      toast.success("Contrato activado", {
        description: entryItems.length
          ? `Se armó el cronograma y el cargo de ingreso por ${formatMoney(total, currency)}.`
          : "Se armó el cronograma de ajustes y los cargos que ya tocan.",
      });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${RENTALS_ACCENT}1f`, color: RENTALS_ACCENT }}>
              <Rocket size={16} />
            </span>
            Activar contrato
          </DialogTitle>
          <DialogDescription>
            Desde ahora rige: se arma el cronograma de ajustes, se generan los cargos de cada mes y el inquilino tiene su link para ver lo que debe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {renewalOf != null && guarantors.length > 0 && (
            <section
              className={`rounded-lg border p-3 space-y-2.5 ${unsigned.length ? "border-amber-500/40 bg-amber-500/[0.06]" : "bg-muted/30"}`}
              aria-label="Garantes de la renovación"
            >
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-muted-foreground" /> Garantes de la renovación
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                  La garantía del {formatContractNumber(renewalOf)} no sigue sola (art. 1225 CCyC): cada garante tiene que firmar la renovación. Si alguno no firmó, sacalo de este
                  contrato.
                </p>
              </div>
              {guarantors.map((g) =>
                g.consentAt && isValidConsent(g.consentAt, today) ? (
                  <p key={g.personId} className="text-xs flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
                    <span className="truncate">
                      {g.name} · firmó el {formatDate(g.consentAt)}
                    </span>
                  </p>
                ) : (
                  <div key={g.personId} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${removed.has(g.personId) ? "line-through text-muted-foreground" : ""}`}>{g.name}</p>
                      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={removed.has(g.personId)}
                          onCheckedChange={(v) =>
                            setRemoved((s) => {
                              const next = new Set(s);
                              if (v === true) next.add(g.personId);
                              else next.delete(g.personId);
                              return next;
                            })
                          }
                        />
                        No firmó: sacarlo de este contrato
                      </label>
                    </div>
                    <Input
                      type="date"
                      max={today}
                      value={consents[g.personId] ?? ""}
                      onChange={(e) => setConsents((c) => ({ ...c, [g.personId]: e.target.value }))}
                      disabled={removed.has(g.personId)}
                      aria-label={`Fecha en que ${g.name} firmó la renovación`}
                      className="h-9"
                    />
                  </div>
                ),
              )}
            </section>
          )}

          <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer hover:bg-accent/30 transition-colors">
            <Checkbox checked={generate} onCheckedChange={(v) => setGenerate(v === true)} className="mt-0.5" />
            <span>
              <span className="text-sm font-medium block">Generar el cargo de ingreso</span>
              <span className="text-xs text-muted-foreground">
                Lo que paga el inquilino para entrar. El primer mes no va acá: sale con su cargo mensual.
              </span>
            </span>
          </label>

          {generate && (
            <div className="space-y-3">
              <div className="space-y-2">
                {items.map((i, idx) => (
                  <div key={i.key} className="grid gap-2 rounded-lg border p-2 sm:border-0 sm:p-0 sm:grid-cols-[8rem_minmax(0,1fr)_8.5rem_2.25rem] sm:items-center">
                    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 sm:contents">
                      <Select value={i.kind} onValueChange={(v) => update(i.key, { kind: v as EntryChargeKind })}>
                        <SelectTrigger className="h-9 w-full" aria-label="Tipo">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(KIND_LABEL) as EntryChargeKind[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {KIND_LABEL[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input value={i.description} onChange={(e) => update(i.key, { description: e.target.value })} placeholder="Concepto" className="h-9" aria-label="Concepto" />
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2 sm:contents">
                      <Input
                        value={i.amount}
                        onChange={(e) => update(i.key, { amount: e.target.value })}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={`h-9 tabular-nums text-right ${parsed[idx] == null && i.amount ? "border-rose-500" : ""}`}
                        aria-label="Importe"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground hover:text-rose-600"
                        onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}
                        aria-label="Quitar renglón"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setItems((list) => [...list, { key: `i${++seq}`, kind: "otro", description: "", amount: "" }])}
                >
                  <Plus size={14} /> Agregar concepto
                </Button>
                <p className="text-sm">
                  Total <span className="font-semibold tabular-nums">{formatMoney(total, currency)}</span>
                </p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-3">
                <Label htmlFor="entry-due" className="text-xs text-muted-foreground">
                  Vence el
                </Label>
                <Input id="entry-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
              </div>
              {renewalOf != null && items.some((i) => i.kind === "deposito") && (
                // La sugerencia trae el depósito completo, como en un alta: en una renovación suele seguir el del contrato anterior.
                <p className="text-xs text-amber-800 dark:text-amber-200 leading-snug">
                  Es una renovación: si el depósito del {formatContractNumber(renewalOf)} sigue en garantía, cobrá sólo la diferencia o sacá ese renglón. Si no, se cobra dos veces.
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" />
            Después subí el contrato firmado en la pestaña Documentos: queda a mano para cualquier reclamo.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            Activar contrato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
