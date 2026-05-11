"use client";

import { PasswordCard } from "./security/password-card";
import { EmailCard } from "./security/email-card";
import { TwoFactorCard } from "./security/two-factor-card";
import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
  mfaStatus: { enrolled: boolean; enabledAt: string | null };
}

export function SecuritySection({ profile: _profile, email, mfaStatus }: Props) {
  return (
    <div className="space-y-4">
      <PasswordCard />
      <EmailCard email={email} />
      <TwoFactorCard enrolled={mfaStatus.enrolled} enabledAt={mfaStatus.enabledAt} />
    </div>
  );
}
