"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CalendarCheck2,
  CalendarClock,
  CalendarOff,
  CalendarPlus,
  DoorOpen,
  FileDown,
  Gavel,
  HandCoins,
  Loader2,
  MoreHorizontal,
  Pencil,
  PiggyBank,
  RefreshCcw,
  Rocket,
  Trash2,
  Undo2,
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
import { isValidConsent, joinNamesEs } from "@/lib/rentals/renewal";
import { setRentalContinuationBilling } from "@/lib/actions/rentals-contracts";
import type { OrgBranding } from "@/lib/pdf/org-header";
import { ActivateContractDialog } from "./activate-contract-dialog";
import { IntimationDialog } from "./intimation-dialog";
import { ChangeExitDialog, DeleteDraftDialog, FinalizeContractDialog, RenewContractDialog } from "./lifecycle-dialogs";
import { PortalLinkMenu } from "./portal-link-menu";
import { RescindContractDialog } from "./rescind-contract-dialog";
import { DepositDialog, type DepositDialogMode } from "./deposit-dialog";
import { isDepositSettled, type DepositFlags } from "@/lib/rentals/deposit";
import type { ContractDetailData } from "./types";

/** Barra de acciones de la ficha: cobrar, link del inquilino y "Más" (editar, renovar, terminar, intimar, PDF, borrar). */

type DialogKey = "activate" | "finalize" | "renew" | "rescind" | "exit" | "intimation" | "delete";

export function ContractActions({ detail, org, deposit }: { detail: ContractDetailData; org: OrgBranding; deposit?: DepositFlags }) {
  const c = detail.contract;
  const [dialog, setDialog] = useState<DialogKey | null>(null);
  const [pdfPending, startPdf] = useTransition();
  const live = c.status === "vigente";
  const draft = c.status === "borrador";
  const ended = c.status === "finalizado" || c.status === "rescindido";
  // Ya rige su renovación: se cierra solo el día antes de que empiece, sin salida que registrar ni mover.
  const renewalActive = live && detail.renewal?.status === "vigente";
  // Rescisión notificada o entrega programada: sigue vigente hasta esa fecha y no admite otra salida (sí correrla o anularla).
  const exitScheduled = live && Boolean(c.terminated_at) && !renewalActive;
  const tenant = detail.parties.find((p) => p.role === "inquilino" && p.isPrimary) ?? detail.parties.find((p) => p.role === "inquilino") ?? null;
  const close = (open: boolean) => !open && setDialog(null);
  // Depósito (068h): cerrar al terminar, marcar cobrado lo que no pasó por la cuenta, deshacer.
  const [depositMode, setDepositMode] = useState<DepositDialogMode | null>(null);
  const hasDeposit = Number(c.deposit_amount) > 0;
  const depositActions = {
    settle: ended && hasDeposit && c.deposit_status === "retenido",
    mark: !draft && hasDeposit && c.deposit_status === "pendiente" && deposit != null && !deposit.tracked && !deposit.receivedManually,
    // También desde 'pendiente': una marca a mano vieja con un renglón de depósito agregado después (la 068j lo permite).
    unmark:
      !draft &&
      hasDeposit &&
      (c.deposit_status === "retenido" || c.deposit_status === "pendiente") &&
      Boolean(deposit?.receivedManually) &&
      deposit?.inheritedFromNumber == null,
    reopen: hasDeposit && isDepositSettled(c.deposit_status),
  };

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
            {live && !exitScheduled && !renewalActive && (
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
              <>
                <DropdownMenuItem onSelect={() => setDialog("finalize")}>
                  <CalendarCheck2 size={14} /> Registrar entrega de llaves
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("exit")}>
                  <CalendarClock size={14} /> Cambiar la salida
                </DropdownMenuItem>
              </>
            )}
            {!draft && (
              <DropdownMenuItem onSelect={() => setDialog("intimation")} disabled={!(detail.balance.overdue > 0.004)}>
                <Gavel size={14} /> Intimación por falta de pago
              </DropdownMenuItem>
            )}
            {depositActions.settle && (
              <DropdownMenuItem onSelect={() => setDepositMode("settle")}>
                <PiggyBank size={14} /> Cerrar el depósito
              </DropdownMenuItem>
            )}
            {depositActions.mark && (
              <DropdownMenuItem onSelect={() => setDepositMode("mark")}>
                <HandCoins size={14} /> Marcar depósito como cobrado
              </DropdownMenuItem>
            )}
            {depositActions.unmark && (
              <DropdownMenuItem onSelect={() => setDepositMode("unmark")}>
                <Undo2 size={14} /> Desmarcar depósito cobrado
              </DropdownMenuItem>
            )}
            {depositActions.reopen && (
              <DropdownMenuItem onSelect={() => setDepositMode("reopen")}>
                <Undo2 size={14} /> Deshacer cierre del depósito
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

      <DepositDialog contractId={c.id} mode={depositMode} onOpenChange={(open) => !open && setDepositMode(null)} />
      {draft && (
        <ActivateContractDialog
          contractId={c.id}
          open={dialog === "activate"}
          onOpenChange={close}
          suggestion={detail.entrySuggestion}
          currency={c.currency}
          startDate={c.start_date}
          today={detail.today}
          {...renewalGuarantorsOf(detail)}
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
          continuationBilling={Boolean(c.continuation_billing)}
        />
      )}
      {dialog === "exit" && exitScheduled && c.terminated_at && (
        <ChangeExitDialog
          contractId={c.id}
          open
          onOpenChange={close}
          today={detail.today}
          scheduledExit={c.terminated_at}
          rescission={Boolean(c.termination_notice_date)}
          penalty={c.termination_penalty != null ? Number(c.termination_penalty) : null}
          currency={c.currency}
          endDate={c.end_date}
          continuationBilling={Boolean(c.continuation_billing)}
        />
      )}
      {dialog === "renew" && (
        <RenewContractDialog
          contractId={c.id}
          open
          onOpenChange={close}
          endDate={c.end_date}
          durationMonths={c.duration_months}
          rentInForce={detail.rentInForce}
          currency={c.currency}
          legalRegime={c.legal_regime}
          guarantors={detail.parties.filter((p) => p.role === "garante").length}
        />
      )}
      {dialog === "rescind" && (
        <RescindContractDialog
          contractId={c.id}
          open
          onOpenChange={close}
          today={detail.today}
          endDate={c.end_date}
          currency={c.currency}
          rule={c.early_termination_rule}
          continuationBilling={Boolean(c.continuation_billing)}
        />
      )}
      {dialog === "intimation" && <IntimationDialog contractId={c.id} open onOpenChange={close} />}
      {dialog === "delete" && <DeleteDraftDialog contractId={c.id} open onOpenChange={close} label={formatContractNumber(c.number)} />}
    </>
  );
}

