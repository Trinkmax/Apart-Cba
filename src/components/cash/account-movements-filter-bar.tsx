"use client";

import { useTransition, useCallback, useRef, useState, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CashSearchInput } from "./cash-search-input";

const CATEGORY_LABELS: Record<string, string> = {
  all: "Todas",
  booking_payment: "Reservas",
  maintenance: "Mantenimiento",
  cleaning: "Limpieza",
  owner_settlement: "Liquidaciones",
  transfer: "Transferencias",
  adjustment: "Ajustes",
  salary: "Sueldos",
  utilities: "Servicios",
  tax: "Impuestos",
  supplies: "Insumos",
  commission: "Comisiones",
  refund: "Devoluciones",
  extra_charge: "Cobros extra",
  rent_collection: "Cobros de alquiler",
  rent_owner_payout: "Rendiciones de alquiler",
  security_deposit: "Depósitos en garantía",
  agency_fee: "Honorarios inmobiliarios",
  other: "Otros",
};

interface Props {
  category: string;
  direction: string;
  search: string;
  fromDate: string;
  toDate: string;
  billable: string;
}

export function AccountMovementsFilterBar({ category, direction, search, fromDate, toDate, billable }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // El texto vive acá y viaja a la URL con un respiro: antes cada tecla era un
  // render completo de la página en el server.
  const [text, setText] = useState(search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "" || v === "all") next.delete(k);
        else next.set(k, v);
      }
      // Reset paginación al cambiar filtros
      next.delete("page");
      const qs = next.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [params, pathname, router]
  );

  const hasFilters = category !== "all" || direction !== "all" || billable !== "all" || search || fromDate || toDate;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CashSearchInput
        value={text}
        onChange={(v) => {
          setText(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => update({ q: v.trim() || undefined }), v ? 300 : 0);
        }}
        loading={isPending}
        placeholder="Buscar depto, persona, concepto o importe…"
        size="compact"
        className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-xs"
      />

      <Select value={direction} onValueChange={(v) => update({ dir: v })}>
        <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos</SelectItem>
          <SelectItem value="in">Ingresos</SelectItem>
          <SelectItem value="out">Egresos</SelectItem>
        </SelectContent>
      </Select>

      <Select value={category} onValueChange={(v) => update({ cat: v })}>
        <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
            <SelectItem key={k} value={k}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={billable} onValueChange={(v) => update({ bill: v })}>
        <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toda imputación</SelectItem>
          <SelectItem value="apartcba">Organización</SelectItem>
          <SelectItem value="owner">Propietario</SelectItem>
          <SelectItem value="guest">Huésped</SelectItem>
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={fromDate}
        onChange={(e) => update({ from: e.target.value })}
        className="h-9 w-[140px]"
        aria-label="Desde"
      />
      <Input
        type="date"
        value={toDate}
        onChange={(e) => update({ to: e.target.value })}
        className="h-9 w-[140px]"
        aria-label="Hasta"
      />

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-9"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            setText("");
            update({ q: undefined, cat: undefined, dir: undefined, from: undefined, to: undefined, bill: undefined });
          }}
        >
          <X size={14} /> Limpiar
        </Button>
      )}
    </div>
  );
}
