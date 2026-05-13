import { ThemeProvider } from "next-themes";
import { SiteHeader } from "@/components/marketplace/site-header";
import { SiteFooter } from "@/components/marketplace/site-footer";
import { MarketplacePrefsProvider } from "@/components/marketplace/marketplace-prefs-provider";
import { getGuestSession } from "@/lib/actions/guest-auth";
import {
  getActiveCurrency,
  getActiveLocale,
} from "@/lib/actions/marketplace-preferences";

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const [session, currency, locale] = await Promise.all([
    getGuestSession(),
    getActiveCurrency(),
    getActiveLocale(),
  ]);
  return (
    // The marketplace is always rendered in light mode (Airbnb-style consumer
    // surface). forcedTheme overrides the dashboard's system/dark preference
    // and propagates `class="light"` to <html>, so portaled popovers/dropdowns
    // pick up the light CSS variables too.
    <ThemeProvider attribute="class" forcedTheme="light" enableSystem={false}>
      <MarketplacePrefsProvider currency={currency} locale={locale}>
        <div className="min-h-screen flex flex-col bg-white text-neutral-900">
          <SiteHeader session={session} />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </MarketplacePrefsProvider>
    </ThemeProvider>
  );
}
