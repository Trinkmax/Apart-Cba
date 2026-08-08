"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Mail, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TemplateEditor } from "./template-editor";
import type { OrgMessageTemplate } from "@/lib/types/database";

const EVENT_LABELS: Record<string, string> = {
  booking_confirmed: "Confirmación de reserva",
};
const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
};

interface Props {
  templates: OrgMessageTemplate[];
}

export function TemplatesSection({ templates }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Editá el contenido de los mensajes que se envían a los huéspedes. Los cambios aplican a partir del próximo envío.
      </p>
      <div className="rounded-md border divide-y">
        {templates.map((tpl) => {
          const isOpen = openId === tpl.id;
          const isWhatsApp = tpl.channel === "whatsapp";
          return (
            <div key={tpl.id}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : tpl.id)}
                className="w-full flex items-center justify-between gap-3 p-4 hover:bg-accent/30 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {isWhatsApp ? (
                    <MessageCircle size={14} className="text-muted-foreground" />
                  ) : (
                    <Mail size={14} className="text-muted-foreground" />
                  )}
                  <span className="font-medium text-sm">
                    {EVENT_LABELS[tpl.event_type] ?? tpl.event_type} — {CHANNEL_LABELS[tpl.channel]}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {tpl.is_default && (
                    <Badge variant="outline" className="text-xs">
                      default
                    </Badge>
                  )}
                  {isWhatsApp && (
                    <Badge variant="secondary" className="text-xs">
                      próximamente
                    </Badge>
                  )}
                </div>
              </button>
              {isOpen && (
                <div className="border-t bg-muted/20 p-4">
                  {isWhatsApp ? (
                    <p className="text-sm text-muted-foreground">
                      El canal WhatsApp se habilita en una versión futura. El template default ya está configurado para
                      cuando esté disponible.
                    </p>
                  ) : (
                    <TemplateEditor template={tpl} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
