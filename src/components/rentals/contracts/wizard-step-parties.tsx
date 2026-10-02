"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck, Trash2, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonFormDialog } from "@/components/rentals/people/person-form-dialog";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { cn } from "@/lib/utils";
import { formatMoney, getInitials } from "@/lib/format";
import { GUARANTEE_TYPE_LABEL } from "@/lib/rentals/labels";
import type { RentalGuaranteeType, RentalPerson } from "@/lib/types/database";
import type { PersonOption } from "./types";
import { StepIntro } from "./wizard-fields";
import { newPartyKey, type WizardParty } from "./wizard-state";
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
}: {
  people: PersonOption[];
  exclude: Set<string>;
  intent: "inquilino" | "garante";
  onPick: (id: string) => void;
  onCreated: (p: PersonOption) => void;
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
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="h-10 flex-1 justify-start gap-2 font-normal text-muted-foreground">
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
        <Button type="button" variant="outline" className="h-10 gap-2">
          <UserPlus size={15} /> {intent === "garante" ? "Garante nuevo" : "Inquilino nuevo"}
        </Button>
      </PersonFormDialog>
    </div>
  );
}

export function StepParties({ state, set, errors, people, addPerson }: StepProps) {
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

      <section className="space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <UserRound size={13} /> Inquilinos
        </h3>
        {tenants.map((p) => {
          const person = byId.get(p.person_id);
          return (
            <div key={p.key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={p.is_primary ? { borderColor: `${RENTALS_ACCENT}66` } : undefined}>
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
              <Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-rose-600" onClick={() => remove(p.key)} aria-label="Sacar">
                <Trash2 size={14} />
              </Button>
            </div>
          );
        })}
        <PersonPicker people={people} exclude={usedBy("inquilino")} intent="inquilino" onPick={(id) => add("inquilino", id)} onCreated={addPerson} />
        {errors.parties && (
          <p className="text-[12px] text-rose-600 dark:text-rose-400" role="alert">
            {errors.parties}
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
        {guarantors.map((p) => {
          const person = byId.get(p.person_id);
          const type = p.guarantee_type ?? "otra";
          return (
            <div key={p.key} className="rounded-xl border px-3 py-3 space-y-2.5">
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
                <Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-rose-600" onClick={() => remove(p.key)} aria-label="Sacar garante">
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
            </div>
          );
        })}
        <PersonPicker people={people} exclude={usedBy("garante")} intent="garante" onPick={(id) => add("garante", id)} onCreated={addPerson} />
      </section>
    </div>
  );
}
