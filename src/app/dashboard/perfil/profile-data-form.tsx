"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { updateUserProfile } from "@/lib/actions/profile";
import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
  onChangeAvatarRequested: () => void;
  onChangeEmailRequested: () => void;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProfileDataForm({
  profile,
  email,
  onChangeAvatarRequested,
  onChangeEmailRequested,
}: Props) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [locale, setLocale] = useState(profile.preferred_locale ?? "es-AR");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateUserProfile({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        preferred_locale: locale as "es-AR" | "en" | "pt-BR",
      });
      if (!result.ok) {
        toast.error("Error al actualizar", { description: result.error });
        return;
      }
      toast.success("Datos actualizados");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative size-16 rounded-full bg-muted overflow-hidden">
          {profile.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt={profile.full_name}
              width={64}
              height={64}
              unoptimized
              className="object-cover w-full h-full"
            />
          ) : (
            <div className="flex items-center justify-center w-full h-full text-lg font-semibold text-primary bg-primary/15">
              {getInitials(profile.full_name)}
            </div>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onChangeAvatarRequested}>
          Cambiar foto →
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="full_name">Nombre completo</Label>
        <Input
          id="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Teléfono</Label>
        <Input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+54 9 351 ..."
          maxLength={40}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="locale">Idioma de la interfaz</Label>
        <Select value={locale} onValueChange={setLocale}>
          <SelectTrigger id="locale" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="es-AR">Español (Argentina)</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <div className="flex items-center gap-2">
          <Input id="email" value={email} disabled className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onChangeEmailRequested}>
            Cambiar →
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          El email se cambia desde el tab Seguridad por motivos de protección.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
