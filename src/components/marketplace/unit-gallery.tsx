"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X, Grid3x3, Play, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnitPhoto } from "@/lib/types/database";

type Props = {
  photos: UnitPhoto[];
  title: string;
};

/** Formatea milisegundos a m:ss (ej. 75000 → "1:15"). */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function UnitGallery({ photos, title }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (photos.length === 0) {
    return (
      <div className="aspect-[16/9] bg-neutral-100 rounded-2xl grid place-items-center text-neutral-400">
        Sin fotos
      </div>
    );
  }

  // En la práctica photos[0] es la portada (imagen): el orden es is_cover DESC,
  // sort_order ASC y un video nunca puede ser portada (CHECK en BD). Aun así, el
  // hero se renderiza de forma defensiva por si la primera fila fuese un video.
  const hero = photos[0];
  const grid = photos.slice(1, 5);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 grid-rows-1 md:grid-rows-2 gap-2 rounded-2xl overflow-hidden h-[280px] sm:h-[360px] md:h-[480px]">
        <div
          className="relative md:col-span-2 md:row-span-2 cursor-pointer group bg-neutral-100"
          onClick={() => setLightboxIndex(0)}
        >
          {hero.media_type === "video" ? (
            <>
              {hero.poster_url ? (
                <Image
                  src={hero.poster_url}
                  alt={hero.alt_text ?? title}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover group-hover:opacity-95 transition-opacity"
                  priority
                />
              ) : (
                <div className="absolute inset-0 bg-neutral-200" />
              )}
              <div className="absolute inset-0 grid place-items-center">
                <PlayCircle size={64} strokeWidth={1.5} className="text-white/85 drop-shadow-lg" />
              </div>
            </>
          ) : (
            <Image
              src={hero.public_url}
              alt={hero.alt_text ?? title}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover group-hover:opacity-95 transition-opacity"
              priority
            />
          )}
        </div>
        {grid.map((p, i) => (
          <div
            key={p.id}
            className="hidden md:block relative cursor-pointer group bg-neutral-100"
            onClick={() => setLightboxIndex(i + 1)}
          >
            {p.media_type === "video" ? (
              <>
                {p.poster_url ? (
                  <Image
                    src={p.poster_url}
                    alt={p.alt_text ?? `${title} video ${i + 2}`}
                    fill
                    sizes="25vw"
                    className="object-cover group-hover:opacity-95 transition-opacity"
                  />
                ) : (
                  <div className="absolute inset-0 bg-neutral-200" />
                )}
                <div className="absolute inset-0 grid place-items-center">
                  <PlayCircle
                    size={48}
                    strokeWidth={1.5}
                    className="text-white/80 drop-shadow-md"
                  />
                </div>
                {p.duration_ms ? (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
                    {formatDuration(p.duration_ms)}
                  </span>
                ) : null}
              </>
            ) : (
              <Image
                src={p.public_url}
                alt={p.alt_text ?? `${title} foto ${i + 2}`}
                fill
                sizes="25vw"
                className="object-cover group-hover:opacity-95 transition-opacity"
              />
            )}
          </div>
        ))}
      </div>

      {photos.length > 5 ? (
        <button
          onClick={() => setLightboxIndex(0)}
          className="absolute right-4 bottom-4 md:right-8 md:bottom-8 inline-flex items-center gap-2 rounded-lg bg-white border border-neutral-300 text-sm font-medium px-3 py-2 shadow-md hover:bg-neutral-50 transition-colors"
        >
          <Grid3x3 size={14} />
          Ver todas ({photos.length})
        </button>
      ) : null}

      {lightboxIndex !== null ? (
        <Lightbox
          photos={photos}
          startIndex={lightboxIndex}
          title={title}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </>
  );
}

function Lightbox({
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
  const [index, setIndex] = useState(startIndex);

  function go(delta: number) {
    setIndex((i) => (i + delta + photos.length) % photos.length);
  }

  const current = photos[index];

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col">
      <div className="h-14 flex items-center justify-between px-4 text-white">
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
          <X size={22} />
        </button>
        <div className="text-sm">
          {index + 1} / {photos.length}
        </div>
        <div className="w-9" />
      </div>
      <div className="flex-1 relative flex items-center justify-center px-2 md:px-12">
        <button
          onClick={() => go(-1)}
          className="absolute left-3 md:left-6 h-12 w-12 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center text-white transition-colors z-10"
          aria-label="Anterior"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="relative w-full max-w-5xl aspect-[4/3] md:aspect-[3/2] flex items-center justify-center">
          {current.media_type === "video" ? (
            // Sólo se monta el <video> del índice activo: al cambiar de slide el
            // anterior se desmonta y la reproducción se detiene automáticamente.
            // `key` fuerza un nuevo elemento por cada video distinto.
            <video
              key={current.id}
              src={current.public_url}
              poster={current.poster_url ?? undefined}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <Image
              src={current.public_url}
              alt={current.alt_text ?? title}
              fill
              sizes="100vw"
              className="object-contain"
            />
          )}
        </div>
        <button
          onClick={() => go(1)}
          className="absolute right-3 md:right-6 h-12 w-12 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center text-white transition-colors z-10"
          aria-label="Siguiente"
        >
          <ChevronRight size={22} />
        </button>
      </div>
      <div className="px-4 pb-4 overflow-x-auto no-scrollbar">
        <div className="flex gap-2">
          {photos.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setIndex(i)}
              className={cn(
                "relative h-16 w-24 shrink-0 rounded overflow-hidden border-2 transition bg-neutral-800",
                i === index ? "border-white" : "border-transparent opacity-60"
              )}
            >
              {p.media_type === "video" ? (
                <>
                  {p.poster_url ? (
                    <Image src={p.poster_url} alt="" fill sizes="96px" className="object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-neutral-700" />
                  )}
                  <div className="absolute inset-0 grid place-items-center">
                    <Play size={18} className="text-white/90 drop-shadow" fill="currentColor" />
                  </div>
                </>
              ) : (
                <Image src={p.public_url} alt="" fill sizes="96px" className="object-cover" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
