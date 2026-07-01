"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw, TriangleAlert } from "lucide-react";

export default function MarketplaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log para diagnóstico; no exponemos el stack al usuario.
    console.error(error);
  }, [error]);

  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-24 md:py-32">
      <div className="mx-auto max-w-md text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sage-100 text-sage-700">
          <TriangleAlert size={24} strokeWidth={1.75} />
        </div>

        <h1 className="mt-6 text-2xl md:text-3xl font-bold text-neutral-900 tracking-[-0.015em]">
          Algo salió mal
        </h1>
        <p className="mt-3 text-neutral-600 leading-relaxed">
          Tuvimos un problema al cargar esta página. Ya estamos al tanto y lo
          estamos revisando. Probá de nuevo en un momento.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-neutral-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-neutral-800 transition-colors"
          >
            <RotateCcw size={15} strokeWidth={2.25} />
            Reintentar
          </button>
          <Link
            href="/"
            className="group inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:border-neutral-900 transition-colors"
          >
            Volver al inicio
            <ArrowRight
              size={14}
              strokeWidth={2.5}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
