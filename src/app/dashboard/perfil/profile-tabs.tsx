"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileDataForm } from "./profile-data-form";
import { AvatarUploader } from "./avatar-uploader";
import { SecuritySection } from "./security-section";
import type { UserProfile } from "@/lib/types/database";

interface ProfileTabsProps {
  profile: UserProfile;
  email: string;
}

export function ProfileTabs({ profile, email }: ProfileTabsProps) {
  const [tab, setTab] = useState("datos");

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-6">
        <TabsTrigger value="datos">Datos</TabsTrigger>
        <TabsTrigger value="foto">Foto</TabsTrigger>
        <TabsTrigger value="seguridad">Seguridad</TabsTrigger>
      </TabsList>

      <TabsContent value="datos">
        <ProfileDataForm
          profile={profile}
          email={email}
          onChangeAvatarRequested={() => setTab("foto")}
          onChangeEmailRequested={() => setTab("seguridad")}
        />
      </TabsContent>

      <TabsContent value="foto">
        <AvatarUploader currentUrl={profile.avatar_url} />
      </TabsContent>

      <TabsContent value="seguridad">
        <SecuritySection profile={profile} email={email} />
      </TabsContent>
    </Tabs>
  );
}
