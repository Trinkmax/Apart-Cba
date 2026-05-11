import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getMfaStatus } from "@/lib/actions/security";
import { MobileProfile } from "./mobile-profile";

export const dynamic = "force-dynamic";

export default async function MobilePerfilPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const mfa = await getMfaStatus();

  return (
    <main className="px-4 py-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Mi perfil</h1>
      <MobileProfile profile={session.profile} email={session.email ?? ""} mfaStatus={mfa} />
    </main>
  );
}
