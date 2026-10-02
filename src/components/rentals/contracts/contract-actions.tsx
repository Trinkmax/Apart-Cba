"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CalendarCheck2,
  CalendarOff,
  CalendarPlus,
  DoorOpen,
  FileDown,
  Gavel,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Rocket,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RegisterPaymentButton } from "@/components/rentals/collections/register-payment-button";
import { formatContractNumber } from "@/lib/rentals/labels";
import { setRentalContinuationBilling } from "@/lib/actions/rentals-contracts";
import type { OrgBranding } from "@/lib/pdf/org-header";
import { ActivateContractDialog } from "./activate-contract-dialog";
import { IntimationDialog } from "./intimation-dialog";
import { DeleteDraftDialog, FinalizeContractDialog, RenewContractDialog } from "./lifecycle-dialogs";
import { PortalLinkMenu } from "./portal-link-menu";
import { RescindContractDialog } from "./rescind-contract-dialog";
import type { ContractDetailData } from "./types";

/** Barra de acciones de la ficha: cobrar, link del inquilino y "Más" (editar, renovar, terminar, intimar, PDF, borrar). */

type DialogKey = "activate" | "finalize" | "renew" | "rescind" | "intimation" | "delete";

export function ContractActions({ detail, org }: { detail: ContractDetailData; org: OrgBranding }) {
  const c = detail.contract;
  const [dialog, setDialog] = useState<DialogKey | null>(null);
  const [pdfPending, startPdf] = useTransition();
  const live = c.status === "vigente";
  const draft = c.status === "borrador";
  const ended = c.status === "finalizado" || c.status === "rescindido";
  // Rescisión notificada o entrega programada: sigue vigente hasta esa fecha y no admite otra salida.
  const exitScheduled = live && Boolean(c.terminated_at);
  const tenant = detail.parties.find((p) => p.role === "inquilino" && p.isPrimary) ?? detail.parties.find((p) => p.role === "inquilino") ?? null;
  const close = (open: boolean) => !open && setDialog(null);

  function downloadPdf() {
    startPdf(async () => {
      try {
        const { generateContractSheetPDF } = await import("@/lib/pdf/rental-contract-pdf");
        await generateContractSheetPDF(detail, org);
      } catch (e) {
        toast.error("No se pudo armar el PDF", { description: (e as Error).message });
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {(live || (ended && detail.balance.debt > 0.004)) && (
          <RegisterPaymentButton contractId={c.id} defaultAmount={detail.balance.debt > 0.004 ? detail.balance.debt : null} />
        )}
        {draft && (
          <Button onClick={() => setDialog("activate")} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            <Rocket size={14} /> Activar contrato
          </Button>
        )}
        {detail.portalPath && <PortalLinkMenu contractId={c.id} portalPath={detail.portalPath} tenantName={tenant?.name ?? null} tenantPhone={tenant?.phone ?? null} />}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2" aria-label="Más acciones">
              <MoreHorizontal size={16} /> <span className="hidden sm:inline">Más</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {(draft || live) && (
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/alquileres/contratos/${c.id}/editar`}>
                  <Pencil size={14} /> Editar
                </Link>
              </DropdownMenuItem>
            )}
            {(live || ended) && !detail.renewal && (
              <DropdownMenuItem onSelect={() => setDialog("renew")}>
                <RefreshCcw size={14} /> Renovar
              </DropdownMenuItem>
            )}
            {detail.renewal && (
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/alquileres/contratos/${detail.renewal.id}`}>
                  <RefreshCcw size={14} /> Ver la renovación ({formatContractNumber(detail.renewal.number)})
                </Link>
              </DropdownMenuItem>
            )}
            {live && !exitScheduled && (
              <>
                <DropdownMenuItem onSelect={() => setDialog("finalize")}>
                  <CalendarCheck2 size={14} /> Finalizar
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("rescind")}>
                  <DoorOpen size={14} /> Rescindir (se va antes)
                </DropdownMenuItem>
              </>
            )}
            {exitScheduled && (
              <DropdownMenuItem onSelect={() => setDialog("finalize")}>
                <CalendarCheck2 size={14} /> Registrar entrega de llaves
              </DropdownMenuItem>
            )}
            {!draft && (
              <DropdownMenuItem onSelect={() => setDialog("intimation")} disabled={!(detail.balance.overdue > 0.004)}>
                <Gavel size={14} /> Intimación por falta de pago
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={downloadPdf} disabled={pdfPending}>
              {pdfPending ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Descargar ficha PDF
            </DropdownMenuItem>
            {draft && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setDialog("delete")} className="text-rose-600 focus:text-rose-700">
                  <Trash2 size={14} /> Borrar borrador
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {draft && (
        <ActivateContractDialog
          contractId={c.id}
          open={dialog === "activate"}
          onOpenChange={close}
          suggestion={detail.entrySuggestion}
          currency={c.currency}
          startDate={c.start_date}
          today={detail.today}
        />
      )}
      {dialog === "finalize" && (
        <FinalizeContractDialog
          contractId={c.id}
          open
          onOpenChange={close}
          endDate={c.end_date}
          today={detail.today}
          scheduledExit={exitScheduled ? c.terminated_at : null}
          rescission={Boolean(c.termination_notice_date)}
        />
      )}
      {dialog === "renew" && (
        <RenewContractDialog contractId={c.id} open onOpenChange={close} endDate={c.end_date} durationMonths={c.duration_months} rentInForce={detail.rentInForce} currency={c.currency} />
      )}
      {dialog === "rescind" && (
        <RescindContractDialog contractId={c.id} open onOpenChange={close} today={detail.today} endDate={c.end_date} currency={c.currency} rule={c.early_termination_rule} />
      )}
      {dialog === "intimation" && <IntimationDialog contractId={c.id} open onOpenChange={close} />}
      {dialog === "delete" && <DeleteDraftDialog contractId={c.id} open onOpenChange={close} label={formatContractNumber(c.number)} />}
    </>
  );
}

/** Banner del borrador: qué falta y el botón para activarlo. */
export function DraftBanner({ detail }: { detail: ContractDetailData }) {
  const [open, setOpen] = useState(false);
  const c = detail.contract;
  const ownersPct = detail.owners.reduce((s, o) => s + o.pct, 0);
  const problems = [
    !detail.owners.length ? "La propiedad no tiene propietarios cargados." : Math.abs(ownersPct - 100) > 0.01 ? `Los porcentajes de los propietarios suman ${ownersPct.toLocaleString("es-AR")} %.` : null,
    !detail.parties.some((p) => p.role === "inquilino") ? "Falta el inquilino." : null,
  ].filter((x): x is string => Boolean(x));
  return (
    <div className="rounded-xl border border-slate-400/30 bg-slate-500/[0.06] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Es un borrador: todavía no genera cargos ni ajustes.</p>
        {problems.length ? (
          <ul className="text-xs text-amber-800 dark:text-amber-200 mt-1 space-y-0.5">
            {problems.map((p) => (
              <li key={p}>· {p} Corregilo antes de activar.</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5">Revisá las condiciones y activalo cuando esté firmado.</p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href={`/dashboard/alquileres/contratos/${c.id}/editar`}>
            <Pencil size={14} /> Editar
          </Link>
        </Button>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
          <Rocket size={14} /> Activar contrato
        </Button>
      </div>
      <ActivateContractDialog
        contractId={c.id}
        open={open}
        onOpenChange={setOpen}
        suggestion={detail.entrySuggestion}
        currency={c.currency}
        startDate={c.start_date}
        today={detail.today}
      />
    </div>
  );
}

/** Botón del aviso "vencido · sigue ocupando": cobrar (o dejar de cobrar) los meses de continuación (art. 1218). */
export function ContinuationBillingButton({ contractId, on }: { contractId: string; on: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function toggle() {
    startTransition(async () => {
      const res = await setRentalContinuationBilling(contractId, !on);
      if (!res.ok) {
        toast.error("No se pudo cambiar el cobro", { description: res.error });
        return;
      }
      if (on) {
        toast.success("Ya no se cobran los meses de continuación", {
          description: "Los cargos que ya se generaron siguen en la cuenta: anulalos si no corresponden.",
        });
      } else {
        toast.success("Se cobran los meses de continuación", {
          description: res.created
            ? `Se ${res.created === 1 ? "generó 1 cargo" : `generaron ${res.created} cargos`} al último alquiler, sin ajustes nuevos.`
            : "Se generan como los demás meses, al último alquiler y sin ajustes nuevos.",
        });
      }
      router.refresh();
    });
  }
  return (
    <Button size="sm" variant={on ? "outline" : "default"} onClick={toggle} disabled={pending} className="gap-1.5 shrink-0">
      {pending ? <Loader2 size={14} className="animate-spin" /> : on ? <CalendarOff size={14} /> : <CalendarPlus size={14} />}
      {on ? "Dejar de cobrarlos" : "Cobrar los meses de continuación"}
    </Button>
  );
}
