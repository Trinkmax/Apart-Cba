"use client";

import { useState } from "react";
import { Copy, KeyRound, MessageCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Acceso recién generado. La contraseña sólo existe acá: al cerrar, se pierde. */
export interface AccessCredential {
  fullName: string;
  email: string;
  password: string;
}

interface Props {
  credential: AccessCredential | null;
  /** Nombre de la organización — va en el mensaje de WhatsApp. */
  orgName: string;
  /** Se llama sólo cuando la persona confirma que ya entregó el acceso. */
  onClose: () => void;
}

// El env de Vercel a veces trae un "\n" pegado y una barra final: sin limpiarlo
// el link del mensaje sale roto. Mismo tratamiento que en reservas/[id].
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");

function buildWhatsappMessage(c: AccessCredential, orgName: string): string {
  const firstName = c.fullName.trim().split(/\s+/)[0] || c.fullName.trim();
  return [
    `Hola ${firstName}! Te di acceso al sistema de ${orgName}.`,
    "",
    `Entrá acá: ${APP_URL}/login`,
    `Usuario: ${c.email}`,
    `Contraseña: ${c.password}`,
    "",
    "Cuando entres, cambiala por una tuya desde tu perfil. Cualquier cosa, avisame.",
  ].join("\n");
}

async function copy(text: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    // Clipboard bloqueado (contexto no seguro, permisos): el texto igual está
    // a la vista para seleccionarlo a mano, así que no es un callejón sin salida.
    toast.error("No se pudo copiar", {
      description: "Seleccioná el texto y copialo a mano.",
    });
  }
}

/**
 * Diálogo de entrega de acceso, compartido por la invitación y por "regenerar
 * contraseña". No se puede cerrar sin querer (Escape, click afuera y la X están
 * bloqueados) porque al cerrarlo la contraseña deja de existir: no queda
 * guardada en ningún lado ni se puede volver a mostrar.
 */
export function AccessCredentialDialog({ credential, orgName, onClose }: Props) {
  if (!credential) return null;
  // La `key` hace que cada acceso nuevo arranque con el checkbox sin marcar.
  return (
    <CredentialDialog
      key={credential.password}
      credential={credential}
      orgName={orgName}
      onClose={onClose}
    />
  );
}

function CredentialDialog({
  credential,
  orgName,
  onClose,
}: Props & { credential: AccessCredential }) {
  const [confirmed, setConfirmed] = useState(false);

  const message = buildWhatsappMessage(credential, orgName);

  return (
    <Dialog open onOpenChange={() => { /* la única salida es el botón de abajo */ }}>
      <DialogContent
        className="max-w-lg"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Acceso de {credential.fullName}</DialogTitle>
          <DialogDescription>
            Copiá el mensaje y mandáselo por WhatsApp. Con eso ya puede entrar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <TriangleAlert className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed">
              Esta contraseña se muestra una sola vez. Si cerrás sin pasarla, vas a
              tener que generar una nueva desde el menú <span className="font-mono">⋯</span> del equipo.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Mensaje para WhatsApp</Label>
            <Textarea
              readOnly
              value={message}
              rows={8}
              className="text-xs leading-relaxed"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              className="w-full gap-2"
              onClick={() => copy(message, "Mensaje copiado. Pegalo en WhatsApp.")}
            >
              <MessageCircle size={16} />
              Copiar mensaje para WhatsApp
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Usuario (email)</Label>
              <div className="flex gap-2">
                <Input readOnly value={credential.email} className="font-mono text-xs" />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Copiar email"
                  onClick={() => copy(credential.email, "Email copiado")}
                >
                  <Copy size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contraseña</Label>
              <div className="flex gap-2">
                <Input readOnly value={credential.password} className="font-mono text-xs" />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Copiar contraseña"
                  onClick={() => copy(credential.password, "Contraseña copiada")}
                >
                  <Copy size={14} />
                </Button>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer rounded-md border p-3">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm leading-snug">
              Ya le pasé el acceso
              <span className="block text-xs text-muted-foreground">
                Marcalo cuando el mensaje ya esté enviado.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button type="button" className="w-full" disabled={!confirmed} onClick={onClose}>
            <KeyRound size={16} />
            Ya se la envié
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
