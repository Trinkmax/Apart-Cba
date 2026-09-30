"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { apartButtonVariants } from "@/components/marketplace/brand/apart-button";
import { AccountMenu } from "@/components/marketplace/shell/account-menu";
import { EMPTY_SHELL_CONTACT, type ShellContact } from "@/components/marketplace/shell/contact";
import { MainNav } from "@/components/marketplace/shell/main-nav";
import { MobileMenu } from "@/components/marketplace/shell/mobile-menu";
import { useGuestIdentity } from "@/components/marketplace/shell/use-guest-identity";
import { WhatsAppIcon } from "@/components/marketplace/shell/whatsapp-icon";
import { cn } from "@/lib/utils";

/**
 * Header de la web (cliente, sticky). No recibe sesión: el layout es estático
 * y la cuenta se resuelve en el navegador (`useGuestIdentity`). El contacto sí
 * llega del server (layout → getSiteContact, sin cookies).
 *
 * Alto: h-16 / lg:h-[72px]. Las barras sticky de otras páginas se pegan debajo
 * con `top-16 lg:top-[72px]`.
 */
export function SiteHeader({ contact = EMPTY_SHELL_CONTACT }: { contact?: ShellContact }) {
  const identity = useGuestIdentity();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    // Estado inicial (p. ej. al volver atrás con la página scrolleada), fuera del render.
    const frame = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled
          ? "border-cream-300 bg-cream/90 backdrop-blur-md supports-[backdrop-filter]:bg-cream/80"
          : "border-transparent bg-cream",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:h-[72px] lg:gap-6 lg:px-8">
        <Link
          href="/"
          aria-label="apart, ir al inicio"
          className="-ml-1 shrink-0 rounded-lg p-1 outline-none transition-opacity hover:opacity-85 focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
        >
          <ApartLogo variant="lockup" className="h-7 text-forest-700 lg:h-8" title={null} />
        </Link>

        <nav aria-label="Principal" className="hidden lg:ml-4 lg:block">
          <MainNav variant="desktop" />
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          {contact.whatsappUrl ? (
            <a
              href={contact.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Escribinos por WhatsApp"
              className={cn(
                apartButtonVariants({ variant: "ghost", size: "sm" }),
                "hidden h-11 min-w-11 px-3 lg:inline-flex xl:px-4",
              )}
            >
              <WhatsAppIcon className="size-[1.2rem]" />
              <span className="hidden xl:inline">Escribinos</span>
            </a>
          ) : null}

          <Link
            href="/favoritos"
            aria-label="Favoritos"
            className={cn(apartButtonVariants({ variant: "ghost", size: "icon" }), "text-forest-700")}
          >
            <Heart className="size-[1.3rem]" aria-hidden />
          </Link>

          <div className="hidden lg:ml-1 lg:block">
            <AccountMenu identity={identity} />
          </div>

          <MobileMenu identity={identity} contact={contact} className="lg:hidden" />
        </div>
      </div>
    </header>
  );
}
