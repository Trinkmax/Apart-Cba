"use client";

import Link from "next/link";
import { PencilLine } from "lucide-react";
import {
  missingUnitFields,
  renderGuestMessage,
  type BookingMessageVariables,
} from "@/lib/email/booking-message";
import { MessageCopyActions, MissingUnitInfoNotice } from "./guest-message-parts";

/**
 * El instructivo de la org (Configuración → Comunicaciones) completado con
 * los datos de esta reserva y de su depto: link de Maps, instructivo propio
 * del depto, horarios. Sólo se monta si la org lo activó.
 */
export function GuestInstructionsCard({
  template,
  variables,
  phone,
  editHref,
  unitInfoHref,
}: {
  template: string;
  variables: BookingMessageVariables;
  phone?: string | null;
  /** Dónde se edita el instructivo (sólo para quien puede). */
  editHref?: string | null;
  /** Dónde se cargan los datos del depto (sólo para quien puede). */
  unitInfoHref?: string | null;
}) {
  const message = renderGuestMessage(template, variables);
  const missing = missingUnitFields(template, variables);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Instructivo para el huésped
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cómo llegar y los datos del depto, listo para pegar en WhatsApp.
            {editHref ? (
              <>
                {" "}
                <Link
                  href={editHref}
                  className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
                >
                  <PencilLine size={12} />
                  Editar el instructivo
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <MessageCopyActions message={message} phone={phone} />
      </div>

      <MissingUnitInfoNotice missing={missing} href={unitInfoHref} />

      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground bg-muted/40 border rounded-xl p-4">
        {message}
      </pre>
    </div>
  );
}
