"use client";

import { AlertTriangle, Check, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/rentals/people/form-bits";
import type { NewOwnerDraft } from "./owner-rows";
import type { OwnerOption } from "./property-types";

export interface QuickOwnerError {
  rowKey: string;
  field?: string;
  message: string;
}

/** id del input de un campo del propietario nuevo de una fila (para enfocarlo ante un error). */
export const quickOwnerFieldId = (rowKey: string, field: string) => `quick-owner-${rowKey}-${field}`;

/**
 * Propietario nuevo adentro del formulario de la propiedad. Es parte del
 * formulario, no un paso aparte: no tiene botón propio de crear. Lo crea
 * "Guardar propiedad", junto con la propiedad. Antes tenía su "Cancelar /
 * Crear y agregar" apilado arriba del "Cancelar / Guardar propiedad": dos
 * botones principales, y se tomaba "Crear y agregar" por el guardado de todo.
 */
export function QuickOwnerPanel({
  rowKey,
  draft,
  onChange,
  onDiscard,
  error,
  sameName,
  sameNameInOtherRow,
  onUseExisting,
  autoFocus,
}: {
  rowKey: string;
  draft: NewOwnerDraft;
  onChange: (draft: NewOwnerDraft) => void;
  onDiscard: () => void;
  error: QuickOwnerError | null;
  /** Propietario ya cargado con el mismo nombre. */
  sameName: OwnerOption | null;
  /** …y ya está elegido en otra fila de esta propiedad. */
  sameNameInOtherRow: boolean;
  onUseExisting: (owner: OwnerOption) => void;
  autoFocus?: boolean;
}) {
  const set = (k: keyof NewOwnerDraft, v: string) => onChange({ ...draft, [k]: v });
  const err = (f: string) => (error?.field === f ? error.message : null);
  const id = (f: string) => quickOwnerFieldId(rowKey, f);

  return (
    <div className="rounded-xl border border-teal-600/30 bg-teal-600/[0.04] p-3 sm:p-4 space-y-3 animate-fade-up">
      <div className="flex items-start gap-2.5">
        <span className="size-8 shrink-0 rounded-lg bg-teal-600/15 text-teal-700 dark:text-teal-300 flex items-center justify-center">
          <UserPlus size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Propietario nuevo</p>
          <p className="text-xs text-muted-foreground leading-snug">
            Se crea al guardar la propiedad y queda también en Propietarios. El CBU o alias sirve para transferirle lo que se cobre.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 -mr-1 -mt-1 shrink-0 text-muted-foreground"
          onClick={onDiscard}
          aria-label="No crear este propietario"
          title="No crear este propietario"
        >
          <X size={16} />
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field id={id("full_name")} label="Nombre y apellido" required error={err("full_name")} className="sm:col-span-2">
          <Input
            id={id("full_name")}
            value={draft.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            autoFocus={autoFocus}
            autoComplete="off"
            aria-invalid={Boolean(err("full_name")) || undefined}
            className="h-10"
          />
        </Field>
        {sameName && (
          <div className="sm:col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2" role="status">
            <AlertTriangle size={15} className="shrink-0 text-amber-700 dark:text-amber-300" />
            <p className="min-w-0 flex-1 text-xs text-amber-900 dark:text-amber-200">
              {sameNameInOtherRow ? (
                <>
                  <strong className="font-semibold">{sameName.full_name}</strong> ya está en otra fila de esta propiedad.
                </>
              ) : (
                <>
                  <strong className="font-semibold">{sameName.full_name}</strong> ya está en Propietarios. Usalo así no queda repetido.
                </>
              )}
            </p>
            {!sameNameInOtherRow && (
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => onUseExisting(sameName)}>
                <Check size={13} /> Usar ese propietario
              </Button>
            )}
          </div>
        )}
        <Field id={id("phone")} label="Teléfono" error={err("phone")}>
          <Input id={id("phone")} inputMode="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} placeholder="351 123 4567" className="h-10" />
        </Field>
        <Field id={id("email")} label="Mail" error={err("email")}>
          <Input id={id("email")} type="email" inputMode="email" value={draft.email} onChange={(e) => set("email", e.target.value)} className="h-10" />
        </Field>
        <Field id={id("cbu")} label="CBU / CVU" error={err("cbu")}>
          <Input id={id("cbu")} inputMode="numeric" value={draft.cbu} onChange={(e) => set("cbu", e.target.value)} placeholder="22 números" className="h-10 font-mono" />
        </Field>
        <Field id={id("alias_cbu")} label="Alias" error={err("alias_cbu")}>
          <Input id={id("alias_cbu")} value={draft.alias_cbu} onChange={(e) => set("alias_cbu", e.target.value)} placeholder="casa.sol.rio" className="h-10 font-mono" />
        </Field>
      </div>
      {error && !error.field && (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
