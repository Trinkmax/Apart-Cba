"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCheck, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfPreviewButton } from "./pdf-preview-button";
import { SendDialog } from "./send-dialog";
import {
  markParteDiarioBorrador,
  markParteDiarioRevisado,
} from "@/lib/actions/parte-diario";
import type {
  DailyReport,
  ParteDiarioRecipient,
  ParteDiarioSettings,
  ParteDiarioSnapshot,
} from "@/lib/types/database";

interface ActionBarProps {
  date: string;
  snapshot: ParteDiarioSnapshot;
  report: DailyReport | null;
  settings: ParteDiarioSettings;
  recipients: ParteDiarioRecipient[];
  canEdit: boolean;
}

export function ActionBar({
  date,
  snapshot,
  report,
  settings,
  recipients,
  canEdit,
}: ActionBarProps) {
  const [pending, startTransition] = useTransition();
  const status = report?.status ?? "borrador";

  const toggleRevisado = () => {
    startTransition(async () => {
      try {
        if (status === "borrador") {
          await markParteDiarioRevisado(date);
          toast.success("Marcado como revisado");
        } else {
          await markParteDiarioBorrador(date);
          toast.message("Vuelto a borrador");
        }
      } catch (err) {
        toast.error("No se pudo cambiar el estado", { description: (err as Error).message });
      }
    });
  };

  return (
    <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 mt-6 border-t bg-background/90 backdrop-blur-xl">
      <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {report?.sent_at ? (
            <>
              Enviado <span className="font-medium text-foreground">{formatTimestamp(report.sent_at)}</span>
              {report.wa_message_ids?.length
                ? ` · ${report.wa_message_ids.length} ${report.wa_message_ids.length === 1 ? "mensaje" : "mensajes"}`
                : ""}
            </>
          ) : report?.reviewed_at ? (
            <>Revisado {formatTimestamp(report.reviewed_at)}</>
          ) : report?.generated_at ? (
            <>Borrador desde {formatTimestamp(report.generated_at)}</>
          ) : (
            <>Sin generar</>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PdfPreviewButton snapshot={snapshot} />
          {canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={toggleRevisado}
              disabled={pending}
              className="gap-1.5"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : status === "borrador" ? (
                <CheckCheck className="size-3.5" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              {status === "borrador" ? "Marcar revisado" : "Volver a borrador"}
            </Button>
          ) : null}
          {canEdit ? (
            <SendDialog
              date={date}
              recipients={recipients}
              channelConfigured={!!settings.channel_id}
              templateName={settings.template_name}
              alreadySent={status === "enviado"}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
