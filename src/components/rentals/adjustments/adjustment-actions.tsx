"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, ChevronDown, Loader2, Mail, MessageCircle, PencilLine, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { applyAdjustment, notifyAdjustment, reopenAdjustment } from "@/lib/actions/rentals-adjustments";
import { plainMoney, shortDate } from "./adjustment-text";
import { adjustmentActions, type AdjustmentView } from "./adjustment-view";
import { OverrideDialog, SkipDialog } from "./adjustment-dialogs";
import { WhatsappNoticeDialog } from "./whatsapp-notice-dialog";

/** Botonera de una tarjeta de ajuste: aplicar, corregir, no aplicar, volver al cálculo y avisar. */
export function AdjustmentActions({
  adj,
  today,
  canEdit,
  scheduled = false,
}: {
  adj: AdjustmentView;
  today: string;
  canEdit: boolean;
  /** Se va a aplicar solo (auto-aplicación): "Aplicar" pasa a ser una opción secundaria. */
  scheduled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"apply" | "mail" | "reopen" | null>(null);
  const [dialog, setDialog] = useState<"override" | "skip" | "whatsapp" | null>(null);
  const can = adjustmentActions(adj);
  if (!canEdit) return null;

  function run(kind: "apply" | "mail" | "reopen", fn: () => Promise<void>) {
    setBusy(kind);
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });
  }

  const apply = () =>
    run("apply", async () => {
      const res = await applyAdjustment(adj.id);
      if (!res.ok) {
        toast.error("No se pudo aplicar", { description: res.error });
        return;
      }
      toast.success(`Ajuste aplicado: desde el ${shortDate(adj.effectiveDate)} rige ${plainMoney(res.amount, adj.currency)}`, {
        description: "Ahora avisale al inquilino.",
      });
      router.refresh();
    });

  const mail = () =>
    run("mail", async () => {
      const res = await notifyAdjustment(adj.id, { channel: "email" });
      if (!res.ok) {
        toast.error("No se pudo avisar", { description: res.error });
        return;
      }
      toast.success("Aviso enviado", { description: res.sentTo ? `Le llegó a ${res.sentTo}.` : undefined });
      router.refresh();
    });

  const reopen = () =>
    run("reopen", async () => {
      const res = await reopenAdjustment(adj.id);
      if (!res.ok) {
        toast.error("No se pudo volver al cálculo", { description: res.error });
        return;
      }
      toast.success("El ajuste vuelve a seguir el índice", { description: "Se recalculó con los datos publicados." });
      router.refresh();
    });

  const spinner = (k: typeof busy) => (busy === k && pending ? <Loader2 size={14} className="animate-spin" /> : null);
  const hasAny = can.apply || can.override || can.skip || can.reopen || can.notify;
  if (!hasAny) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {can.apply &&
        (scheduled ? (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={apply} disabled={pending}>
            {spinner("apply") ?? <Check size={14} />} Aplicar ahora
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={apply} disabled={pending}>
            {spinner("apply") ?? <Check size={14} />} Aplicar
          </Button>
        ))}
      {can.override && (
        <Button
          size="sm"
          variant={adj.status === "pendiente_manual" ? "default" : "outline"}
          className="gap-1.5"
          onClick={() => setDialog("override")}
          disabled={pending}
        >
          <PencilLine size={14} /> {adj.status === "pendiente_manual" ? "Cargar monto" : "Corregir monto"}
        </Button>
      )}
      {can.notify && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant={adj.notifiedAt ? "ghost" : "outline"} className="gap-1.5" disabled={pending}>
              {spinner("mail") ?? <Send size={14} />} {adj.notifiedAt ? "Avisar otra vez" : "Avisar al inquilino"}
              <ChevronDown size={12} className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Mandar el alquiler nuevo</DropdownMenuLabel>
            <DropdownMenuItem onSelect={mail} disabled={!adj.tenantEmail} className="gap-2">
              <Mail size={14} />
              <span className="min-w-0 truncate">{adj.tenantEmail ? `Por mail a ${adj.tenantEmail}` : "Por mail (sin mail cargado)"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("whatsapp")} className="gap-2">
              <MessageCircle size={14} /> Por WhatsApp
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {(can.skip || can.reopen) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" disabled={pending} aria-label="Más acciones del ajuste">
              Más <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {can.reopen && (
              <DropdownMenuItem onSelect={reopen} className="gap-2">
                {spinner("reopen") ?? <RotateCcw size={14} />} Volver al cálculo del índice
              </DropdownMenuItem>
            )}
            {can.reopen && can.skip && <DropdownMenuSeparator />}
            {can.skip && (
              <DropdownMenuItem onSelect={() => setDialog("skip")} className="gap-2">
                <Ban size={14} /> No aplicar este ajuste
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {dialog === "override" && <OverrideDialog adj={adj} today={today} open onOpenChange={(v) => !v && setDialog(null)} />}
      {dialog === "skip" && <SkipDialog adj={adj} open onOpenChange={(v) => !v && setDialog(null)} />}
      {dialog === "whatsapp" && (
        <WhatsappNoticeDialog adjustmentId={adj.id} tenantName={adj.tenantName} open onOpenChange={(v) => !v && setDialog(null)} />
      )}
    </div>
  );
}
