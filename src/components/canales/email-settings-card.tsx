"use client";

import { Mail, CircleCheck, CircleEllipsis } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CopyButton } from "./copy-button";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

/**
 * Configuración de email por organización — se hace UNA vez. Después de la
 * verificación solo muestra el estado. Sin jerga técnica ni parsers visibles.
 */
export function EmailSettingsCard({
  emailAddress,
  verifiedAt,
  lastEmailAt,
}: {
  emailAddress: string | null;
  verifiedAt: string | null;
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

  if (verifiedAt) {
    return (
      <Card className="p-4 sm:p-5 space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
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
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5 space-y-3 border-sky-500/30">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Mail size={15} /> Datos del huésped por email
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-400">
          <CircleEllipsis size={11} /> Paso pendiente
        </span>
      </h2>
      <p className="text-xs text-muted-foreground leading-relaxed">
        El calendario avisa <b>qué fechas</b> se vendieron, pero no quién viene. Para completar el
        huésped automáticamente, configurá <b>una sola vez</b> el reenvío de los emails de reserva:
      </p>
      <ol className="text-xs text-muted-foreground list-decimal ml-4 space-y-1 leading-relaxed">
        <li>
          En la casilla donde te llegan los emails de Airbnb/Booking, creá un reenvío automático a
          esta dirección:
        </li>
      </ol>
      <div className="flex items-center gap-2">
        <code className="text-[11px] bg-muted rounded px-2 py-1 truncate max-w-[280px]">{emailAddress}</code>
        <CopyButton value={emailAddress} label="Copiar dirección" size="sm" />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        2. Cuando llegue el primer email, este estado pasa solo a <b>Funcionando</b>. No hay nada más
        que configurar acá.
      </p>
    </Card>
  );
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return "";
  }
}
