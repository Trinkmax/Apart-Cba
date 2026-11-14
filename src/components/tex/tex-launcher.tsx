"use client";

import * as React from "react";
import { openTex, originOf } from "@/components/mobile/shell-store";
import { TexAvatar } from "./tex-avatar";

/** El botón de Tex en la barra de la compu (en el celular vive en el círculo de la barra de abajo). */
export function TexLauncher() {
  const ref = React.useRef<HTMLButtonElement>(null);
  // ⌘J / Ctrl+J abre Tex desde cualquier pantalla.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        openTex({ origin: originOf(ref.current) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => openTex({ origin: originOf(ref.current) })}
      title="Tex, tu asistente (⌘J)"
      className="group hidden h-9 items-center gap-1.5 rounded-full border border-black/[0.08] bg-[#eef6ff] pr-3 pl-1 text-[13px] font-semibold text-[#0b3d68] transition-colors hover:bg-[#dcefff] md:flex dark:border-white/10 dark:bg-[#123250] dark:text-[#cfe7ff]"
    >
      <TexAvatar mood="face" className="size-7 transition-transform group-hover:scale-110" />
      Tex
    </button>
  );
}
