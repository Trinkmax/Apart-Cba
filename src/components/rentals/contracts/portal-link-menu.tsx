"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, Copy, ExternalLink, Link2, Loader2, MessageCircle, RefreshCcw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import { regenerateContractPortalLink } from "@/lib/actions/rentals-contracts";

/**
 * "Link del inquilino": su portal sin cuenta (lo que debe, recibos, subir
 * comprobantes). Copiar, mandar por WhatsApp (el mensaje se copia y se abre
 * el chat: iOS rompe los emojis de ?text=) o generar uno nuevo.
 */

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function PortalLinkMenu({
  contractId,
  portalPath,
  tenantName,
  tenantPhone,
}: {
  contractId: string;
  portalPath: string;
  tenantName: string | null;
  tenantPhone: string | null;
}) {
  const [path, setPath] = useState(portalPath);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const url = () => `${window.location.origin}${path}`;
  const wa = tenantPhone ? toWhatsappDigits(tenantPhone) : "";

  async function copyLink() {
    if (await copy(url())) toast.success("Link copiado", { description: "Mandáselo al inquilino: no necesita cuenta." });
    else toast.error("No se pudo copiar", { description: url() });
  }

  async function sendWhatsapp() {
    const first = tenantName?.split(" ")[0] ?? "";
    const msg = `Hola${first ? ` ${first}` : ""}! Te paso tu link para ver lo que tenés que pagar, bajar tus recibos y subir los comprobantes de expensas y servicios: ${url()}`;
    const ok = await copy(msg);
    if (wa.length >= 8) window.open(`https://wa.me/${wa}`, "_blank", "noopener");
    toast.success(ok ? "Mensaje copiado" : "Abrimos WhatsApp", { description: ok ? "Pegalo en el chat del inquilino." : msg });
  }

  function regenerate() {
    startTransition(async () => {
      const res = await regenerateContractPortalLink(contractId);
      if (!res.ok) {
        toast.error("No se pudo generar el link", { description: res.error });
        return;
      }
      setPath(res.path);
      setConfirm(false);
      const ok = await copy(`${window.location.origin}${res.path}`);
      toast.success("Link nuevo generado", { description: ok ? "Ya está copiado. El anterior dejó de funcionar." : "El anterior dejó de funcionar." });
    });
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Link2 size={14} /> <span className="hidden sm:inline">Link del inquilino</span>
            <span className="sm:hidden">Link</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Portal del inquilino, sin cuenta</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Copy size={14} /> Copiar link
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void sendWhatsapp()}>
            <MessageCircle size={14} /> Mandar por WhatsApp
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => window.open(url(), "_blank", "noopener")}>
            <ExternalLink size={14} /> Ver como el inquilino
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirm(true)}>
            <RefreshCcw size={14} /> Generar link nuevo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Generar un link nuevo?</AlertDialogTitle>
            <AlertDialogDescription>
              El link que tiene el inquilino deja de funcionar. Sirve si lo compartió con alguien que no debía o si cambió el inquilino.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                regenerate();
              }}
              disabled={pending}
              className="gap-2"
            >
              {pending && <Loader2 size={14} className="animate-spin" />} Generar link nuevo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
