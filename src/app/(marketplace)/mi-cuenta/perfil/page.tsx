import { requireGuestSession } from "@/lib/actions/guest-auth";
import { GuestProfileForm } from "@/components/marketplace/profile-form";

export const metadata = {
  title: "Mi perfil · rentOS",
};

export default async function PerfilPage() {
  const session = await requireGuestSession();
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 md:py-12">
      <h1 className="text-3xl font-semibold text-neutral-900 mb-2">Tu perfil</h1>
      <p className="text-neutral-500 mb-8">
        Mantené tus datos al día para que el anfitrión pueda coordinar con vos.
      </p>
      <GuestProfileForm profile={session.profile} email={session.email} />
    </div>
  );
}
