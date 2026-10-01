"use client";

import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import type { ShellContact } from "./contact";
import { WhatsAppIcon } from "./whatsapp-icon";
import {
  clearWhatsAppTopicUrl,
  getWhatsAppTopicUrl,
  setWhatsAppTopicUrl,
  subscribeWhatsAppTopic,
} from "./whatsapp-float-store";

/**
 * Botón flotante de WhatsApp de la web (sólo si el sitio tiene número).
 *
 * - Celular: el globo verde abajo a la derecha. Si hay una barra fija abajo
 *   (reservar en la ficha, confirmar en el checkout) sube por encima de ella:
 *   esas barras se marcan con `data-wa-lift` mientras se ven.
 * - Escritorio: una píldora de papel con el globo verde y "Escribinos por
 *   WhatsApp". El texto va en verde oscuro sobre papel: blanco sobre el verde
 *   de WhatsApp no llega al contraste mínimo.
 *
 * El mensaje precargado es el saludo del sitio o, si la página publicó el
 * suyo (`WhatsAppFloatTopic`), el de la página.
 */
export function WhatsAppFloat({ contact }: { contact: ShellContact }) {
  const topicUrl = useSyncExternalStore(subscribeWhatsAppTopic, getWhatsAppTopicUrl, () => null);
  if (!contact.whatsappUrl) return null;
  const href = topicUrl ?? contact.whatsappUrl;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escribinos por WhatsApp"
      className={cn(
        "group fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex items-center rounded-full font-apart outline-none print:hidden",
        "shadow-[0_14px_30px_-12px_rgb(6_32_27/0.55),0_4px_10px_-4px_rgb(6_32_27/0.25)]",
        "transition-[bottom,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:hover:-translate-y-0.5",
        "focus-visible:ring-[3px] focus-visible:ring-forest-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-500",
        // Celular, con una barra fija abajo: el globo sube por encima de ella.
        "max-lg:[html:has([data-wa-lift])_&]:bottom-[calc(6.25rem+env(safe-area-inset-bottom))]",
        // Escritorio: píldora de papel.
        "lg:right-6 lg:bottom-6 lg:gap-3 lg:bg-paper lg:py-1.5 lg:pr-5 lg:pl-1.5 lg:ring-1 lg:ring-forest-900/10 lg:hover:shadow-apart-lg",
      )}
    >
      <span className="grid size-14 place-items-center rounded-full bg-[#25D366] text-white transition-colors duration-200 group-hover:bg-[#1fbd59] lg:size-11">
        <WhatsAppIcon className="size-7 lg:size-6" />
      </span>
      <span className="hidden text-left leading-tight lg:block">
        <span className="block text-[0.9375rem] font-bold text-forest-700">Escribinos</span>
        <span className="block text-[0.75rem] font-medium text-ink-500">por WhatsApp</span>
      </span>
    </a>
  );
}

/**
 * La página le pasa al botón flotante su link de WhatsApp con contexto
 * mientras está montada (null = el saludo general del sitio).
 */
export function WhatsAppFloatTopic({ url }: { url: string | null }) {
  useEffect(() => {
    setWhatsAppTopicUrl(url);
    return () => clearWhatsAppTopicUrl(url);
  }, [url]);
  return null;
}
