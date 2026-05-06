"use client";

import { cn } from "@/lib/utils";
import type { CrmTag } from "@/lib/types/database";

interface TagChipProps {
  tag: Pick<CrmTag, "name" | "color">;
  size?: "xs" | "sm" | "md";
  onRemove?: () => void;
  selected?: boolean;
  onClick?: () => void;
}

export function TagChip({ tag, size = "sm", onRemove, selected, onClick }: TagChipProps) {
  const sizeClass =
    size === "xs"
      ? "px-1.5 py-0.5 text-[10px] gap-1"
      : size === "sm"
      ? "px-2 py-0.5 text-xs gap-1.5"
      : "px-2.5 py-1 text-sm gap-2";

  return (
    <span
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full font-medium transition-all border",
        sizeClass,
        onClick && "cursor-pointer hover:scale-105",
        selected && "ring-2 ring-offset-1 ring-offset-background",
      )}
      style={{
        backgroundColor: `${tag.color}1f`,
        color: tag.color,
        borderColor: `${tag.color}40`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="opacity-60 hover:opacity-100 ml-0.5"
        >
          ×
        </button>
      )}
    </span>
  );
}
