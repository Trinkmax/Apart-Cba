"use client";

import { Mail, CircleCheck, CircleEllipsis, ExternalLink, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "./copy-button";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { EmailChannelView, ForwardingRequest } from "@/lib/channels/gmail-forwarding";

/** Lo que va en «De» del filtro de Gmail para reenviar sólo lo de las plataformas. */
const GMAIL_FILTER_FROM = "airbnb.com OR booking.com";

/**
 * Configuración de email por organización — se hace UNA vez. Después de la
 * verificación solo muestra el estado. Sin jerga técnica ni parsers visibles.
 *
 * Si la casilla es de Gmail hay un paso más en el medio: Gmail manda un código
 * a nuestra dirección y no reenvía nada hasta que alguien lo confirme. Ese mail
 * no lo lee ninguna persona, así que el código se muestra acá.
 */
export function EmailSettingsCard({
  emailAddress,
  view,
  lastEmailAt,
}: {
  emailAddress: string | null;
  view: EmailChannelView;
  lastEmailAt: string | null;
}) {
  if (!emailAddress) {
    return (
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Mail size={15} /> Datos del huésped por email
        </h2>
        <p className="text-xs text-muted-foreground mt-2">
          El dominio de recepción de emails no está configurado en el servidor. Contactá a soporte.
        </p>
      </Card>
    );
  }

  if (view.state === "working") {
    return (
      <Card className="p-4 sm:p-5 space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2 flex-wrap">
          <Mail size={15} /> Datos del huésped por email
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            <CircleCheck size={11} /> Funcionando
          </span>
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Los emails de Airbnb y Booking completan automáticamente el nombre y contacto del huésped.
          {lastEmailAt && <> Último email recibido {timeAgo(lastEmailAt)}.</>}
        </p>
        <div className="flex items-center gap-2">
          <code className="text-[11px] bg-muted rounded px-2 py-1 truncate max-w-[280px]">{emailAddress}</code>
          <CopyButton value={emailAddress} label="Copiar" size="sm" variant="ghost" />
        </div>
        {view.newRequest && <ForwardingRequestBox request={view.newRequest} />}
      </Card>
    );
  }

  if (view.state === "confirm") {
    return (
      <Card className="p-4 sm:p-5 space-y-3 border-amber-500/30">
        <h2 className="text-sm font-semibold flex items-center gap-2 flex-wrap">
          <Mail size={15} /> Datos del huésped por email
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            <KeyRound size={11} /> Falta confirmar en Gmail
          </span>
        </h2>
        <ForwardingRequestBox request={view.request} />
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Para reenviar sólo los mails de las plataformas, creá en Gmail un filtro con estos datos:
          </p>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
            <span className="text-[11px] text-muted-foreground">De</span>
            <div className="flex items-center gap-1 min-w-0">
              <code className="text-[11px] bg-muted rounded px-2 py-1 break-words">{GMAIL_FILTER_FROM}</code>
              <CopyButton value={GMAIL_FILTER_FROM} label="Copiar" size="sm" variant="ghost" />
            </div>
            <span className="text-[11px] text-muted-foreground">Reenviar a</span>
            <div className="flex items-center gap-1 min-w-0">
              <code className="text-[11px] bg-muted rounded px-2 py-1 truncate">{emailAddress}</code>
              <CopyButton value={emailAddress} label="Copiar" size="sm" variant="ghost" />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Si ya lo confirmaste, no hay nada más que hacer: el estado pasa solo a <b>Funcionando</b>{" "}
          con el primer email de Airbnb o Booking que llegue.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5 space-y-3 border-sky-500/30">
      <h2 className="text-sm font-semibold flex items-center gap-2 flex-wrap">
        <Mail size={15} /> Datos del huésped por email
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-400">
          <CircleEllipsis size={11} /> Paso pendiente
        </span>
      </h2>
      <p className="text-xs text-muted-foreground leading-relaxed">
        El calendario avisa <b>qué fechas</b> se vendieron, pero no quién viene. Para completar el
        huésped automáticamente, configurá <b>una sola vez</b> el reenvío de los emails de reserva:
      </p>
      <ol className="text-xs text-muted-foreground list-decimal ml-4 space-y-2 leading-relaxed">
        <li className="space-y-1.5">
          <p>
            En la casilla donde te llegan los emails de Airbnb/Booking, creá un reenvío automático a
            esta dirección:
          </p>
          <div className="flex items-center gap-2">
            <code className="text-[11px] bg-muted rounded px-2 py-1 truncate max-w-[280px]">{emailAddress}</code>
            <CopyButton value={emailAddress} label="Copiar dirección" size="sm" />
          </div>
        </li>
        <li>Si la casilla es de Gmail, te va a pedir un código de confirmación: aparece acá apenas Gmail lo mande.</li>
        <li>
          Cuando llegue el primer email de Airbnb o Booking, este estado pasa solo a <b>Funcionando</b>.
          No hay nada más que configurar acá.
        </li>
      </ol>
    </Card>
  );
}

/**
 * El pedido de Gmail: quién pidió reenviar, el código para pegar en Gmail y el
 * enlace que confirma con un clic (validado: sólo hosts de Gmail).
 */
function ForwardingRequestBox({ request }: { request: ForwardingRequest }) {
  const { code, confirmUrl } = request;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2.5">
      <p className="text-xs leading-relaxed">
        <b className="break-all">{request.requester ?? "Una cuenta de Gmail"}</b> pidió reenviar sus mails
        a esta dirección {timeAgo(request.receivedAt)}. Gmail no reenvía nada hasta que lo confirmes.
      </p>
      {code && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Código de confirmación</span>
          <code className="rounded bg-background px-2 py-1 font-mono text-sm font-semibold tracking-widest tabular-nums">
            {code}
          </code>
          <CopyButton value={code} label="Copiar código" size="sm" />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {code
          ? `Pegalo en Gmail → Configuración → Reenvío y correo POP/IMAP, donde dice «Verificar»${
              confirmUrl ? ", o confirmá directo con el botón." : "."
            }`
          : confirmUrl
            ? "Tocá el botón para aceptar el reenvío en Gmail."
            : "No tenemos el código de ese mail. En Gmail → Configuración → Reenvío y correo POP/IMAP, junto a «Verificar», pedí que vuelva a mandar el correo (si ya no figura, agregá la dirección de nuevo): el código aparece acá en un minuto."}
      </p>
      {confirmUrl && (
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <a href={confirmUrl} target="_blank" rel="noopener noreferrer">
            Confirmar en Gmail <ExternalLink size={13} />
          </a>
        </Button>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return "";
  }
}
