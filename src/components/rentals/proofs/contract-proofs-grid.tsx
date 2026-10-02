"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ClipboardList, Hourglass, Minus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/rentals/ui";
import { monthLabelOf } from "@/lib/rentals/labels";
import { monthOf } from "@/lib/rentals/ymd";
import { cn } from "@/lib/utils";
import { KindChip, kindLabel } from "./proof-kind-icon";
import { monthShort } from "./proof-helpers";
import type { ContractProofGridData, ProofCellState, ProofGridCell } from "./proof-types";
import { StaffProofUploadDialog } from "./staff-proof-upload-dialog";
import { ProofCellDialog } from "./proof-cell-dialog";

/**
 * Grilla meses × tipos de un contrato. Cada celda dice de un vistazo qué pasó
 * con ese comprobante; la columna del mes actual va resaltada.
 */

export const CELL_META: Record<ProofCellState, { label: string; className: string }> = {
  validado: { label: "Validado", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  en_revision: { label: "Para revisar", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  rechazado: { label: "Rechazado", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  no_corresponde: { label: "No corresponde", className: "bg-muted text-muted-foreground" },
  falta: { label: "Falta", className: "border-2 border-dashed border-amber-400/70 bg-amber-500/5 text-amber-700 dark:text-amber-300" },
  no_pedido: { label: "No se pide este mes", className: "text-muted-foreground/50" },
  fuera: { label: "Fuera del contrato", className: "" },
};

export function CellGlyph({ state, size = 16 }: { state: ProofCellState; size?: number }) {
  if (state === "validado") return <Check size={size} strokeWidth={2.5} />;
  if (state === "en_revision") return <Hourglass size={size - 2} />;
  if (state === "rechazado") return <X size={size} strokeWidth={2.5} />;
  if (state === "no_corresponde") return <Minus size={size} />;
  if (state === "no_pedido") return <span className="size-1.5 rounded-full bg-current" />;
  return null;
}

function Cell({ cell, current, onOpen }: { cell: ProofGridCell; current: boolean; onOpen: () => void }) {
  const meta = CELL_META[cell.state];
  if (cell.state === "fuera") {
    return <span className="mx-auto block size-10" aria-label={`${kindLabel(cell.kind)} ${monthLabelOf(cell.month)}: fuera del contrato`} />;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${kindLabel(cell.kind)} · ${monthLabelOf(cell.month)}: ${meta.label}`}
      aria-label={`${kindLabel(cell.kind)} de ${monthLabelOf(cell.month)}: ${meta.label}`}
      className={cn(
        "mx-auto flex size-10 items-center justify-center rounded-lg transition-all hover:scale-105 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        meta.className,
        cell.state === "falta" && current && "border-muted-foreground/40 bg-transparent text-muted-foreground",
      )}
    >
      <CellGlyph state={cell.state} />
    </button>
  );
}

export function ContractProofsGrid({ data }: { data: ContractProofGridData }) {
  const [open, setOpen] = useState<ProofGridCell | null>(null);
  const current = monthOf(data.today);
  const kindsInGrid = data.rows.map((r) => r.kind);
  const monthChoices = [...data.months].reverse();

  return (
    <div className="space-y-3">
      <SectionTitle
        hint="Comprobantes de los últimos 6 meses y el actual. Tocá una celda para verlo, validarlo o subirlo."
        action={
          <StaffProofUploadDialog
            contractId={data.contract.contractId}
            currency={data.contract.currency}
            period={current}
            monthChoices={monthChoices}
            defaultKind={kindsInGrid[0]}
            tenantName={data.contract.tenantName}
          >
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5">
              <Upload size={14} /> <span className="hidden sm:inline">Subir comprobante</span>
              <span className="sm:hidden">Subir</span>
            </Button>
          </StaffProofUploadDialog>
        }
      >
        Expensas y servicios
      </SectionTitle>

      {data.rows.length === 0 ? (
        <Card className="items-center gap-3 border-dashed p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ClipboardList size={22} />
          </div>
          <div>
            <p className="text-base font-semibold">Este contrato no pide comprobantes</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Se configura en el contrato, en «Expensas y servicios»: las expensas si las paga el inquilino y los servicios con
              «pedir comprobante». Cada mes se piden solos.
            </p>
          </div>
          <Link href={`/dashboard/alquileres/contratos/${data.contract.contractId}/editar`} className="text-xs font-medium text-primary hover:underline">
            Editar el contrato
          </Link>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {data.expensasExpected > 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                  data.expensasOk === data.expensasExpected ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" : "bg-card",
                )}
              >
                Expensas al día: <strong className="tabular-nums">{data.expensasOk} de {data.expensasExpected}</strong> meses
              </span>
            )}
            {data.pendingReview > 0 && (
              <Link
                href="/dashboard/alquileres/comprobantes?tab=revisar"
                className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/5 px-2.5 py-1 text-blue-700 hover:bg-blue-500/10 dark:text-blue-300"
              >
                {data.pendingReview} para revisar
              </Link>
            )}
          </div>
          <Card className="gap-0 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 border-b bg-muted px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Servicio
                    </th>
                    {data.months.map((m, i) => (
                      <th
                        key={m}
                        className={cn(
                          "border-b px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
                          m === current ? "bg-primary/10 text-foreground" : "bg-muted",
                        )}
                      >
                        {monthShort(m, i === 0 || m.slice(5, 7) === "01")}
                        {m === current && <span className="block text-[9px] normal-case tracking-normal text-primary">este mes</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.kind}>
                      <th scope="row" className="sticky left-0 z-10 border-b bg-card px-3 py-2 text-left font-normal">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <KindChip kind={row.kind} size="sm" />
                          <span className="text-sm">{kindLabel(row.kind)}</span>
                        </span>
                      </th>
                      {row.cells.map((cell) => (
                        <td key={cell.month} className={cn("border-b px-1 py-1.5", cell.month === current && "bg-primary/5")}>
                          <Cell cell={cell} current={cell.month === current} onOpen={() => setOpen(cell)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
            {(["validado", "en_revision", "rechazado", "no_corresponde", "falta"] as ProofCellState[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn("flex size-5 items-center justify-center rounded", CELL_META[s].className, s === "falta" && "border")}>
                  <CellGlyph state={s} size={12} />
                </span>
                {CELL_META[s].label}
              </span>
            ))}
          </div>
        </>
      )}

      <ProofCellDialog cell={open} data={data} onClose={() => setOpen(null)} />
    </div>
  );
}
