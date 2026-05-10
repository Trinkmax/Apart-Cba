"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Check, CheckCheck, Clock, AlertCircle, Image as ImageIcon, Mic, FileText, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CrmMessage } from "@/lib/types/database";

interface Props {
  message: CrmMessage;
}

export function MessageBubble({ message }: Props) {
  const isOut = message.direction === "out";
  const time = format(new Date(message.created_at), "HH:mm", { locale: es });

  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[68%] rounded-lg px-3 py-2 text-sm shadow-sm",
          isOut
            ? "bg-emerald-500 text-white rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        {/* AI / workflow tag */}
        {isOut && message.sender_kind && message.sender_kind !== "human" && (
          <div className="text-[10px] uppercase tracking-wider opacity-75 mb-1">
            {message.sender_kind === "ai" ? "IA" : message.sender_kind === "workflow" ? "Workflow" : message.sender_kind}
          </div>
        )}

        {renderBody(message)}

        <div className={cn(
          "flex items-center justify-end gap-1 mt-1 text-[10px]",
          isOut ? "text-white/70" : "text-muted-foreground",
        )}>
          <span>{time}</span>
          {isOut && <StatusTick status={message.status} />}
        </div>
      </div>
    </div>
  );
}

function renderBody(m: CrmMessage) {
  switch (m.type) {
    case "text":
      return <p className="whitespace-pre-wrap break-words">{m.body}</p>;

    case "image":
      return (
        <div className="space-y-1">
          {m.media_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.media_url}
              alt={m.body ?? ""}
              loading="lazy"
              decoding="async"
              className="rounded max-h-60"
            />
          ) : (
            <div className="flex items-center gap-2 text-xs opacity-70"><ImageIcon className="size-3" /> Imagen</div>
          )}
          {m.body && <p className="text-xs">{m.body}</p>}
        </div>
      );

    case "audio":
      return (
        <div className="space-y-1.5 min-w-[220px]">
          <div className="flex items-center gap-2">
            <Mic className="size-4 opacity-60" />
            {m.media_url ? (
              <audio controls src={m.media_url} className="h-7 flex-1" />
            ) : (
              <span className="text-xs opacity-70">Audio</span>
            )}
          </div>
          {m.transcription_text && (
            <p className="text-[11px] italic opacity-80 border-l-2 border-current/30 pl-2">
              {m.transcription_text}
            </p>
          )}
        </div>
      );

    case "video":
      return m.media_url ? (
        <video controls src={m.media_url} className="rounded max-h-60" />
      ) : (
        <span className="text-xs opacity-70">Video</span>
      );

    case "document":
      return (
        <a href={m.media_url ?? "#"} target="_blank" rel="noopener" className="inline-flex items-center gap-2 underline">
          <FileText className="size-4" /> {m.media_filename ?? "Documento"}
        </a>
      );

    case "location": {
      const p = m.payload as { latitude?: number; longitude?: number; name?: string } | null;
      return (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5"><MapPin className="size-4" /> {p?.name ?? "Ubicación"}</div>
          {p?.latitude != null && (
            <a className="text-xs underline" href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`} target="_blank" rel="noopener">
              Abrir en mapas
            </a>
          )}
        </div>
      );
    }

    case "interactive_buttons":
    case "interactive_list":
      return (
        <div>
          <p className="whitespace-pre-wrap">{m.body}</p>
          <div className="text-[10px] opacity-60 mt-1">[Mensaje interactivo]</div>
        </div>
      );

    case "template":
      return (
        <div>
          <p className="whitespace-pre-wrap">{m.body ?? `[Template: ${m.template_name}]`}</p>
        </div>
      );

    default:
      return <p className="text-xs opacity-70">[{m.type}]</p>;
  }
}

function StatusTick({ status }: { status: CrmMessage["status"] }) {
  switch (status) {
    case "queued":
    case "sending":
      return <Clock className="size-3" />;
    case "sent":
      return <Check className="size-3" />;
    case "delivered":
      return <CheckCheck className="size-3" />;
    case "read":
      return <CheckCheck className="size-3 text-blue-300" />;
    case "failed":
      return <AlertCircle className="size-3 text-red-300" />;
    default:
      return null;
  }
}
