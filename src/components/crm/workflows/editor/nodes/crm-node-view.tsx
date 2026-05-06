"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import * as Icons from "lucide-react";
import { Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { listNodes } from "@/lib/crm/workflows/registry";

const ACCENT_BORDERS: Record<string, string> = {
  green: "border-emerald-500/60 shadow-emerald-500/10",
  amber: "border-amber-500/60 shadow-amber-500/10",
  violet: "border-violet-500/60 shadow-violet-500/10",
  red: "border-red-500/60 shadow-red-500/10",
  blue: "border-blue-500/60 shadow-blue-500/10",
  zinc: "border-zinc-500/60 shadow-zinc-500/10",
};

const ACCENT_HEADERS: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-400",
  amber: "bg-amber-500/15 text-amber-400",
  violet: "bg-violet-500/15 text-violet-400",
  red: "bg-red-500/15 text-red-400",
  blue: "bg-blue-500/15 text-blue-400",
  zinc: "bg-zinc-500/15 text-zinc-400",
};

interface CrmNodeViewProps extends NodeProps {
  onAddAfter?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
}

const ALL_NODES = listNodes();

export function CrmNodeView({ id, data, selected, onAddAfter, onDelete }: CrmNodeViewProps) {
  const nodeData = data as { nodeType: string; config?: Record<string, unknown> };
  const def = ALL_NODES.find((n) => n.type === nodeData.nodeType);

  const Icon = def ? (Icons[def.icon as keyof typeof Icons] as React.ComponentType<{ size?: number; className?: string }>) ?? Icons.Square : Icons.Square;
  const accentColor = def?.accentColor ?? "zinc";
  const isTrigger = def?.isTrigger ?? false;
  const outputs = def?.outputs ?? [{ id: "next" }];

  // Preview del config (truncate)
  const preview = renderPreview(def?.type, nodeData.config ?? {});

  return (
    <div
      className={cn(
        "relative bg-zinc-950 border-l-4 border border-zinc-800 rounded-lg shadow-lg w-[260px]",
        ACCENT_BORDERS[accentColor],
        selected && "ring-2 ring-emerald-400/70",
      )}
    >
      {!isTrigger && (
        <Handle type="target" position={Position.Top} className="!bg-zinc-600 !w-2 !h-2 !border-2 !border-zinc-950" />
      )}

      {/* Header */}
      <div className={cn("flex items-center gap-2 px-2.5 py-1.5 rounded-t-lg", ACCENT_HEADERS[accentColor])}>
        <Icon size={14} />
        <span className="text-xs font-semibold flex-1">{def?.label ?? nodeData.nodeType}</span>
        {onDelete && !isTrigger && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(id); }}
            className="opacity-50 hover:opacity-100 hover:text-red-300 transition-colors"
            title="Eliminar nodo"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 text-[11px] text-zinc-400 min-h-[28px]">
        {preview || <span className="italic text-zinc-600">Sin configurar</span>}
      </div>

      {/* Outputs */}
      {outputs.length === 1 ? (
        <Handle id={outputs[0].id} type="source" position={Position.Bottom} className="!bg-zinc-600 !w-2 !h-2 !border-2 !border-zinc-950" />
      ) : (
        <div className="flex justify-around pb-1.5">
          {outputs.map((o, idx) => (
            <div key={o.id} className="flex flex-col items-center gap-0.5 relative px-2">
              <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">{o.label ?? o.id}</span>
              <Handle
                id={o.id}
                type="source"
                position={Position.Bottom}
                className="!bg-zinc-600 !w-2 !h-2 !border-2 !border-zinc-950"
                style={{ left: `${((idx + 0.5) / outputs.length) * 100}%`, bottom: 0 }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add-after FAB on the bottom edge */}
      {onAddAfter && (
        <button
          onClick={(e) => { e.stopPropagation(); onAddAfter(id); }}
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 size-6 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white opacity-0 hover:opacity-100 group-hover:opacity-100 flex items-center justify-center transition-opacity z-10"
          title="Agregar paso después"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

function renderPreview(type: string | undefined, config: Record<string, unknown>): string {
  if (!type) return "";
  switch (type) {
    case "send_message":
    case "ai_response": {
      const text = (config.text as string) ?? (config.systemPrompt as string) ?? "";
      return text ? text.slice(0, 80) + (text.length > 80 ? "…" : "") : "";
    }
    case "send_buttons": {
      const buttons = config.buttons as { title: string }[] | undefined;
      return buttons?.length ? `${buttons.length} botones: ${buttons.map((b) => b.title).join(", ")}` : "";
    }
    case "send_template": {
      return (config.templateId as string) ? "Template" : "";
    }
    case "wait_time": {
      return `${config.duration ?? "?"} ${config.unit ?? "s"} de espera`;
    }
    case "wait_for_reply": {
      return `Timeout ${config.timeoutMinutes ?? "?"}min`;
    }
    case "condition": {
      const rules = config.rules as { path: string; op: string; value?: string }[] | undefined;
      return rules?.length ? `${rules.length} regla(s)` : "";
    }
    case "add_tag":
    case "remove_tag": {
      return `Tag: ${config.tagSlug as string ?? ""}`;
    }
    case "ai_auto_tag": {
      return `IA clasifica`;
    }
    case "crm_alert": {
      return (config.title as string) ?? "Alerta";
    }
    case "http_request": {
      return `${config.method ?? "GET"} ${config.url as string ?? ""}`;
    }
    case "pms_create_ticket": {
      return (config.title as string) ?? "Ticket";
    }
    case "set_variable": {
      return `${config.name ?? "var"} = ${(config.value as string)?.slice(0, 30) ?? ""}`;
    }
    default:
      return "";
  }
}
