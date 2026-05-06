"use client";

import { cn } from "@/lib/utils";
import type { CrmChannelProvider } from "@/lib/types/database";

interface Props {
  provider: CrmChannelProvider;
  size?: "xs" | "sm" | "md";
  showLabel?: boolean;
  className?: string;
}

export function ProviderBadge({ provider, size = "sm", showLabel = false, className }: Props) {
  const isIG = provider === "meta_instagram";
  const sizeCls = size === "xs" ? "size-4 text-[8px]" : size === "sm" ? "size-5 text-[9px]" : "size-7 text-[10px]";

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <div
        className={cn(
          "rounded-md flex items-center justify-center text-white font-bold shrink-0",
          sizeCls,
        )}
        style={{
          background: isIG
            ? "linear-gradient(135deg, #fdcc80 0%, #e1306c 50%, #833ab4 100%)"
            : "#10b981",
        }}
        title={isIG ? "Instagram DM" : "WhatsApp Business"}
      >
        {isIG ? "IG" : "WA"}
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground">
          {isIG ? "Instagram" : "WhatsApp"}
        </span>
      )}
    </div>
  );
}

export function providerColor(provider: CrmChannelProvider): string {
  return provider === "meta_instagram" ? "#e1306c" : "#10b981";
}
