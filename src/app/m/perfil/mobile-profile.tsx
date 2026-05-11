"use client";

import { useState } from "react";
import { ChevronDown, User, Camera, Shield } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ProfileDataForm } from "@/app/dashboard/perfil/profile-data-form";
import { AvatarUploader } from "@/app/dashboard/perfil/avatar-uploader";
import { PasswordCard } from "@/app/dashboard/perfil/security/password-card";
import { EmailCard } from "@/app/dashboard/perfil/security/email-card";
import { TwoFactorCard } from "@/app/dashboard/perfil/security/two-factor-card";
import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
  mfaStatus: { enrolled: boolean; enabledAt: string | null };
}

export function MobileProfile({ profile, email, mfaStatus }: Props) {
  const noop = () => {};
  const [open, setOpen] = useState<"datos" | "foto" | "seguridad" | null>("datos");

  return (
    <div className="space-y-2">
      <Section
        id="datos"
        icon={User}
        title="Datos personales"
        open={open === "datos"}
        onToggle={() => setOpen((o) => (o === "datos" ? null : "datos"))}
      >
        <ProfileDataForm
          profile={profile}
          email={email}
          onChangeAvatarRequested={noop}
          onChangeEmailRequested={noop}
        />
      </Section>

      <Section
        id="foto"
        icon={Camera}
        title="Foto de perfil"
        open={open === "foto"}
        onToggle={() => setOpen((o) => (o === "foto" ? null : "foto"))}
      >
        <AvatarUploader currentUrl={profile.avatar_url} />
      </Section>

      <Section
        id="seguridad"
        icon={Shield}
        title="Seguridad"
        open={open === "seguridad"}
        onToggle={() => setOpen((o) => (o === "seguridad" ? null : "seguridad"))}
      >
        <div className="space-y-3">
          <PasswordCard />
          <EmailCard email={email} />
          <TwoFactorCard enrolled={mfaStatus.enrolled} enabledAt={mfaStatus.enabledAt} />
        </div>
      </Section>
    </div>
  );
}

interface SectionProps {
  id: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ icon: Icon, title, open, onToggle, children }: SectionProps) {
  return (
    <Collapsible open={open} onOpenChange={() => onToggle()} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon size={14} />
          {title}
        </div>
        <ChevronDown
          size={16}
          className={`transition-transform text-muted-foreground ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}
