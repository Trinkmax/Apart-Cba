"use client";

import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
  onChangeAvatarRequested: () => void;
  onChangeEmailRequested: () => void;
}

export function ProfileDataForm({
  profile: _profile,
  email: _email,
  onChangeAvatarRequested: _onChangeAvatarRequested,
  onChangeEmailRequested: _onChangeEmailRequested,
}: Props) {
  return (
    <div className="rounded-lg border p-6 text-sm text-muted-foreground">
      Datos — TODO Task 11
    </div>
  );
}
