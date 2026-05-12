import { SiteHeader } from "@/components/marketplace/site-header";
import { SiteFooter } from "@/components/marketplace/site-footer";
import { getGuestSession } from "@/lib/actions/guest-auth";

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getGuestSession();
  return (
    <div className="min-h-screen flex flex-col bg-white text-neutral-900">
      <SiteHeader session={session} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
