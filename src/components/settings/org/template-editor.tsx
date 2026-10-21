"use client";

import { useState, useTransition, useRef } from "react";
import { Eye, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { restoreOrgTemplate, updateOrgTemplate } from "@/lib/actions/org";
import { TEMPLATE_VAR_GROUPS, findInvalidVariables } from "@/lib/email/templates/variables";
import {
  DEFAULT_GUEST_MESSAGES,
  type GuestMessageEvent,
} from "@/lib/email/templates/guest-defaults";
import { renderGuestMessage, type BookingMessageVariables } from "@/lib/email/booking-message";

interface Props {
  eventType: GuestMessageEvent;
  initialBody: string;
  /** false = la org nunca lo guardó (o volvió al original). */
  custom: boolean;
  /** Datos con los que se arma la vista previa (una reserva real si hay). */
  previewVars: BookingMessageVariables;
  /** "la reserva de Lucía en Alto Tucumán" / "un ejemplo". */
  previewLabel: string;
}

export function TemplateEditor({ eventType, initialBody, custom, previewVars, previewLabel }: Props) {
  const [body, setBody] = useState(initialBody);
  const [savedBody, setSavedBody] = useState(initialBody);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const esInstructivo = eventType === "booking_instructions";
  const invalid = findInvalidVariables(body, eventType);
  const dirty = body !== savedBody;
  // Sin guardar nunca, "Guardar" vale aunque no se haya tocado: es lo que
  // activa el instructivo (o fija el texto de arranque como propio).
  const canSave = body.trim().length > 0 && invalid.length === 0 && (dirty || !custom);

  function insertVariable(varName: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const insert = `{{${varName}}}`;
    const next = body.slice(0, start) + insert + body.slice(end);
    setBody(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + insert.length, start + insert.length);
    }, 0);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateOrgTemplate({ event_type: eventType, body });
      if (!result.ok) {
        toast.error("No se pudo guardar", { description: result.error });
        return;
      }
      setSavedBody(body.trim());
      setBody((b) => b.trim());
      toast.success(
        esInstructivo && !custom ? "Instructivo activado" : "Mensaje guardado",
        {
          description: esInstructivo
            ? "Ya aparece en cada reserva para copiarlo."
            : "Ya es el mensaje que aparece abajo de cada reserva.",
        }
      );
    });
  }

  function handleRestore() {
    startTransition(async () => {
      const result = await restoreOrgTemplate({ event_type: eventType });
      if (!result.ok) {
        toast.error("No se pudo deshacer", { description: result.error });
        return;
      }
      setRestoreOpen(false);
      if (!esInstructivo) {
        setBody(DEFAULT_GUEST_MESSAGES[eventType]);
        setSavedBody(DEFAULT_GUEST_MESSAGES[eventType]);
      }
      toast.success(esInstructivo ? "Instructivo desactivado" : "Volviste al mensaje original");
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
      <div className="space-y-3 min-w-0">
        {!custom && (
          <p className="rounded-md border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground">
            {esInstructivo
              ? "Todavía no está activo. Escribilo a tu gusto y guardalo: desde ahí aparece en cada reserva para copiarlo."
              : "Mientras no lo guardes, abajo de cada reserva sale el mensaje original (con seña y restante). Este texto es un punto de partida: cambialo a tu gusto."}
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor={`b_${eventType}`}>Mensaje</Label>
          <Textarea
            id={`b_${eventType}`}
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            className="text-sm leading-relaxed"
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Lo que va entre llaves dobles, como {"{{guest.first_name}}"}, se completa solo con los datos de cada
            reserva. Para sumar uno, tocalo en la lista.
          </p>
          {invalid.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              <span>
                Estos datos no existen: {invalid.map((v) => `{{${v}}}`).join(", ")}. Borralos e insertalos desde la
                lista.
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {custom && (
            <Button variant="ghost" size="sm" onClick={() => setRestoreOpen(true)} disabled={isPending}>
              <RotateCcw size={14} className="mr-1.5" />
              {esInstructivo ? "Desactivar" : "Volver al original"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye size={14} className="mr-1.5" /> Vista previa
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending || !canSave}>
            {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            {esInstructivo && !custom ? "Guardar y activar" : "Guardar"}
          </Button>
        </div>
      </div>

      <aside className="min-w-0">
        <Label className="text-xs">Datos de la reserva</Label>
        <p className="text-xs text-muted-foreground mb-2">Tocá uno para sumarlo donde está el cursor.</p>
        <div className="space-y-3 lg:max-h-[26rem] lg:overflow-y-auto pr-1">
          {TEMPLATE_VAR_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-0.5">
                {g.title}
              </p>
              {g.vars.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVariable(v.key)}
                  className="block w-full text-left px-2 py-1 rounded hover:bg-accent"
                >
                  <span className="block text-xs">{v.label}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground">{`{{${v.key}}}`}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Vista previa</DialogTitle>
            <DialogDescription>Así sale con los datos de {previewLabel}.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60svh] overflow-y-auto rounded-md border bg-background p-4 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {renderGuestMessage(body, previewVars)}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={restoreOpen} onOpenChange={(open) => !isPending && setRestoreOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {esInstructivo ? "¿Desactivar el instructivo?" : "¿Volver al mensaje original?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {esInstructivo
                ? "Deja de aparecer en las reservas. Lo que escribiste queda guardado acá: para activarlo de nuevo, guardalo."
                : "Abajo de cada reserva vuelve a salir el mensaje original, con seña y restante. Vas a perder el texto que escribiste."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleRestore();
              }}
              disabled={isPending}
            >
              {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
              {esInstructivo ? "Desactivar" : "Volver al original"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
