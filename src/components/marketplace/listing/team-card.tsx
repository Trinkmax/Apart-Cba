"use client";

import { Mail } from "lucide-react";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArcBand } from "@/components/marketplace/brand/brand-shapes";
import { apartButtonVariants } from "@/components/marketplace/brand/apart-button";
import { WhatsAppIcon } from "@/components/marketplace/shell/whatsapp-icon";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { cn } from "@/lib/utils";
import { useListingStay } from "./stay-context";

/**
 * "Te recibe el equipo de apart": quién está del otro lado y un WhatsApp con
 * el mensaje ya escrito sobre ESTA unidad (y las fechas, si ya las eligió).
 */
export function TeamCard() {
  const { settings, consult } = useListingStay();
  const hours = hoursLabel(settings.responseHours);
  // Sólo se nombran los canales que existen (sin número no se promete WhatsApp).
  const channels =
    consult.whatsappUrl && consult.mailtoUrl
      ? ", por WhatsApp o por mail"
      : consult.whatsappUrl
        ? ", por WhatsApp"
        : consult.mailtoUrl
          ? ", por mail"
          : "";

  return (
    <div className="relative overflow-hidden rounded-3xl bg-forest-700 p-6 text-cream shadow-apart-md sm:p-8">
      <ArcBand className="absolute -right-10 -bottom-3 w-44 text-leaf-300/25" thickness={16} />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-t-full rounded-b-2xl bg-coral-500 shadow-apart-sm">
            <ApartLogo variant="symbol" title={null} className="h-6 text-paper" />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-extrabold leading-tight tracking-[-0.01em]">Te recibe el equipo de apart</p>
            <p className="mt-1 font-apart-serif text-[1.0625rem] italic text-leaf-300">Qué lindo tenerte por Córdoba.</p>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-cream/85">
              Respondemos en menos de {hours}
              {channels}.{channels ? " Si tenés una duda sobre este lugar, escribinos." : null}
            </p>
          </div>
        </div>
        {consult.whatsappUrl || consult.mailtoUrl ? (
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            {consult.whatsappUrl ? (
              <a
                href={consult.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(apartButtonVariants({ variant: "inverse", size: "lg" }))}
              >
                <WhatsAppIcon />
                Escribinos
              </a>
            ) : null}
            {consult.mailtoUrl ? (
              <a
                href={consult.mailtoUrl}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold text-cream underline decoration-cream/40 underline-offset-4 hover:decoration-cream focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-leaf-300/60"
              >
                <Mail className="size-4" aria-hidden />
                {consult.whatsappUrl ? "o por mail" : "Escribinos por mail"}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
