"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ArcBand, ArchShape, BrandDot } from "@/components/marketplace/brand/brand-shapes";
import { useSiteContact } from "@/components/marketplace/shell/site-contact-context";

const linkClass =
  "font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700";

export default function MarketplaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const contact = useSiteContact();

  useEffect(() => {
    // Para diagnóstico; a la persona no le mostramos el detalle técnico.
    console.error(error);
  }, [error]);

  // "Escribinos" con un link de verdad: WhatsApp si hay número, si no mail.
  const mailSubject = error.digest ? `Error en la web (${error.digest})` : "Error en la web";
  const write = contact.whatsappUrl ? (
    <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
      escribinos por WhatsApp<span className="sr-only"> (se abre WhatsApp)</span>
    </a>
  ) : contact.email ? (
    <a href={`mailto:${contact.email}?subject=${encodeURIComponent(mailSubject)}`} className={linkClass}>
      escribinos por mail
    </a>
  ) : (
    "escribinos"
  );

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div aria-hidden className="relative h-32 w-28">
          <ArchShape className="absolute inset-0 rounded-b-2xl bg-leaf-200" />
          <ArcBand className="absolute -right-6 -top-2 w-16 text-coral-500" thickness={18} />
        </div>

        <h1 className="mt-8 text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.25rem]">
          Algo no salió como esperábamos
          <BrandDot />
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-ink-700">
          Tuvimos un problema al mostrar esta página. Probá de nuevo en un momento; si sigue igual, {write} y lo
          resolvemos.
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-ink-500">
            Código de referencia: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}

        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <ApartButton variant="primary" size="lg" onClick={() => reset()} className="w-full sm:w-auto">
            <RotateCcw aria-hidden />
            Reintentar
          </ApartButton>
          <ApartButton asChild variant="secondary" size="lg" className="w-full sm:w-auto">
            <Link href="/">Volver al inicio</Link>
          </ApartButton>
        </div>
      </div>
    </section>
  );
}
