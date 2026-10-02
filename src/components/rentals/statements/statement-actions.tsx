"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CheckCheck, Copy, Link2, Link2Off, Loader2, Mail, MessageCircle, MoreHorizontal, RefreshCw, Send, Share2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatMoney } from "@/lib/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { closeStatementWithCarry, emitStatement, regenerateStatementLink } from "@/lib/actions/rentals-statements";
import type { OrgBranding } from "@/lib/pdf/org-header";
import type { StatementDocModel } from "./statement-model";
import type { PayoutAccount } from "./types";
import { StatementPdfButton } from "./statement-pdf-button";
import { PayStatementDialog } from "./pay-statement-dialog";
import { SendStatementDialog, VoidStatementDialog } from "./statement-dialogs";

function waHref(digits: string | null, text: string): string {
  const q = `?text=${encodeURIComponent(text)}`;
  return digits ? `https://wa.me/${digits}${q}` : `https://wa.me/${q}`;
}

async function copyText(text: string, okTitle: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okTitle, { description: text.length > 90 ? `${text.slice(0, 90)}…` : text });
  } catch {
    toast.message("Copialo desde acá", { description: text, duration: 15_000 });
  }
}

/**
 * Barra de acciones de la rendición, según su estado:
 * borrador → Emitir · emitida → Registrar pago · y siempre (salvo anulada)
 * mandar por mail, compartir el link (copiar / WhatsApp) y bajar el PDF.
 * Compartir una rendición en borrador la emite primero.
 */
