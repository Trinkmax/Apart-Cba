"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TemplateEditor } from "./template-editor";
import {
  GUEST_MESSAGE_META,
  type GuestMessageEvent,
} from "@/lib/email/templates/guest-defaults";
import type { BookingMessageVariables } from "@/lib/email/booking-message";

interface Props {
  templates: { event_type: GuestMessageEvent; body: string; custom: boolean }[];
  previewVars: BookingMessageVariables;
  previewLabel: string;
  /** El que llega abierto (link "Editar el mensaje" desde una reserva). */
  initialOpen?: GuestMessageEvent | null;
}

function statusBadge(event: GuestMessageEvent, custom: boolean) {
  if (event === "booking_instructions") {
    return custom ? (
      <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600 text-white">Activo</Badge>
    ) : (
      <Badge variant="outline" className="text-xs">Sin activar</Badge>
    );
  }
  return custom ? (
    <Badge variant="secondary" className="text-xs">Editado</Badge>
  ) : (
    <Badge variant="outline" className="text-xs">Mensaje original</Badge>
  );
}

export function TemplatesSection({ templates, previewVars, previewLabel, initialOpen = null }: Props) {
  const [openEvent, setOpenEvent] = useState<GuestMessageEvent | null>(initialOpen);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Los mensajes que copiás desde cada reserva para mandarle al huésped por WhatsApp. Se completan solos con los
        datos de la reserva.
      </p>
      <div className="rounded-md border divide-y">
        {templates.map((tpl) => {
          const isOpen = openEvent === tpl.event_type;
          const meta = GUEST_MESSAGE_META[tpl.event_type];
          return (
            <div key={tpl.event_type}>
              <button
                type="button"
                onClick={() => setOpenEvent(isOpen ? null : tpl.event_type)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between gap-3 p-4 hover:bg-accent/30 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <MessageCircle size={14} className="text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm">{meta.title}</span>
                </div>
                {statusBadge(tpl.event_type, tpl.custom)}
              </button>
              {isOpen && (
                <div className="border-t bg-muted/20 p-4 space-y-3">
                  <p className="text-sm text-muted-foreground">{meta.description}</p>
                  <TemplateEditor
                    eventType={tpl.event_type}
                    initialBody={tpl.body}
                    custom={tpl.custom}
                    previewVars={previewVars}
                    previewLabel={previewLabel}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
