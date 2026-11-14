"use client";

import * as React from "react";
import { X } from "lucide-react";
import { haptic } from "@/lib/ui/haptics";
import { getTexBrief, type TexBrief } from "@/lib/actions/tex";
import { TexAvatar } from "@/components/tex/tex-avatar";
import { openTex, originOf, useMoreOpen, useTexState } from "./shell-store";

/*
 * El círculo de Tex al lado de la cápsula (nov-2026): el lugar de la pestaña
 * de búsqueda de iOS 26. La cara de Tex parpadea; apretarlo lo agranda con el
 * canto tornasolado de la lupa; tocarlo abre Tex desde ahí (genie).
 *
 * Una vez por día, si Tex tiene algo para contar (`getTexBrief`, sin LLM:
 * llegadas, sucios con llegada, solicitudes), asoma una burbuja pixel arriba
 * del círculo. Tocarla abre Tex con esa pregunta; la cruz la descarta hasta
 * mañana. El resumen se pide recién si hoy todavía no se vio (no frena la carga).
 */

const PEEK_DELAY_MS = 2_400;
const PEEK_VISIBLE_MS = 10_000;

function localDay(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const peekKey = (userId: string, day: string) => `tex:peek:${userId}:${day}`;

export function TexOrb({ userId }: { userId: string }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [pressed, setPressed] = React.useState(false);
  const [brief, setBrief] = React.useState<TexBrief | null>(null);
  const [showPeek, setShowPeek] = React.useState(false);
  const texOpen = useTexState().open;
  const moreOpen = useMoreOpen();

  React.useEffect(() => {
    let seen = false;
    const checkedKey = `${peekKey(userId, localDay())}:checked`;
    try {
      // Ya se vio hoy, o ya se consultó en esta sesión (día tranquilo): no se vuelve a pedir.
      seen =
        window.localStorage.getItem(peekKey(userId, localDay())) === "1" ||
        window.sessionStorage.getItem(checkedKey) === "1";
    } catch {
      /* sin storage: se muestra igual */
    }
    if (seen) return;
    let alive = true;
    let hide = 0;
    const show = window.setTimeout(async () => {
      const b = await getTexBrief().catch(() => null);
      try {
        window.sessionStorage.setItem(checkedKey, "1");
      } catch {
        /* best-effort */
      }
      if (!alive || !b || b.tone === "calm") return;
      setBrief(b);
      setShowPeek(true);
      hide = window.setTimeout(() => setShowPeek(false), PEEK_VISIBLE_MS);
    }, PEEK_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [userId]);

  const markSeen = React.useCallback(() => {
    setShowPeek(false);
    setBrief(null);
    try {
      window.localStorage.setItem(peekKey(userId, localDay()), "1");
    } catch {
      /* best-effort */
    }
  }, [userId]);

  const open = (prompt?: string) => {
    haptic("impact");
    markSeen();
    openTex({ origin: originOf(ref.current), prompt: prompt ?? null });
  };

  return (
    <div className="relative flex-none">
      {showPeek && brief && !texOpen && !moreOpen ? (
        <div className="lg-bar-above absolute right-0 bottom-[calc(100%+16px)] w-[min(80vw,290px)]">
          <div className="pixel-bubble tex-pop-in text-[13.5px]" data-tail="bottom-right" role="status">
            <button type="button" onClick={() => open(brief.prompt)} className="block w-full pr-5 text-left">
              <span className="block font-semibold">{brief.headline}</span>
              {brief.lines.map((l) => (
                <span key={l} className="mt-0.5 block">
                  {l}
                </span>
              ))}
              <span className="mt-1.5 block text-[12px] font-bold tracking-wide text-[var(--tex-bubble-border)] uppercase">
                Tocá y te armo el plan ›
              </span>
            </button>
            <button
              type="button"
              onClick={markSeen}
              aria-label="Cerrar"
              className="absolute top-1 right-1 grid size-7 place-items-center text-[var(--tex-bubble-ink)] opacity-60"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}
      <button
        ref={ref}
        type="button"
        aria-label="Hablar con Tex, tu asistente"
        aria-haspopup="dialog"
        data-pressed={pressed ? "" : undefined}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onClick={() => open()}
        className="lg-surface lg-orb grid place-items-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TexAvatar mood={texOpen ? "talking" : "face"} className="size-[46px]" />
        {brief && !texOpen ? (
          <span
            aria-hidden
            className="absolute top-2 right-2 size-2.5 rounded-full bg-[#ed7059] ring-2 ring-white dark:ring-[#1c211e]"
          />
        ) : null}
      </button>
    </div>
  );
}
