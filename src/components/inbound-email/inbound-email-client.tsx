"use client";

import { useState, useTransition } from "react";
import { Copy, RefreshCw, Loader2, CheckCircle2, AlertCircle, HelpCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import {
  rotateInboundToken,
  type InboundEmailConfig,
  type InboundEmailLogEntry,
} from "@/lib/actions/inbound-email";

const STATUS_STYLE: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  parsed: { label: "Parseado", icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  unmatched: { label: "No reconocido", icon: HelpCircle, className: "text-amber-600 dark:text-amber-400" },
  error: { label: "Error", icon: XCircle, className: "text-rose-600 dark:text-rose-400" },
  duplicate: { label: "Duplicado", icon: AlertCircle, className: "text-muted-foreground" },
};

interface Props {
  config: InboundEmailConfig;
  emails: InboundEmailLogEntry[];
}

export function InboundEmailClient({ config, emails }: Props) {
  const [currentConfig, setCurrentConfig] = useState(config);
  const [isPending, startTransition] = useTransition();

  function handleCopy() {
    navigator.clipboard.writeText(currentConfig.address);
    toast.success("Dirección copiada");
  }

  function handleRotate() {
    if (!confirm("¿Rotar el token? Las direcciones viejas dejarán de funcionar.")) return;
    startTransition(async () => {
      try {
        const newConfig = await rotateInboundToken();
        setCurrentConfig(newConfig);
        toast.success("Token rotado");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Address card */}
      <Card className="p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-semibold">Dirección de recepción</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="bg-muted px-3 py-1.5 rounded text-sm font-mono break-all">
            {currentConfig.address}
          </code>
          <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
            <Copy size={12} /> Copiar
          </Button>
          <Button size="sm" variant="ghost" onClick={handleRotate} disabled={isPending} className="gap-1.5 text-muted-foreground">
            {isPending ? <Loader2 className="animate-spin size-3" /> : <RefreshCw size={12} />}
            Rotar token
          </Button>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p><b>Airbnb:</b> Reenviá los emails de confirmación de reserva a esta dirección.</p>
          <p><b>Booking.com:</b> Configurá un auto-forward desde tu email de extranet a esta dirección.</p>
          <p>El sistema detecta automáticamente la OTA, extrae los datos y crea la reserva.</p>
        </div>
      </Card>

      {/* Email log */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Últimos emails recibidos</h3>
        </div>
        {emails.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No se recibieron emails todavía.
          </div>
        ) : (
          <div className="divide-y">
            {emails.map((e) => {
              const style = STATUS_STYLE[e.status] ?? STATUS_STYLE.error;
              const Icon = style.icon;
              return (
                <div key={e.id} className="px-4 py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{e.subject ?? "(sin asunto)"}</span>
                    <Badge variant="outline" className={`text-[10px] gap-1 shrink-0 ${style.className}`}>
                      <Icon size={10} />
                      {style.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span>{formatDateTime(e.received_at)}</span>
                    <span className="truncate">{e.from_address}</span>
                    {e.parser_used && (
                      <Badge variant="secondary" className="text-[10px]">{e.parser_used}</Badge>
                    )}
                    {e.event_type && (
                      <span>{e.event_type === "new_booking" ? "Nueva reserva" : "Cancelación"}</span>
                    )}
                  </div>
                  {e.error_message && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400 truncate">{e.error_message}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
