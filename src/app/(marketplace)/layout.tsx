import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/marketplace/site-header";
import { SiteFooter, type FooterHood } from "@/components/marketplace/site-footer";
import { MarketplacePrefsProvider } from "@/components/marketplace/marketplace-prefs-provider";
import {
  buildShellContact,
  EMPTY_SHELL_CONTACT,
  type ShellContact,
} from "@/components/marketplace/shell/contact";
import { SiteContactProvider } from "@/components/marketplace/shell/site-contact-context";
import { getAppUrl } from "@/lib/app-url";
import { getStorefrontCatalog } from "@/lib/marketplace/storefront";
import { getSiteContact } from "@/lib/marketplace/web-settings-server";
import { cn } from "@/lib/utils";
import { manrope, sourceSerif } from "./fonts";

const SITE_DESCRIPTION =
  "Departamentos en Córdoba por noches o por meses. Pedí tu reserva sin pagar nada: te confirmamos, señás una noche por transferencia y el resto lo pagás al llegar.";

// Base absoluta para canonical/OG/twitter y cualquier URL relativa de metadata.
export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: {
    default: "apart — Tu lugar en Córdoba, por el tiempo que necesites",
    template: "%s · apart",
  },
  description: SITE_DESCRIPTION,
  applicationName: "apart",
  manifest: "/apart/site.webmanifest",
  icons: {
    icon: [
      { url: "/apart/icons/apart-16.png", sizes: "16x16", type: "image/png" },
      { url: "/apart/icons/apart-32.png", sizes: "32x32", type: "image/png" },
      { url: "/apart/icons/apart-48.png", sizes: "48x48", type: "image/png" },
      { url: "/apart/icons/apart-192.png", sizes: "192x192", type: "image/png" },
      { url: "/apart/icons/apart-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/apart/icons/apart-32.png",
    apple: [{ url: "/apart/icons/apart-apple-180.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "apart", statusBarStyle: "default" },
  // Sin title/description a propósito: Next los completa con el title y la
  // description de cada página. Si se fijan acá, todas las subpáginas
  // (/buscar, /propietarios, /como-reservar, legales) se comparten con el
  // título y la bajada de la home.
  openGraph: {
    type: "website",
    siteName: "apart",
    locale: "es_AR",
    images: [
      {
        url: "/apart/og.jpg",
        width: 1200,
        height: 630,
        alt: "apart — Alquileres temporarios en Córdoba",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/apart/og.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#F6F0E4",
  colorScheme: "light",
};

/**
 * Las variables de las fuentes se publican también en :root mientras la web
 * está montada (`:root:has([data-apart-root])`): los popovers, diálogos y
 * toasts se montan en <body>, fuera del div raíz, y si no las verían vacías.
 */
const FONT_VARS_CSS = `:root:has([data-apart-root]){--ff-manrope:${manrope.style.fontFamily};--ff-source-serif:${sourceSerif.style.fontFamily};}:root:has([data-apart-root]) body{font-family:var(--font-apart);}`;


/**
 * Datos del shell (contacto y barrios del footer). Todo sale de lecturas
 * cacheadas y SIN cookies: el layout es estático, así la home, /buscar y las
 * fichas pueden ser ISR. Si algo falla, la web se muestra igual sin esos datos.
 */
async function loadShellData(): Promise<{ contact: ShellContact; hoods: FooterHood[] }> {
  const [contactRes, catalogRes] = await Promise.allSettled([getSiteContact(), getStorefrontCatalog()]);
  if (contactRes.status === "rejected") console.error("[marketplace/layout] getSiteContact", contactRes.reason);
  if (catalogRes.status === "rejected") console.error("[marketplace/layout] getStorefrontCatalog", catalogRes.reason);
  return {
    contact: contactRes.status === "fulfilled" ? buildShellContact(contactRes.value) : EMPTY_SHELL_CONTACT,
    hoods: catalogRes.status === "fulfilled" ? catalogRes.value.hoods : [],
  };
}

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const { contact, hoods } = await loadShellData();
  return (
    // La web es ARS + es-AR: el provider ya no lee cookies (compatibilidad).
    <MarketplacePrefsProvider>
      <style dangerouslySetInnerHTML={{ __html: FONT_VARS_CSS }} />
      {/* `light`: la web es siempre clara aunque el panel esté en oscuro en el
          mismo navegador (el dark: de los componentes no aplica adentro). */}
      <div
        data-apart-root=""
        className={cn(
          manrope.variable,
          sourceSerif.variable,
          "light font-apart min-h-dvh flex flex-col bg-cream text-ink-900 antialiased",
        )}
      >
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-forest-700 focus:px-5 focus:py-3 focus:text-[0.9375rem] focus:font-semibold focus:text-cream focus:shadow-apart-lg focus:outline-none focus:ring-[3px] focus:ring-coral-400"
        >
          Saltar al contenido
        </a>
        <SiteHeader contact={contact} />
        {/* El contacto también por contexto: error.tsx es cliente y no recibe props del layout. */}
        <SiteContactProvider value={contact}>
          <main id="contenido" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
        </SiteContactProvider>
        <SiteFooter contact={contact} hoods={hoods} />
      </div>
    </MarketplacePrefsProvider>
  );
}