/** Lo que necesita el diálogo de activación para pedir la firma de los garantes de una renovación (art. 1225 CCyC). */
function renewalGuarantorsOf(detail: ContractDetailData) {
  return {
    renewalOf: detail.renewedFrom?.number ?? null,
    guarantors: detail.parties.filter((p) => p.role === "garante").map((p) => ({ personId: p.personId, name: p.name, consentAt: p.consentAt })),
  };
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
  // No es un "problema" a corregir en otro lado: la fecha se carga en el mismo diálogo de activación.
  const unsigned = detail.renewedFrom
    ? detail.parties.filter((p) => p.role === "garante" && !isValidConsent(p.consentAt, detail.today)).map((p) => p.name)
    : [];
  return (
    <div className="rounded-xl border border-slate-400/30 bg-slate-500/[0.06] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {detail.renewedFrom ? `Es la renovación del ${formatContractNumber(detail.renewedFrom.number)}, en borrador` : "Es un borrador"}: todavía no genera cargos ni ajustes.
        </p>
        {problems.length ? (
          <ul className="text-xs text-amber-800 dark:text-amber-200 mt-1 space-y-0.5">
            {problems.map((p) => (
              <li key={p}>· {p} Corregilo antes de activar.</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5">Revisá las condiciones y activalo cuando esté firmado.</p>
        )}
        {unsigned.length > 0 && (
          <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
            · Falta que {joinNamesEs(unsigned)} {unsigned.length === 1 ? "firme" : "firmen"} la renovación como {unsigned.length === 1 ? "garante" : "garantes"} (art. 1225 CCyC): la fecha se carga al
            activar.
          </p>
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
        {...renewalGuarantorsOf(detail)}
      />
    </div>
  );
}

/** Botón del aviso de salida (rescisión notificada o entrega programada): correrla o anularla. */
export function ChangeExitButton({ detail }: { detail: ContractDetailData }) {
  const [open, setOpen] = useState(false);
  const c = detail.contract;
  if (c.status !== "vigente" || !c.terminated_at) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5 shrink-0">
        <CalendarClock size={14} /> Cambiar la salida
      </Button>
      {open && (
        <ChangeExitDialog
          contractId={c.id}
          open
          onOpenChange={setOpen}
          today={detail.today}
          scheduledExit={c.terminated_at}
          rescission={Boolean(c.termination_notice_date)}
          penalty={c.termination_penalty != null ? Number(c.termination_penalty) : null}
          currency={c.currency}
          endDate={c.end_date}
          continuationBilling={Boolean(c.continuation_billing)}
        />
      )}
    </>
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
