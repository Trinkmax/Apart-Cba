import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getMfaStatus } from "@/lib/actions/security";
import { ProfileTabs } from "./profile-tabs";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const mfa = await getMfaStatus();

  return (
    <div className="container max-w-3xl py-6 px-4 sm:px-6">
      <h1 className="text-2xl font-bold mb-6">Mi perfil</h1>
      <ProfileTabs profile={session.profile} email={session.email ?? ""} mfaStatus={mfa} />
    </div>
  );
}
