"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickCreateOwner } from "@/lib/actions/rentals-properties";
import { Field } from "@/components/rentals/people/form-bits";
import type { OwnerOption } from "./property-types";

/**
 * Alta rápida de propietario adentro del formulario de la propiedad. Es un
 * panel (no otro diálogo) para no perder lo tipeado. Crea el propietario en la
 * tabla de siempre: también aparece en Propietarios.
 */
export function QuickOwnerPanel({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (owner: OwnerOption) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ full_name: initialName, phone: "", email: "", cbu: "", alias_cbu: "" });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (error?.field === k) setError(null);
  };
  const err = (f: string) => (error?.field === f ? error.message : null);

  function create() {
    if (pending) return;
    if (form.full_name.trim().length < 2) {
      setError({ field: "full_name", message: "Escribí el nombre del propietario." });
      return;
    }
    startTransition(async () => {
      const res = await quickCreateOwner({
        full_name: form.full_name,
        phone: form.phone || null,
        email: form.email || null,
        cbu: form.cbu || null,
        alias_cbu: form.alias_cbu || null,
      });
      if (!res.ok) {
        setError({ field: res.field, message: res.error });
        return;
      }
      toast.success("Propietario creado", { description: `${res.owner.full_name} también aparece en Propietarios.` });
      onCreated(res.owner);
    });
  }

  return (
    // No es un <form>: vive adentro del formulario de la propiedad (no se anidan forms).
    <div
      className="rounded-xl border border-teal-600/30 bg-teal-600/[0.04] p-3 sm:p-4 space-y-3 animate-fade-up"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          create();
        }
      }}
    >
      <div className="flex items-start gap-2.5">
        <span className="size-8 shrink-0 rounded-lg bg-teal-600/15 text-teal-700 dark:text-teal-300 flex items-center justify-center">
          <UserPlus size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Nuevo propietario</p>
          <p className="text-xs text-muted-foreground leading-snug">
            Queda guardado en Propietarios. El CBU o alias sirve para transferirle las rendiciones.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field id="quick-owner-full_name" label="Nombre y apellido" required error={err("full_name")} className="sm:col-span-2">
          <Input id="quick-owner-full_name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} autoFocus className="h-10" />
        </Field>
        <Field id="quick-owner-phone" label="Teléfono" error={err("phone")}>
          <Input id="quick-owner-phone" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="351 123 4567" className="h-10" />
        </Field>
        <Field id="quick-owner-email" label="Mail" error={err("email")}>
          <Input id="quick-owner-email" type="email" inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="h-10" />
        </Field>
        <Field id="quick-owner-cbu" label="CBU / CVU" error={err("cbu")}>
          <Input id="quick-owner-cbu" inputMode="numeric" value={form.cbu} onChange={(e) => set("cbu", e.target.value)} placeholder="22 números" className="h-10 font-mono" />
        </Field>
        <Field id="quick-owner-alias_cbu" label="Alias" error={err("alias_cbu")}>
          <Input id="quick-owner-alias_cbu" value={form.alias_cbu} onChange={(e) => set("alias_cbu", e.target.value)} placeholder="casa.sol.rio" className="h-10 font-mono" />
        </Field>
      </div>
      {error && !error.field && <p className="text-xs text-rose-600 dark:text-rose-400">{error.message}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="button" onClick={create} disabled={pending} className="gap-2">
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Crear y agregar
        </Button>
      </div>
    </div>
  );
}
