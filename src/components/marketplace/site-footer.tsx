import Link from "next/link";
import { Instagram, Mail } from "lucide-react";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArcBand } from "@/components/marketplace/brand/brand-shapes";
import { EMPTY_SHELL_CONTACT, hasAnyContact, type ShellContact } from "@/components/marketplace/shell/contact";
import { BRAND_INVITE } from "@/components/marketplace/shell/nav";
import { WhatsAppIcon } from "@/components/marketplace/shell/whatsapp-icon";
import { hoursLabel } from "@/lib/marketplace/web-settings";

export interface FooterHood {
  name: string;
  slug: string;
  count: number;
}

type FooterLink = { href: string; label: string };

const linkClass =
  "inline-flex min-h-11 items-center rounded-md text-[0.9375rem] text-cream/80 outline-none transition-colors hover:text-cream hover:underline hover:decoration-coral-400 hover:decoration-2 hover:underline-offset-[6px] focus-visible:ring-[3px] focus-visible:ring-leaf-300/60 lg:min-h-9";

// Pastilla de contacto (sólo en celular: la columna es angosta y el mail
// completo se partía en dos renglones). Ícono + nombre del canal ("Mail"), para
// que se entienda aunque haya uno solo; el dato completo va en aria-label.
const iconLinkClass =
  "inline-flex h-11 items-center gap-2 rounded-full bg-cream/10 pl-3.5 pr-4 text-[0.9375rem] font-semibold text-cream ring-1 ring-cream/20 outline-none transition-colors hover:bg-cream/15 focus-visible:ring-[3px] focus-visible:ring-leaf-300/60 [&_svg]:size-[1.125rem] [&_svg]:text-leaf-300";

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h2 className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-leaf-300">{title}</h2>
      <ul className="mt-3 space-y-0.5 max-lg:mt-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={linkClass}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContactColumn({ contact }: { contact: ShellContact }) {
  return (
    <div>
      <h2 className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-leaf-300">Hablemos</h2>
      {hasAnyContact(contact) ? (
        <ul className="mt-3 flex flex-wrap gap-2 sm:hidden">
          {contact.whatsappUrl ? (
            <li>
              <a
                href={contact.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp ${contact.whatsappLabel ?? ""}`.trim()}
                className={iconLinkClass}
              >
                <WhatsAppIcon />
                WhatsApp
              </a>
            </li>
          ) : null}
          {contact.emailUrl ? (
            <li>
              <a href={contact.emailUrl} aria-label={`Mail ${contact.email ?? ""}`.trim()} className={iconLinkClass}>
                <Mail aria-hidden />
                Mail
              </a>
            </li>
          ) : null}
          {contact.instagramUrl ? (
            <li>
              <a
                href={contact.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Instagram @${contact.instagramHandle}`}
                className={iconLinkClass}
              >
                <Instagram aria-hidden />
                Instagram
              </a>
            </li>
          ) : null}
        </ul>
      ) : null}
      {hasAnyContact(contact) ? (
        <ul className="mt-3 space-y-0.5 max-sm:hidden">
          {contact.whatsappUrl ? (
            <li>
              <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer" className={`${linkClass} gap-2.5`}>
                <WhatsAppIcon className="size-4 text-leaf-300" />
                <span className="tabular-nums">{contact.whatsappLabel ?? "WhatsApp"}</span>
              </a>
            </li>
          ) : null}
          {contact.emailUrl ? (
            <li>
              <a href={contact.emailUrl} className={`${linkClass} gap-2.5 break-all`}>
                <Mail className="size-4 shrink-0 text-leaf-300" aria-hidden />
                {contact.email}
              </a>
            </li>
          ) : null}
          {contact.instagramUrl ? (
            <li>
              <a href={contact.instagramUrl} target="_blank" rel="noopener noreferrer" className={`${linkClass} gap-2.5`}>
                <Instagram className="size-4 text-leaf-300" aria-hidden />@{contact.instagramHandle}
              </a>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-cream/80">
          Escribinos desde tu reserva: cada pedido tiene su link con nuestro contacto.
        </p>
      )}
      {/* cream/80 sobre forest-700: 5,6:1 (cream/60 daba 3,9:1). */}
      <p className="mt-3 text-sm text-cream/80">Respondemos en menos de {hoursLabel(contact.responseHours)}.</p>
    </div>
  );
}

/**
 * Footer de la web (server). Recibe el contacto y los barrios del layout, que
 * los lee sin cookies: la web sigue siendo estática.
 */
export function SiteFooter({
  contact = EMPTY_SHELL_CONTACT,
  hoods = [],
}: {
  contact?: ShellContact;
  hoods?: FooterHood[];
}) {
  const explore: FooterLink[] = [
    { href: "/buscar", label: "Alojamientos" },
    { href: "/buscar?modo=mes", label: "Por mes" },
    ...hoods
      .filter((h) => h.count > 0 && h.slug)
      .slice(0, 4)
      .map((h) => ({ href: `/buscar?barrio=${encodeURIComponent(h.slug)}`, label: h.name })),
  ];
  const year = new Date().getFullYear();

  return (
    // max-lg:overflow-clip: recorta igual que hidden pero no es "scroller", así la
    // cita puede animarse con view() en celular. Escritorio: overflow-hidden de siempre.
    <footer className="relative mt-20 overflow-hidden rounded-t-[2.5rem] bg-forest-700 text-cream max-lg:mt-12 max-lg:overflow-clip max-sm:rounded-t-[2rem]">
      <ArcBand
        className="absolute -right-20 -top-6 w-80 text-leaf-300/20 max-sm:-right-16 max-sm:w-56 sm:-right-10 sm:w-[26rem]"
        thickness={12}
      />
      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-20 max-lg:pb-[calc(2rem+env(safe-area-inset-bottom))] max-lg:pt-10">
        <figure className="m-rise max-w-3xl">
          <blockquote className="font-apart-serif text-[2rem] italic leading-[1.1] text-cream max-sm:text-[1.625rem] sm:text-[2.75rem] sm:max-lg:text-[2.25rem] lg:text-[3.25rem]">
            <span aria-hidden className="text-leaf-300">
              “
            </span>
            {BRAND_INVITE}
            <span aria-hidden className="text-leaf-300">
              ”
            </span>
          </blockquote>
        </figure>

        {/* Celular: logo y frase en una fila; los links en dos columnas. */}
        <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))] lg:gap-8 max-lg:mt-8 max-lg:grid-cols-2 max-lg:gap-x-5 max-lg:gap-y-8 sm:max-lg:gap-x-8">
          <div className="max-lg:col-span-2 max-lg:flex max-lg:items-center max-lg:gap-4">
            <ApartLogo variant="stacked" className="h-16 text-cream max-lg:h-12" />
            <p className="mt-4 max-w-[16rem] text-[0.9375rem] leading-relaxed text-cream/80 max-lg:mt-0">
              Alquileres temporarios. Tu estadía en Córdoba.
            </p>
          </div>
          <FooterColumn title="Explorá" links={explore} />
          <FooterColumn
            title="Reservar"
            links={[
              { href: "/como-reservar", label: "Cómo reservar" },
              { href: "/como-reservar#pagos", label: "Seña y pagos" },
              { href: "/como-reservar#cancelaciones", label: "Cancelaciones" },
              { href: "/mi-cuenta", label: "Mis reservas" },
            ]}
          />
          <FooterColumn
            title="apart"
            links={[
              { href: "/propietarios", label: "Propietarios" },
              { href: "/legal/terminos", label: "Términos" },
              { href: "/legal/privacidad", label: "Privacidad" },
            ]}
          />
          <ContactColumn contact={contact} />
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-cream/15 pt-6 text-sm text-cream/80 max-lg:mt-10 max-lg:pt-4 max-sm:gap-0 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} apart · Córdoba, Argentina</p>
          <Link
            href="/legal/eliminacion-de-datos"
            className="w-fit underline-offset-4 hover:text-cream hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
          >
            Eliminación de datos
          </Link>
        </div>
      </div>
    </footer>
  );
}
