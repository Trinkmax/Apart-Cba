"use client";

import { cn } from "@/lib/utils";
import { WhatsAppIcon, InstagramIcon } from "./channel-icons";

interface Props {
  type: "whatsapp" | "instagram";
  connected: boolean;
  onClick?: () => void;
}

export function ChannelStatusPill({ type, connected, onClick }: Props) {
  const Icon = type === "whatsapp" ? WhatsAppIcon : InstagramIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-1 text-[11px] font-medium transition-all",
        "border",
        connected
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15"
          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
      )}
      title={
        connected
          ? `${type === "whatsapp" ? "WhatsApp" : "Instagram"} conectado`
          : `Conectar ${type === "whatsapp" ? "WhatsApp" : "Instagram"}`
      }
    >
      <span
        className={cn(
          "size-4 rounded-full grid place-items-center",
          connected ? "" : "opacity-60"
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span>{type === "whatsapp" ? "WhatsApp" : "Instagram"}</span>
      <span
        className={cn(
          "size-1.5 rounded-full",
          connected ? "bg-emerald-500 animate-pulse-dot" : "bg-muted-foreground/40"
        )}
      />
    </button>
  );
}
