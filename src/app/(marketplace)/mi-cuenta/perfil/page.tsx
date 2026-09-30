import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandDot, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { GuestProfileForm } from "@/components/marketplace/profile-form";
import { buildShellContact, EMPTY_SHELL_CONTACT } from "@/components/marketplace/shell/contact";
import { requireGuestSession } from "@/lib/actions/guest-auth";
import { getSiteContact } from "@/lib/marketplace/web-settings-server";

export const metadata: Metadata = {
  title: "Mis datos",
  robots: { index: false, follow: false },
};

export default async function PerfilPage() {
  const session = await requireGuestSession("/mi-cuenta/perfil");
  const contact = await getSiteContact()
    .then((c) => buildShellContact(c))
    .catch(() => EMPTY_SHELL_CONTACT);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10 lg:pb-28">
      <Link
        href="/mi-cuenta"
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-[0.9375rem] font-semibold text-forest-700 outline-none transition-colors hover:text-forest-800 focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Mis reservas
      </Link>

      <header className="mb-8 mt-5 sm:mb-10">
        <Eyebrow>Tu cuenta</Eyebrow>
        <h1 className="mt-3 text-[2.25rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 sm:text-[2.75rem]">
          Mis datos
          <BrandDot />
        </h1>
        <p className="mt-3 font-apart-serif text-lg italic leading-snug text-forest-600 sm:text-xl">
          Tenelos al día y coordinamos tu llegada más rápido.
        </p>
      </header>

      <GuestProfileForm profile={session.profile} email={session.email} contact={contact} />
    </div>
  );
}
