import Link from "next/link";
import { Mail } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArchShape } from "@/components/marketplace/brand/brand-shapes";
import { WhatsAppIcon } from "@/components/marketplace/shell/whatsapp-icon";
import { whatsappLink } from "@/lib/marketplace/display";
import { getSiteContact } from "@/lib/marketplace/web-settings-server";

/**
 * Link de seguimiento inválido o incompleto (suele cortarse al copiarlo de un
 * mail). No decimos si la reserva existe: sólo cómo recuperarla. La mayoría
 * pide SIN cuenta (y los pedidos nunca se vinculan por email), así que la
 * salida principal es escribirnos, no iniciar sesión.
 */
export default async function ReservaNotFound() {
  const contact = await getSiteContact();
  const whatsappUrl = whatsappLink(contact.whatsappNumber, "Hola, no encuentro el link de mi reserva.");
  const email = contact.publicEmail;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div aria-hidden className="relative flex h-36 w-32 items-end justify-center">
          <ArchShape className="absolute inset-0 rounded-b-2xl bg-leaf-200" />
          <ApartLogo variant="symbol" title={null} className="relative mb-7 h-16 text-forest-700" />
        </div>
        <h1 className="mt-8 text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.25rem]">
          No encontramos esta reserva.
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-ink-700 text-pretty">
          Puede que el link se haya cortado al copiarlo. Abrilo de nuevo desde el mail que te mandamos cuando hiciste
          el pedido.
        </p>
        <p className="mt-3 font-apart-serif text-lg italic text-forest-600">
          Si no lo encontrás, escribinos y la buscamos juntos.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          {whatsappUrl ? (
            <ApartButton asChild variant="primary" size="lg" className="w-full sm:w-auto">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <WhatsAppIcon />
                Escribinos por WhatsApp
                <span className="sr-only"> (se abre WhatsApp)</span>
              </a>
            </ApartButton>
          ) : email ? (
            <ApartButton asChild variant="primary" size="lg" className="w-full sm:w-auto">
              <a href={`mailto:${email}?subject=${encodeURIComponent("No encuentro mi reserva")}`}>
                <Mail aria-hidden />
                Escribinos por mail
              </a>
            </ApartButton>
          ) : null}
          <ApartButton asChild variant="secondary" size="lg" className="w-full sm:w-auto">
            <Link href="/">Ir al inicio</Link>
          </ApartButton>
        </div>
        <p className="mt-6 text-sm text-ink-700">
          ¿Tenés cuenta?{" "}
          <Link
            href="/mi-cuenta"
            className="font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700"
          >
            Ver mis reservas
          </Link>
        </p>
      </div>
    </section>
  );
}
