"use client";

import { Building2, FileText, Flame, Droplets, Landmark, Plus, Receipt, ShieldCheck, Trash2, Wifi, Zap, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SERVICE_KIND_META } from "@/lib/rentals/labels";
import type { RentalContractService, RentalExpensasMode, RentalExpensasPayer, RentalPayer, RentalServiceKind } from "@/lib/types/database";
import { ChipGroup, Field, StepIntro, ToggleRow } from "./wizard-fields";
import type { StepProps } from "./wizard-step-props";

/** Paso 7: expensas, servicios (quién paga y si se pide comprobante) y seguro. */

const ICONS: Record<string, LucideIcon> = { Building2, Zap, Flame, Droplets, Landmark, FileText, Wifi, ShieldCheck, Receipt };
const ADDABLE: RentalServiceKind[] = ["luz", "gas", "agua", "municipal", "inmobiliario", "internet", "otro"];

export function StepServices({ state, set, errors }: StepProps) {
  const services = state.services;
  const missing = ADDABLE.filter((k) => !services.some((s) => s.kind === k) || k === "otro");

  function update(i: number, patch: Partial<RentalContractService>) {
    set((s) => ({ services: s.services.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
  }

  return (
    <div className="space-y-6">
      <StepIntro title="Expensas y servicios">Lo que paga el inquilino y querés controlar: cada mes se pide el comprobante y lo validás en un toque.</StepIntro>

      <Field label="Expensas ordinarias">
        <ChipGroup<RentalExpensasPayer>
          ariaLabel="Quién paga las expensas"
          value={state.expensas_payer}
          onChange={(v) => set({ expensas_payer: v })}
          options={[
            { value: "inquilino", label: "Las paga el inquilino" },
            { value: "propietario", label: "Las paga el propietario" },
            { value: "no_aplica", label: "No tiene expensas" },
          ]}
        />
      </Field>
      {state.expensas_payer === "inquilino" && (
        <Field label="¿Cómo se pagan?">
          <ChipGroup<RentalExpensasMode>
            ariaLabel="Cómo se pagan las expensas"
            value={state.expensas_mode === "no_aplica" ? "paga_inquilino" : state.expensas_mode}
            onChange={(v) => set({ expensas_mode: v })}
            options={[
              { value: "paga_inquilino", label: "Las paga él y sube el comprobante", hint: "Cada mes se le pide el comprobante y lo validás en Comprobantes." },
              { value: "cobra_inmobiliaria", label: "Se cobran con el alquiler", hint: "Cargás el monto de cada mes y se suma al cargo; se le paga al consorcio." },
            ]}
          />
        </Field>
      )}
      {state.expensas_payer !== "no_aplica" && (
        <Field label="Expensas extraordinarias" hint="Lo habitual: las paga el propietario (son mejoras del edificio).">
          <ChipGroup<RentalPayer>
            ariaLabel="Quién paga las extraordinarias"
            value={state.expensas_extra_payer}
            onChange={(v) => set({ expensas_extra_payer: v })}
            options={[
              { value: "propietario", label: "El propietario" },
              { value: "inquilino", label: "El inquilino" },
            ]}
          />
        </Field>
      )}

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Servicios e impuestos</h3>
        {errors.services && <p className="text-[12px] text-rose-600">{errors.services}</p>}
        <div className="rounded-xl border divide-y">
          {services.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">Sin servicios. Agregá los que quieras controlar.</p>}
          {services.map((s, i) => {
            const meta = SERVICE_KIND_META[s.kind];
            const Icon = ICONS[meta?.iconName ?? "Receipt"] ?? Receipt;
            return (
              <div key={`${s.kind}-${i}`} className="px-3 py-2.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_auto_2.25rem] sm:items-center">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Icon size={15} className="text-muted-foreground" />
                  </span>
                  <span className="text-sm font-medium truncate">{meta?.label ?? s.kind}</span>
                </div>
                <Select value={s.payer} onValueChange={(v) => update(i, { payer: v as RentalPayer, proof_required: v === "inquilino" ? s.proof_required : false })}>
                  <SelectTrigger className="h-9 w-full" aria-label="Quién paga">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inquilino">Paga el inquilino</SelectItem>
                    <SelectItem value="propietario">Paga el propietario</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer whitespace-nowrap">
                    <Switch checked={s.proof_required} disabled={s.payer !== "inquilino"} onCheckedChange={(v) => update(i, { proof_required: v })} aria-label="Pedir comprobante" />
                    Pedir comprobante
                  </label>
                  {s.proof_required && (
                    <Select value={s.frequency} onValueChange={(v) => update(i, { frequency: v as "mensual" | "bimestral" })}>
                      <SelectTrigger className="h-8 w-[7.5rem] text-xs" aria-label="Cada cuánto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mensual">Cada mes</SelectItem>
                        <SelectItem value="bimestral">Cada 2 meses</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-9 justify-self-end text-muted-foreground hover:text-rose-600" onClick={() => set((st) => ({ services: st.services.filter((_, k) => k !== i) }))} aria-label={`Sacar ${meta?.label ?? s.kind}`}>
                  <Trash2 size={14} />
                </Button>
              </div>
            );
          })}
        </div>
        {missing.length > 0 && (
          <Select value="" onValueChange={(v) => set((st) => ({ services: [...st.services, { kind: v as RentalServiceKind, payer: "inquilino", proof_required: true, frequency: "mensual" }] }))}>
            <SelectTrigger className="h-9 w-56" aria-label="Agregar servicio">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Plus size={14} /> Agregar servicio
              </span>
            </SelectTrigger>
            <SelectContent>
              {missing.map((k) => (
                <SelectItem key={k} value={k}>
                  {SERVICE_KIND_META[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </section>

      <div className="space-y-3">
        <ToggleRow id="w-insurance" checked={state.insurance_required} onChange={(v) => set({ insurance_required: v })} title="El contrato pide seguro" description="Incendio / responsabilidad civil. Te avisamos antes de que venza." />
        {state.insurance_required && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Aseguradora">
              <Input value={state.insurance_company} onChange={(e) => set({ insurance_company: e.target.value })} className="h-10" placeholder="Ej.: Sancor" />
            </Field>
            <Field label="Póliza">
              <Input value={state.insurance_policy} onChange={(e) => set({ insurance_policy: e.target.value })} className="h-10" placeholder="N°" />
            </Field>
            <Field label="Vence el" error={errors.insurance_expires_at}>
              <Input type="date" value={state.insurance_expires_at} onChange={(e) => set({ insurance_expires_at: e.target.value })} className="h-10" />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
