"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, Heart, Instagram, LayoutDashboard, LogOut, Mail, Menu, UserRound, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArcBand } from "@/components/marketplace/brand/brand-shapes";
import { cn } from "@/lib/utils";
import { GuestAvatar, signInHref, useGuestSignOut } from "./account-menu";
import type { ShellContact } from "./contact";
import { MainNav } from "./main-nav";
import { BRAND_INVITE } from "./nav";
import type { GuestIdentity } from "./use-guest-identity";
import { WhatsAppIcon } from "./whatsapp-icon";

const rowClass =
  "flex min-h-12 items-center gap-3 rounded-2xl px-2 text-[1.0625rem] font-semibold text-ink-800 outline-none transition-colors hover:bg-forest-700/[0.05] focus-visible:ring-[3px] focus-visible:ring-forest-500/40 [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-forest-600";

function AccountSection({ identity, onNavigate }: { identity: GuestIdentity; onNavigate: () => void }) {
  const pathname = usePathname();
  const { signOut, pending } = useGuestSignOut();

  if (identity.status === "loading") {
    return <div aria-hidden className="h-12 rounded-2xl bg-cream-200" />;
  }
  if (identity.status === "anonymous") {
    return (
      <div className="space-y-3">
        <ApartButton asChild variant="primary" size="lg" className="w-full">
          <Link href={signInHref(pathname)} onClick={onNavigate}>
            Ingresar
          </Link>
        </ApartButton>
        <p className="text-center text-sm text-ink-500">
          ¿Querés reservar? No hace falta cuenta.
        </p>
      </div>
    );
  }
  if (identity.status === "staff") {
    return (
      <ApartButton asChild variant="secondary" size="lg" className="w-full">
        <Link href="/dashboard" onClick={onNavigate}>
          <LayoutDashboard aria-hidden />
          Ir al panel
        </Link>
      </ApartButton>
    );
  }
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 px-2">
        <GuestAvatar identity={identity} className="size-11 text-sm" />
        <div className="min-w-0">
          <p className="text-xs text-ink-500">Hola,</p>
          <p className="truncate font-bold text-forest-700">{identity.name}</p>
        </div>
      </div>
      <ul>
        <li>
          <Link href="/mi-cuenta" onClick={onNavigate} className={rowClass}>
            <CalendarCheck aria-hidden />
            Mis reservas
            {identity.hasActiveReservations ? (
              <span className="ml-auto rounded-full bg-coral-100 px-2.5 py-0.5 text-xs font-bold text-coral-800">
                En curso
              </span>
            ) : null}
          </Link>
        </li>
        <li>
          <Link href="/favoritos" onClick={onNavigate} className={rowClass}>
            <Heart aria-hidden />
            Favoritos
          </Link>
        </li>
        <li>
          <Link href="/mi-cuenta/perfil" onClick={onNavigate} className={rowClass}>
            <UserRound aria-hidden />
            Mis datos
          </Link>
        </li>
        <li>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              onNavigate();
              void signOut();
            }}
            className={cn(rowClass, "w-full text-left disabled:opacity-60")}
          >
            <LogOut aria-hidden />
            Salir
          </button>
        </li>
      </ul>
    </div>
  );
}

function ContactSection({ contact }: { contact: ShellContact }) {
  const items = [
    contact.whatsappUrl
      ? { href: contact.whatsappUrl, label: contact.whatsappLabel ?? "WhatsApp", icon: <WhatsAppIcon />, external: true }
      : null,
    contact.emailUrl ? { href: contact.emailUrl, label: contact.email ?? "Mail", icon: <Mail aria-hidden />, external: false } : null,
    contact.instagramUrl
      ? { href: contact.instagramUrl, label: `@${contact.instagramHandle}`, icon: <Instagram aria-hidden />, external: true }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 px-2 text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-forest-600">Hablemos</p>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className={cn(rowClass, "font-medium")}
              {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Menú mobile (< lg): hoja desde la derecha con la navegación grande, la
 * cuenta, el contacto y la frase de marca.
 */
export function MobileMenu({
  identity,
  contact,
  className,
}: {
  identity: GuestIdentity;
  contact: ShellContact;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const showDot = identity.status === "guest" && identity.hasActiveReservations;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={showDot ? "Abrir menú. Tenés reservas en curso" : "Abrir menú"}
          className={cn(
            "relative inline-flex size-11 items-center justify-center rounded-full text-forest-700 outline-none transition-colors hover:bg-forest-700/[0.06] focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
            className,
          )}
        >
          <Menu className="size-6" aria-hidden />
          {showDot ? (
            <span aria-hidden className="absolute right-2 top-2 size-2.5 rounded-full bg-coral-500 ring-2 ring-cream" />
          ) : null}
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto border-l-cream-300 bg-cream p-0 font-apart sm:max-w-sm"
      >
        <SheetTitle className="sr-only">Menú</SheetTitle>
        <SheetDescription className="sr-only">Navegación, tu cuenta y contacto de apart.</SheetDescription>

        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <Link href="/" onClick={close} aria-label="apart, ir al inicio" className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40">
            <ApartLogo variant="lockup" className="h-7 text-forest-700" title={null} />
          </Link>
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Cerrar menú"
              className="inline-flex size-11 items-center justify-center rounded-full text-forest-700 outline-none transition-colors hover:bg-forest-700/[0.06] focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
            >
              <X className="size-6" aria-hidden />
            </button>
          </SheetClose>
        </div>

        <div className="flex flex-1 flex-col gap-7 px-4 pb-8 pt-2">
          <nav aria-label="Menú principal">
            <MainNav variant="mobile" onNavigate={close} />
          </nav>
          <div className="h-px bg-cream-300" />
          <AccountSection identity={identity} onNavigate={close} />
          <ContactSection contact={contact} />

          <div className="relative mt-auto overflow-hidden rounded-3xl bg-forest-700 px-5 pb-6 pt-7 text-cream">
            <ArcBand className="absolute -right-6 -top-3 w-28 text-leaf-300/35" thickness={16} />
            <p className="relative max-w-[14rem] font-apart-serif text-[1.375rem] italic leading-snug">
              {BRAND_INVITE}
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
