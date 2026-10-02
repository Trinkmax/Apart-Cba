"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ExternalLink, FileQuestion, Loader2, Maximize2, Minimize2, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fileKindOf } from "./proof-helpers";

/**
 * Visor de un comprobante (imagen o PDF) con URL firmada de 10 minutos. La URL
 * se pide recién al mostrarlo y se recuerda 9 minutos por id, así ir y volver
 * entre comprobantes no vuelve a pedirla. Imagen: ajustar / tamaño real y
 * girar (las fotos del celular llegan de costado). PDF: embebido + "Abrir".
 */

export type SignedUrlResult = { ok: true; url: string; mime?: string | null } | { ok: false; error: string };

const CACHE_MS = 9 * 60 * 1000;
const urlCache = new Map<string, { url: string; mime: string | null; seq: number }>();
let cacheSeq = 0;

/** Recuerda la URL hasta poco antes de que venza (se borra sola). */
function remember(key: string, url: string, mime: string | null) {
  const seq = ++cacheSeq;
  urlCache.set(key, { url, mime, seq });
  setTimeout(() => {
    if (urlCache.get(key)?.seq === seq) urlCache.delete(key);
  }, CACHE_MS);
}

interface ViewerState {
  key: string;
  url: string | null;
  mime: string | null;
  error: string | null;
}

function initialState(key: string): ViewerState {
  const hit = urlCache.get(key);
  return { key, url: hit?.url ?? null, mime: hit?.mime ?? null, error: null };
}

export function FileViewer({
  cacheKey,
  load,
  mime,
  className,
  minHeightClass = "min-h-[50vh]",
}: {
  /** Identifica el archivo (p. ej. "proof:<id>"); cambiarlo vuelve a cargar. */
  cacheKey: string;
  load: () => Promise<SignedUrlResult>;
  mime: string | null;
  className?: string;
  minHeightClass?: string;
}) {
  const [state, setState] = useState<ViewerState>(() => initialState(cacheKey));
  const [attempt, setAttempt] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [rotation, setRotation] = useState(0);

  // Otro archivo: estado nuevo (sin efecto en cascada).
  if (state.key !== cacheKey) {
    setState(initialState(cacheKey));
    setZoomed(false);
    setRotation(0);
  }

  const needsLoad = state.key === cacheKey && !state.url && !state.error;
  useEffect(() => {
    if (!needsLoad) return;
    let cancelled = false;
    load()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          remember(cacheKey, res.url, res.mime ?? null);
          setState({ key: cacheKey, url: res.url, mime: res.mime ?? null, error: null });
        } else {
          setState({ key: cacheKey, url: null, mime: null, error: res.error });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ key: cacheKey, url: null, mime: null, error: "No se pudo abrir el archivo." });
      });
    return () => {
      cancelled = true;
    };
    // `load` cambia en cada render del padre: la carga depende sólo del archivo y del reintento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, needsLoad, attempt]);

  const kind = fileKindOf(state.mime ?? mime);
  const box = cn("relative flex flex-col overflow-hidden rounded-xl border bg-muted/40", minHeightClass, className);

  if (state.error) {
    return (
      <div className={cn(box, "items-center justify-center gap-3 p-6 text-center")}>
        <AlertCircle className="size-8 text-rose-500" aria-hidden />
        <p className="text-sm text-muted-foreground max-w-xs">{state.error}</p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            urlCache.delete(cacheKey);
            setState({ key: cacheKey, url: null, mime: null, error: null });
            setAttempt((n) => n + 1);
          }}
        >
          <RefreshCw size={14} /> Reintentar
        </Button>
      </div>
    );
  }

  if (!state.url) {
    return (
      <div className={cn(box, "items-center justify-center gap-2 animate-pulse")} aria-busy="true">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">Abriendo el comprobante…</span>
      </div>
    );
  }

  const openLink = (
    <a
      href={state.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card/90 px-2.5 text-xs font-medium shadow-sm backdrop-blur hover:bg-accent transition-colors"
    >
      <ExternalLink size={14} /> Abrir
    </a>
  );

  if (kind === "pdf") {
    return (
      <div className={box}>
        <div className="absolute right-2 top-2 z-10">{openLink}</div>
        <iframe src={state.url} title="Comprobante en PDF" className="h-full w-full flex-1 bg-white" style={{ minHeight: "inherit" }} />
      </div>
    );
  }

  if (kind !== "image") {
    return (
      <div className={cn(box, "items-center justify-center gap-3 p-6 text-center")}>
        <FileQuestion className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground max-w-xs">
          {kind === "heic"
            ? "Es una foto HEIC (de iPhone) y este navegador no la muestra. Abrila para verla."
            : "Este archivo no se puede mostrar acá."}
        </p>
        {openLink}
      </div>
    );
  }

  return (
    <div className={box}>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-card/90 text-xs backdrop-blur"
          onClick={() => setRotation((r) => (r + 90) % 360)}
          aria-label="Girar la imagen"
        >
          <RotateCw size={14} />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-card/90 text-xs backdrop-blur"
          onClick={() => setZoomed((z) => !z)}
          aria-pressed={zoomed}
        >
          {zoomed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {zoomed ? "Ajustar" : "Ampliar"}
        </Button>
        {openLink}
      </div>
      <div className={cn("flex flex-1 p-3", zoomed ? "overflow-auto items-start justify-start" : "items-center justify-center overflow-hidden")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de un bucket privado: no pasa por el optimizador */}
        <img
          src={state.url}
          alt="Comprobante"
          onClick={() => setZoomed((z) => !z)}
          className={cn(
            "select-none transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            zoomed ? "max-w-none cursor-zoom-out" : "max-h-[70vh] max-w-full object-contain cursor-zoom-in",
          )}
          style={{ transform: `rotate(${rotation}deg)` }}
        />
      </div>
    </div>
  );
}
