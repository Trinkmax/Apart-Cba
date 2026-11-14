"use client";

import { openTex, originOf } from "@/components/mobile/shell-store";
import { TexAvatar } from "@/components/tex/tex-avatar";
import { cn } from "@/lib/utils";

/** Un botón que abre Tex con la pregunta ya hecha. */
export function TexAskButton({ prompt, label, className }: { prompt: string; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => openTex({ origin: originOf(e.currentTarget), prompt })}
      className={cn(
        "group inline-flex h-9 items-center gap-1.5 rounded-full border border-black/[0.08] bg-[#eef6ff] pr-3.5 pl-1 text-[13px] font-semibold text-[#0b3d68] transition-colors hover:bg-[#dcefff] dark:border-white/10 dark:bg-[#123250] dark:text-[#cfe7ff] dark:hover:bg-[#17405f]",
        className,
      )}
    >
      <TexAvatar mood="face" className="size-7 transition-transform group-hover:scale-110" />
      {label}
    </button>
  );
}
