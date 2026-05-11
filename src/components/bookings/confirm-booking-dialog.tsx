"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail, MessageCircle, Send, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  confirmBookingWithMessages,
  resendBookingConfirmation,
} from "@/lib/actions/bookings";

interface BookingPreview {
  id: string;
  guest_full_name: string;
  guest_email: string | null;
  unit_name: string;
  check_in_date: string;
  check_out_date: string;
}

interface RenderedTemplate {
  subject: string | null;
  body: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Datos del booking para mostrar en el header. */
  booking: BookingPreview;
  /** Template pre-renderizado con variables sustituidas (server-side fetch). */
  initialTemplate: RenderedTemplate | null;
  /** "confirm" = primera confirmación (cambia status). "resend" = reenviar (no cambia). */
  mode: "confirm" | "resend";
  onSuccess?: () => void;
}

type Step = "channels" | "editor" | "preview";

export function ConfirmBookingDialog(props: Props) {
  // Remontar el body interno cada vez que se abre el dialog re-inicializa todos
  // los useState (step, channels, subject, body) sin necesidad de useEffect+setState
  // — patrón recomendado por React 19 para "resetear estado al abrir".
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {props.open && <ConfirmBookingDialogBody key={props.booking.id} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBookingDialogBody({
  onOpenChange,
  booking,
  initialTemplate,
  mode,
  onSuccess,
}: Props) {
  const [step, setStep] = useState<Step>("channels");
  const [emailEnabled, setEmailEnabled] = useState(!!booking.guest_email);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [subject, setSubject] = useState(initialTemplate?.subject ?? "");
  const [body, setBody] = useState(initialTemplate?.body ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSend() {
    if (!emailEnabled && booking.guest_email) {
      toast.error("Activá al menos un canal");
      return;
    }
    const channels = emailEnabled ? (["email"] as const) : ([] as const);
    const emailOverride = { subject: subject.trim() || null, body: body.trim() };

    startTransition(async () => {
      // Si no hay canales activos pero el booking no tiene email y mode === confirm,
      // delegamos en confirmBookingWithMessages: el server permite "no email" en mode confirm
      // — el status se actualiza igual y channels_failed marca "Huésped sin email registrado".
      const result =
        mode === "confirm"
          ? await confirmBookingWithMessages({
              bookingId: booking.id,
              channels: channels.length > 0 ? [...channels] : ["email"],
              emailOverride: channels.length > 0 ? emailOverride : null,
            })
          : await resendBookingConfirmation({
              bookingId: booking.id,
              channels: [...channels],
              emailOverride,
            });

      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }

      const sent = result.channels_sent.length;
      const failed = result.channels_failed.length;

      // "Confirmar sin enviar": en mode confirm sin email del huésped, el server actualiza
      // status a confirmada y devuelve { ok: true, channels_sent: [], channels_failed: [{email}] }.
      // Mostramos success específico y NO caemos en total-failure.
      if (mode === "confirm" && !booking.guest_email && sent === 0) {
        toast.success("Reserva confirmada (sin notificación al huésped)");
      } else if (sent > 0 && failed === 0) {
        toast.success(
          mode === "confirm"
            ? `Reserva confirmada. ${sent === 1 ? "Mail enviado" : `${sent} mensajes enviados`}.`
            : `Confirmación reenviada (${sent === 1 ? "1 canal" : `${sent} canales`})`
        );
      } else if (sent > 0 && failed > 0) {
        toast.warning(
          `${mode === "confirm" ? "Reserva confirmada" : "Reenvío parcial"} — ${sent} OK, ${failed} fallaron: ${result.channels_failed.map((f) => f.error).join("; ")}`
        );
      } else {
        toast.error("Ningún canal pudo enviarse", {
          description: result.channels_failed.map((f) => `${f.channel}: ${f.error}`).join("\n"),
        });
        return;
      }
      onOpenChange(false);
      onSuccess?.();
    });
  }

  const showWhatsAppWarning = whatsappEnabled;

  return (
    <>
      <DialogHeader>
          <DialogTitle>
            {mode === "confirm" ? "Confirmar reserva" : "Reenviar confirmación"} — {booking.guest_full_name}
          </DialogTitle>
          <DialogDescription>
            {booking.unit_name} · {booking.check_in_date} → {booking.check_out_date}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StepIndicator label="Canales" active={step === "channels"} done={step !== "channels"} />
          <span>›</span>
          <StepIndicator label="Editor" active={step === "editor"} done={step === "preview"} />
          <span>›</span>
          <StepIndicator label="Vista previa" active={step === "preview"} done={false} />
        </div>

        {step === "channels" && (
          <div className="space-y-3">
            {!booking.guest_email && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50 p-3 flex items-start gap-2">
                <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Huésped sin email</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {mode === "confirm"
                      ? "Podés confirmar la reserva igual, pero no se va a enviar notificación."
                      : "No hay forma de reenviar. Editá el huésped para agregar un email."}
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="flex items-center gap-3 rounded-md border p-3 cursor-pointer">
                <Checkbox
                  checked={emailEnabled}
                  onCheckedChange={(v) => setEmailEnabled(!!v)}
                  disabled={!booking.guest_email}
                />
                <Mail size={16} />
                <div className="flex-1">
                  <div className="font-medium text-sm">Email</div>
                  <div className="text-xs text-muted-foreground">
                    {booking.guest_email ?? "Sin email registrado"}
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 rounded-md border p-3 opacity-50">
                <Checkbox
                  checked={whatsappEnabled}
                  onCheckedChange={(v) => setWhatsappEnabled(!!v)}
                  disabled
                />
                <MessageCircle size={16} />
                <div className="flex-1">
                  <div className="font-medium text-sm flex items-center gap-2">
                    WhatsApp
                    <Badge variant="secondary" className="text-xs">próximamente</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">Se habilita en una versión futura</div>
                </div>
              </label>
              {showWhatsAppWarning && (
                <p className="text-xs text-muted-foreground">WhatsApp aún no está disponible. Solo se va a enviar email.</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              {emailEnabled && booking.guest_email ? (
                <Button onClick={() => setStep("editor")}>Siguiente →</Button>
              ) : !booking.guest_email && mode === "confirm" ? (
                <Button onClick={handleSend} disabled={isPending} variant="destructive">
                  {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                  Confirmar sin enviar
                </Button>
              ) : (
                <Button disabled>Sin canales activos</Button>
              )}
            </DialogFooter>
          </div>
        )}

        {step === "editor" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Editá el contenido. Los cambios solo aplican a este envío — el template default se mantiene.</p>
            <div className="space-y-2">
              <Label htmlFor="cb_subject">Asunto</Label>
              <Input id="cb_subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cb_body">Cuerpo</Label>
              <Textarea id="cb_body" value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-xs" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("channels")}>← Atrás</Button>
              <Button onClick={() => setStep("preview")}>Vista previa →</Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3">
            <div className="rounded-md border bg-card p-4 space-y-2">
              <div className="text-xs text-muted-foreground space-y-1">
                <div><strong>Para:</strong> {booking.guest_email}</div>
                {subject && <div><strong>Asunto:</strong> {subject}</div>}
              </div>
              <hr />
              <div className="whitespace-pre-wrap text-sm">{body}</div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("editor")}>← Atrás</Button>
              <Button onClick={handleSend} disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                <Send size={14} className="mr-1.5" />
                {mode === "confirm" ? "Confirmar reserva y enviar" : "Reenviar"}
              </Button>
            </DialogFooter>
          </div>
        )}
    </>
  );
}

function StepIndicator({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={
        active
          ? "font-semibold text-foreground"
          : done
          ? "text-muted-foreground line-through"
          : "text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}
