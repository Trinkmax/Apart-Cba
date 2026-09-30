"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Loader2, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnitPhoto } from "@/lib/types/database";

/**
 * Visor de fotos y videos de la ficha a pantalla completa. Se carga lazy (lo
 * importa unit-gallery con next/dynamic) y se monta en un portal.
 *
 * Lecciones que se conservan del visor anterior:
 * - Se montan sólo el slide activo ± 1 (imágenes; el <video> sólo el activo,
 *   con controles, autoplay y playsInline: si no, seguiría sonando invisible).
 * - key={p.id} por slide: sin key React reutiliza el <img> y Safari sigue
 *   mostrando el bitmap anterior al cambiar src/srcset.
 * - Spinner por foto hasta que carga; onError también la marca (si no, gira
 *   para siempre).
 * - Un arrastre que empieza sobre el <video> (barra de avance) no es swipe.
 */
export default function GalleryLightbox({
  photos,
  startIndex,
  title,
  onClose,
}: {
  photos: UnitPhoto[];
  startIndex: number;
  title: string;
  onClose: () => void;
}) {
  const count = photos.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, count - 1)));
  const [loadedIds, setLoadedIds] = useState<Set<string>>(() => new Set());
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const touchStartX = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const go = useCallback((delta: number) => setIndex((i) => (i + delta + count) % count), [count]);

  // Teclado (Esc, flechas, Tab dentro del visor), scroll-lock y foco.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>("button, video[controls]");
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [go, onClose]);

  // La miniatura activa queda a la vista al navegar.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    thumbRefs.current[index]?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" });
  }, [index]);

  if (count === 0 || typeof document === "undefined") return null;

  const current = photos[index];
  const mounted = new Set([index, (index + 1) % count, (index - 1 + count) % count]);
  const showSpinner = current.media_type === "image" && !loadedIds.has(current.id);
  const markLoaded = (id: string) =>
    setLoadedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const navButton =
    "absolute z-10 grid size-12 place-items-center rounded-full bg-cream/15 text-cream transition-colors hover:bg-cream/25 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-leaf-300/70";

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Fotos de ${title}`}
      className="fixed inset-0 z-[70] flex flex-col bg-forest-950/[0.97] font-apart text-cream motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
    >
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 px-3 sm:px-5">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="grid size-11 place-items-center rounded-full text-cream transition-colors hover:bg-cream/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-leaf-300/70"
        >
          <X className="size-6" aria-hidden />
        </button>
        <p className="min-w-0 truncate text-sm font-semibold text-cream/90">{title}</p>
        <p className="w-11 text-right text-sm tabular-nums text-cream/80" aria-live="polite">
          {index + 1}/{count}
        </p>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 md:px-16"
        onTouchStart={(e) => {
          if ((e.target as HTMLElement).closest("video")) {
            touchStartX.current = null;
            return;
          }
          touchStartX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          const startX = touchStartX.current;
          touchStartX.current = null;
          if (startX === null) return;
          const dx = e.changedTouches[0].clientX - startX;
          if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
        }}
      >
        {count > 1 ? (
          <button type="button" onClick={() => go(-1)} className={cn(navButton, "left-2 md:left-5")} aria-label="Foto anterior">
            <ChevronLeft className="size-6" aria-hidden />
          </button>
        ) : null}
        <div className="relative h-full max-h-[78dvh] w-full max-w-5xl">
          {showSpinner ? (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="size-8 animate-spin text-cream/60 motion-reduce:animate-none" aria-hidden />
            </div>
          ) : null}
          {photos.map((p, i) => {
            if (!mounted.has(i)) return null;
            const isActive = i === index;
            if (p.media_type === "video") {
              if (!isActive) return null;
              return (
                <video
                  key={p.id}
                  src={p.public_url}
                  poster={p.poster_url ?? undefined}
                  controls
                  autoPlay
                  playsInline
                  className="absolute inset-0 h-full w-full object-contain"
                />
              );
            }
            return (
              <div
                key={p.id}
                className={cn(
                  "absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none",
                  isActive ? "opacity-100" : "pointer-events-none opacity-0",
                )}
                aria-hidden={!isActive}
              >
                <Image
                  src={p.public_url}
                  alt={p.alt_text ?? `${title}, foto ${i + 1} de ${count}`}
                  fill
                  sizes="(max-width: 1024px) 100vw, 1024px"
                  className="object-contain"
                  priority={isActive}
                  loading="eager"
                  onLoad={() => markLoaded(p.id)}
                  onError={() => markLoaded(p.id)}
                />
              </div>
            );
          })}
        </div>
        {count > 1 ? (
          <button type="button" onClick={() => go(1)} className={cn(navButton, "right-2 md:right-5")} aria-label="Foto siguiente">
            <ChevronRight className="size-6" aria-hidden />
          </button>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="no-scrollbar shrink-0 overflow-x-auto px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-max gap-2">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                ref={(el) => {
                  thumbRefs.current[i] = el;
                }}
                onClick={() => setIndex(i)}
                aria-label={`Ver ${p.media_type === "video" ? "video" : "foto"} ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-forest-800 ring-2 transition sm:h-16 sm:w-24",
                  "focus-visible:outline-none focus-visible:ring-leaf-300",
                  i === index ? "ring-cream" : "opacity-60 ring-transparent hover:opacity-90",
                )}
              >
                {p.media_type === "video" ? (
                  <>
                    {p.poster_url ? <Image src={p.poster_url} alt="" fill sizes="96px" className="object-cover" /> : null}
                    <span className="absolute inset-0 grid place-items-center">
                      <Play className="size-4 text-cream drop-shadow" fill="currentColor" aria-hidden />
                    </span>
                  </>
                ) : (
                  <Image src={p.public_url} alt="" fill sizes="96px" className="object-cover" />
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
