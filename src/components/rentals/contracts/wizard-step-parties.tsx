"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck, Trash2, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonFormDialog } from "@/components/rentals/people/person-form-dialog";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { cn } from "@/lib/utils";
import { formatMoney, getInitials } from "@/lib/format";
import { GUARANTEE_TYPE_LABEL } from "@/lib/rentals/labels";
import { isValidConsent } from "@/lib/rentals/renewal";
import type { RentalGuaranteeType, RentalPerson } from "@/lib/types/database";
import type { PersonOption } from "./types";
import { StepIntro } from "./wizard-fields";
import { newPartyKey, partyField, type WizardParty } from "./wizard-state";
import type { StepProps } from "./wizard-step-props";

/** Paso 2: inquilino(s) —uno es el titular de los recibos— y garantes con su garantía. */

const DETAIL_PLACEHOLDER: Record<RentalGuaranteeType, string> = {
  propietaria: "Inmueble: dirección y matrícula o cuenta de Rentas",
  recibo_sueldo: "Empleador y sueldo neto",
  seguro_caucion: "Aseguradora y N° de póliza",
  fianza: "Quién responde y cómo",
  aval_bancario: "Banco y N° de aval",
  pagare: "Monto y vencimiento del pagaré",
  otra: "Detalle de la garantía",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function personOptionOf(p: RentalPerson): PersonOption {
  return {
    id: p.id,
    fullName: p.full_name,
    personType: p.person_type,
    docLabel: p.doc_number ? `${p.doc_type && p.doc_type !== "OTRO" ? `${p.doc_type} ` : ""}${p.doc_number}` : p.tax_id ? `CUIT ${p.tax_id}` : null,
    phone: p.phone,
    email: p.email,
    employer: p.employer,
    monthlyIncome: p.monthly_income != null ? Number(p.monthly_income) : null,
  };
}

function PersonPicker({
  people,
  exclude,
  intent,
  onPick,
  onCreated,
  anchor,
  invalid,
}: {
  people: PersonOption[];
  exclude: Set<string>;
  intent: "inquilino" | "garante";
  onPick: (id: string) => void;
  onCreated: (p: PersonOption) => void;
  /** Campo del asistente al que se salta si falta (el buscador, o "nuevo" si todavía no hay nadie cargado). */
  anchor?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const matches = useMemo(() => {
    const needle = norm(search.trim());
    return people
      .filter((p) => !exclude.has(p.id))
      .filter((p) => !needle || norm([p.fullName, p.docLabel ?? "", p.phone ?? "", p.email ?? ""].join(" ")).includes(needle))
      .slice(0, 50);
  }, [people, exclude, search]);

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            data-wizard-field={people.length > 0 ? anchor : undefined}
            className={cn("h-10 flex-1 justify-start gap-2 font-normal text-muted-foreground", invalid && "border-rose-500/60")}
          >
            <Search size={15} /> {intent === "garante" ? "Buscar garante por nombre o DNI" : "Buscar inquilino por nombre o DNI"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} className="w-(--radix-popover-trigger-width) min-w-[300px] p-0">
          <Command shouldFilter={false}>
            <CommandInput value={search} onValueChange={setSearch} placeholder="Nombre, DNI, teléfono o mail" />
            <CommandList className="max-h-72">
              <CommandEmpty>Nadie coincide. Cargalo con el botón de al lado.</CommandEmpty>
              <CommandGroup>
                {matches.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onPick(p.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <UserRound size={14} className="text-muted-foreground" />
                    <span className="truncate">{p.fullName}</span>
                    {p.docLabel && <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{p.docLabel}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <PersonFormDialog
        intent={intent}
        defaultName={search.trim() || undefined}
        onSaved={(p) => {
          onCreated(personOptionOf(p));
          onPick(p.id);
          setSearch("");
        }}
      >
        <Button
          type="button"
          variant={people.length === 0 && intent === "inquilino" ? "default" : "outline"}
          className="h-10 gap-2"
          data-wizard-field={people.length === 0 ? anchor : undefined}
        >
          <UserPlus size={15} /> {intent === "garante" ? "Garante nuevo" : "Inquilino nuevo"}
        </Button>
      </PersonFormDialog>
    </div>
  );
}

export function StepParties({ state, set, errors, people, addPerson, today }: StepProps) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const tenants = state.parties.filter((p) => p.role === "inquilino");
  const guarantors = state.parties.filter((p) => p.role === "garante");
  const usedBy = (role: "inquilino" | "garante") => new Set(state.parties.filter((p) => p.role === role).map((p) => p.person_id));

  function add(role: "inquilino" | "garante", personId: string) {
    set((s) => {
      if (s.parties.some((p) => p.role === role && p.person_id === personId)) return {};
      const hasPrimary = s.parties.some((p) => p.role === "inquilino" && p.is_primary);
      const row: WizardParty = {
        key: newPartyKey(),
        person_id: personId,
        role,
        is_primary: role === "inquilino" && !hasPrimary,
        guarantee_type: role === "garante" ? "propietaria" : null,
        guarantee_detail: "",
        guarantor_consent_at: "",
      };
      return { parties: [...s.parties, row] };
    });
  }
  function update(key: string, patch: Partial<WizardParty>) {
    set((s) => ({ parties: s.parties.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  }
  function remove(key: string) {
    set((s) => {
      const next = s.parties.filter((p) => p.key !== key);
      if (!next.some((p) => p.role === "inquilino" && p.is_primary)) {
        const first = next.find((p) => p.role === "inquilino");
        if (first) return { parties: next.map((p) => (p.key === first.key ? { ...p, is_primary: true } : p)) };
      }
      return { parties: next };
    });
  }
  function makePrimary(key: string) {
    set((s) => ({ parties: s.parties.map((p) => (p.role === "inquilino" ? { ...p, is_primary: p.key === key } : p)) }));
  }

  return (
    <div className="space-y-6">
      <StepIntro title="¿Quién alquila?">El titular es a nombre de quien salen los recibos. Si son varios (pareja, amigos), agregalos a todos.</StepIntro>

      {/* Aviso del servidor sobre las partes en general (p. ej. firmas de una renovación vigente). */}
      {errors.parties && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300" role="alert">
          {errors.parties}
        </p>
      )}

      <section className="space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <UserRound size={13} /> Inquilinos
        </h3>
        {tenants.map((p) => {
          const person = byId.get(p.person_id);
          const rowError = errors[partyField.row(p.key)] ?? errors[partyField.primary(p.key)];
          return (
            <div key={p.key} className="space-y-1">
              <div
                className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5", rowError && "border-rose-500/60")}
                style={p.is_primary && !rowError ? { borderColor: `${RENTALS_ACCENT}66` } : undefined}
              >
                <span className="size-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0" style={{ backgroundColor: `${RENTALS_ACCENT}18`, color: RENTALS_ACCENT }}>
                  {getInitials(person?.fullName ?? "?")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{person?.fullName ?? "Persona"}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{[person?.docLabel, person?.phone].filter(Boolean).join(" · ") || "Sin documento cargado"}</p>
                </div>
                {tenants.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => makePrimary(p.key)}
                    aria-pressed={p.is_primary}
                    data-wizard-field={partyField.primary(p.key)}
                    className={cn("h-8 rounded-full border px-2.5 text-[11px] font-medium shrink-0 transition-colors", p.is_primary ? "text-white" : "text-muted-foreground hover:text-foreground")}
                    style={p.is_primary ? { backgroundColor: RENTALS_ACCENT, borderColor: RENTALS_ACCENT } : undefined}
                  >
                    {p.is_primary ? "Titular" : "Hacer titular"}
                  </button>
                ) : (
                  <span className="text-[11px] font-medium shrink-0" style={{ color: RENTALS_ACCENT }}>
                    Titular
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-rose-600"
                  onClick={() => remove(p.key)}
                  aria-label="Sacar"
                  data-wizard-field={partyField.row(p.key)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              {rowError && (
                <p className="px-1 text-[12px] text-rose-600 dark:text-rose-400" role="alert">
                  {rowError}
                </p>
              )}
            </div>
          );
        })}
        <PersonPicker
          people={people}
          exclude={usedBy("inquilino")}
          intent="inquilino"
          onPick={(id) => add("inquilino", id)}
          onCreated={addPerson}
          anchor="tenant"
          invalid={Boolean(errors.tenant)}
        />
        {errors.tenant && (
          <p className="text-[12px] text-rose-600 dark:text-rose-400" role="alert">
            {errors.tenant}
          </p>
        )}
      </section>

      <section className="space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck size={13} /> Garantías
        </h3>
        {guarantors.length === 0 && (
          <p className="text-xs text-muted-foreground">Opcional. Si la garantía es un seguro de caución sin garante, igual podés cargar a la aseguradora como persona jurídica.</p>
        )}
        {state.is_renewal && guarantors.length > 0 && (
          <p className="text-xs text-muted-foreground leading-snug">
            Es una renovación: la garantía del contrato anterior no sigue sola (art. 1225 CCyC). Cargá la fecha en que cada garante firmó la renovación; si alguno no firma, sacalo. Sin
            esas fechas el borrador se guarda, pero no se activa.
          </p>
        )}
        {guarantors.map((p) => {
          const person = byId.get(p.person_id);
          const type = p.guarantee_type ?? "otra";
          const consentMissing = state.is_renewal && !isValidConsent(p.guarantor_consent_at, today);
          const consentError = errors[partyField.consent(p.key)];
          const rowError = errors[partyField.row(p.key)] ?? consentError;
          return (
            <div key={p.key} className={cn("rounded-xl border px-3 py-3 space-y-2.5", rowError ? "border-rose-500/60" : consentMissing && "border-amber-500/50")}>
              <div className="flex items-center gap-3">
                <span className="size-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <ShieldCheck size={15} className="text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{person?.fullName ?? "Persona"}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {[person?.docLabel, person?.employer, person?.monthlyIncome ? `ingresos ${formatMoney(person.monthlyIncome, "ARS")}` : null].filter(Boolean).join(" · ") || "Sin datos laborales"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-rose-600"
                  onClick={() => remove(p.key)}
                  aria-label="Sacar garante"
                  data-wizard-field={partyField.row(p.key)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[13rem_minmax(0,1fr)]">
                <Select value={type} onValueChange={(v) => update(p.key, { guarantee_type: v as RentalGuaranteeType })}>
                  <SelectTrigger className="h-10 w-full" aria-label="Tipo de garantía">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(GUARANTEE_TYPE_LABEL) as RentalGuaranteeType[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {GUARANTEE_TYPE_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={p.guarantee_detail} onChange={(e) => update(p.key, { guarantee_detail: e.target.value })} placeholder={DETAIL_PLACEHOLDER[type]} className="h-10" aria-label="Detalle de la garantía" />
              </div>
              {state.is_renewal && (
                <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center">
                  <Label htmlFor={`consent-${p.key}`} className={cn("text-xs", consentMissing ? "text-amber-800 dark:text-amber-200" : "text-muted-foreground")}>
                    {!consentMissing ? "Firmó la renovación el" : p.guarantor_consent_at ? "La fecha de firma no puede ser posterior a hoy" : "Falta la fecha en que firmó la renovación"}
                  </Label>
                  <Input
                    id={`consent-${p.key}`}
                    type="date"
                    max={today}
                    value={p.guarantor_consent_at}
                    onChange={(e) => update(p.key, { guarantor_consent_at: e.target.value })}
                    aria-invalid={Boolean(consentError) || undefined}
                    data-wizard-field={partyField.consent(p.key)}
                    className={cn("h-9", consentError ? "border-rose-500/60" : consentMissing && "border-amber-500/60")}
                  />
                </div>
              )}
              {rowError && (
                <p className="text-[12px] text-rose-600 dark:text-rose-400" role="alert">
                  {rowError}
                </p>
              )}
            </div>
          );
        })}
        <PersonPicker people={people} exclude={usedBy("garante")} intent="garante" onPick={(id) => add("garante", id)} onCreated={addPerson} />
      </section>
    </div>
  );
}