export function StatementActions({
  statementId,
  model,
  branding,
  publicUrl,
  whatsappText,
  ownerWhatsappDigits,
  accounts,
  today,
}: {
  statementId: string;
  model: StatementDocModel;
  branding: OrgBranding;
  publicUrl: string | null;
  whatsappText: string | null;
  ownerWhatsappDigits: string | null;
  accounts: PayoutAccount[];
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [payOpen, setPayOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const status = model.status;
  const isDraft = status === "borrador";
  const voided = status === "anulada";
  const canPay = (status === "borrador" || status === "emitida") && model.totals.net > 0;
  // Neto cero o negativo (los gastos superaron lo cobrado): se cierra sin pago y
  // lo que quedó debiendo el propietario se descuenta en la próxima rendición.
  const canClose = (status === "borrador" || status === "emitida") && model.totals.net <= 0;
  const [closeOpen, setCloseOpen] = useState(false);
  // Link público ya armado (emitida, pagada o anulada que se había compartido):
  // se puede rotar si llegó a quien no correspondía. Anular no lo apaga.
  const hasLink = !!publicUrl;
  const [relinkOpen, setRelinkOpen] = useState(false);

  function relink() {
    start(async () => {
      const res = await regenerateStatementLink(statementId);
      if (!res.ok) return void toast.error(voided ? "No se pudo dar de baja el link" : "No se pudo generar el link nuevo", { description: res.error });
      setRelinkOpen(false);
      const url = res.url;
      if (res.voided || !url) {
        toast.success("Link dado de baja", { description: "Quien lo tenga ya no puede abrir la rendición." });
      } else {
        toast.success("Link nuevo generado", {
          description: "El anterior ya no funciona. Mandale el nuevo al propietario.",
          action: { label: "Copiar", onClick: () => void copyText(url, "Link copiado") },
        });
      }
      router.refresh();
    });
  }

  function closeWithCarry() {
    start(async () => {
      const res = await closeStatementWithCarry(statementId);
      if (!res.ok) return void toast.error("No se pudo cerrar la rendición", { description: res.error });
      setCloseOpen(false);
      toast.success(`Rendición N° ${model.number} cerrada`, {
        description: res.carry > 0 ? `${formatMoney(res.carry, model.currency)} se descuentan en la próxima rendición.` : "No quedó saldo pendiente.",
      });
      router.refresh();
    });
  }

  async function ensureShare(): Promise<{ url: string; text: string; digits: string | null } | null> {
    if (publicUrl && whatsappText) return { url: publicUrl, text: whatsappText, digits: ownerWhatsappDigits };
    const res = await emitStatement(statementId);
    if (!res.ok) {
      toast.error("No se pudo emitir la rendición", { description: res.error });
      return null;
    }
    router.refresh();
    return { url: res.share.url, text: res.share.whatsappText, digits: res.share.ownerWhatsappDigits };
  }

  function emit() {
    start(async () => {
      const res = await emitStatement(statementId);
      if (!res.ok) return void toast.error("No se pudo emitir la rendición", { description: res.error });
      toast.success(`Rendición N° ${model.number} emitida`, { description: "Ya la podés mandar por mail o WhatsApp, o registrar el pago." });
      router.refresh();
    });
  }

  function share(kind: "link" | "message") {
    start(async () => {
      const s = await ensureShare();
      if (!s) return;
      await copyText(kind === "link" ? s.url : s.text, kind === "link" ? "Link copiado" : "Mensaje copiado");
    });
  }

  function whatsapp() {
    if (publicUrl && whatsappText) {
      window.open(waHref(ownerWhatsappDigits, whatsappText), "_blank", "noopener,noreferrer");
      return;
    }
    // Hay que emitir primero: abrimos la pestaña ya (si no, el navegador la bloquea) y la llevamos a WhatsApp después.
    const tab = window.open("about:blank", "_blank");
    start(async () => {
      const s = await ensureShare();
      if (!s) {
        tab?.close();
        return;
      }
      const href = waHref(s.digits, s.text);
      if (tab) {
        tab.opener = null;
        tab.location.href = href;
      } else {
        window.location.href = href;
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isDraft && (
        <Button size="sm" className="gap-2" onClick={emit} disabled={pending}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Emitir
        </Button>
      )}
      {canPay && (
        <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setPayOpen(true)}>
          <Wallet size={14} /> Registrar pago
        </Button>
      )}
      {canClose && (
        <>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setCloseOpen(true)} disabled={pending}>
            <CheckCheck size={14} /> Cerrar con saldo a cuenta
          </Button>
          <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Cerrar la rendición sin pago?</AlertDialogTitle>
                <AlertDialogDescription>
                  {model.totals.net < 0
                    ? `Los gastos superaron lo cobrado: el propietario queda debiendo ${formatMoney(Math.abs(model.totals.net), model.currency)}. No se mueve plata en Caja y ese saldo se descuenta solo en su próxima rendición.`
                    : "El neto da cero: no hay nada para transferir. La rendición queda cerrada."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Volver</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(e) => {
                    e.preventDefault();
                    closeWithCarry();
                  }}
                >
                  {pending ? <Loader2 size={14} className="animate-spin" /> : null} Cerrar rendición
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {!voided && (
        <Button size="sm" variant="outline" className="gap-2" onClick={() => setSendOpen(true)}>
          <Mail size={14} /> <span className="hidden sm:inline">Enviar por mail</span>
          <span className="sm:hidden">Mail</span>
        </Button>
      )}
      {!voided && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="gap-2" disabled={pending}>
              <Share2 size={14} /> Compartir
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={whatsapp} className="gap-2">
              <MessageCircle size={14} /> Mandar por WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => share("link")} className="gap-2">
              <Link2 size={14} /> Copiar link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => share("message")} className="gap-2">
              <Copy size={14} /> Copiar mensaje
            </DropdownMenuItem>
            {isDraft && <p className="px-2 pb-1.5 pt-1 text-[11px] leading-snug text-muted-foreground">Al compartirla, la rendición queda emitida.</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <StatementPdfButton model={model} branding={branding} label="PDF" />
      {(!voided || hasLink) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8" aria-label="Más acciones" disabled={pending}>
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasLink && (
              <DropdownMenuItem onSelect={() => setRelinkOpen(true)} className="gap-2">
                {voided ? <Link2Off size={14} /> : <RefreshCw size={14} />} {voided ? "Dar de baja el link" : "Generar link nuevo"}
              </DropdownMenuItem>
            )}
            {!voided && (
              <DropdownMenuItem onSelect={() => setVoidOpen(true)} className="gap-2 text-rose-600 focus:text-rose-700 dark:text-rose-400">
                <Ban size={14} /> Anular rendición
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {hasLink && (
        <AlertDialog open={relinkOpen} onOpenChange={setRelinkOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{voided ? "¿Dar de baja el link?" : "¿Generar un link nuevo?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {voided
                  ? "Quien tenga el link de esta rendición ya no la va a poder abrir. Hacelo si lo mandaste a quien no correspondía."
                  : "El link que mandaste deja de funcionar: quien lo tenga ya no va a poder abrir la rendición. Hacelo si lo mandaste a quien no correspondía; después mandale el nuevo al propietario."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Volver</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(e) => {
                  e.preventDefault();
                  relink();
                }}
              >
                {pending ? <Loader2 size={14} className="animate-spin" /> : null} {voided ? "Dar de baja" : "Generar link nuevo"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {canPay && (
        <PayStatementDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          statementId={statementId}
          number={model.number}
          net={model.totals.net}
          currency={model.currency}
          accounts={accounts}
          today={today}
          owner={model.owner}
        />
      )}
      <SendStatementDialog open={sendOpen} onOpenChange={setSendOpen} statementId={statementId} number={model.number} defaultTo={model.owner.email} isDraft={isDraft} />
      <VoidStatementDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        statementId={statementId}
        number={model.number}
        paid={status === "pagada" && model.totals.net > 0}
        net={model.totals.net}
        currency={model.currency}
        paymentsCount={model.payments.length}
      />
    </div>
  );
}
