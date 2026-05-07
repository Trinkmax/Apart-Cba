"use client";

import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
}

export function SecuritySection({ profile: _profile, email: _email }: Props) {
  return (
    <div className="rounded-lg border p-6 text-sm text-muted-foreground">
      La sección de seguridad (cambio de contraseña, email, 2FA) se habilita en el próximo PR.
    </div>
  );
}
