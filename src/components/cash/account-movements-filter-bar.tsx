"use client";

import { useTransition, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

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
  other: "Otros",
};

interface Props {
  category: string;
  direction: string;
  search: string;
  fromDate: string;
  toDate: string;
}

export function AccountMovementsFilterBar({ category, direction, search, fromDate, toDate }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

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

  const hasFilters = category !== "all" || direction !== "all" || search || fromDate || toDate;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por descripción…"
          defaultValue={search}
          onChange={(e) => {
            const v = e.target.value;
            // debounce mínimo: dejamos que onBlur o Enter dispare; aquí update inmediato
            update({ q: v });
          }}
          className="pl-8 h-9"
        />
      </div>

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
          onClick={() => update({ q: undefined, cat: undefined, dir: undefined, from: undefined, to: undefined })}
        >
          <X size={14} /> Limpiar
        </Button>
      )}
    </div>
  );
}
