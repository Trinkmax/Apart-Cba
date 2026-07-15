"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { DniSection } from "@/components/team/dni-section";
import { updateMemberProfile } from "@/lib/actions/team";
import { ROLE_META } from "@/lib/constants";
import { getInitials } from "@/lib/format";
import type { OrganizationMember, UserProfile } from "@/lib/types/database";

type Member = OrganizationMember & { profile: UserProfile | null; email: string | null };

interface Props {
  member: Member;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface FormState {
  full_name: string;
  phone: string;
  job_title: string;
  dni_number: string;
  cuit_cuil: string;
  address: string;
  birth_date: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  notes: string;
}

function initialForm(profile: UserProfile | null): FormState {
  return {
    full_name: profile?.full_name ?? "",
    phone: profile?.phone ?? "",
    job_title: profile?.job_title ?? "",
    dni_number: profile?.dni_number ?? "",
    cuit_cuil: profile?.cuit_cuil ?? "",
    address: profile?.address ?? "",
    birth_date: profile?.birth_date ?? "",
    emergency_contact_name: profile?.emergency_contact_name ?? "",
    emergency_contact_phone: profile?.emergency_contact_phone ?? "",
    notes: profile?.notes ?? "",
  };
}

export function MemberProfileSheet({ member, open, onOpenChange }: Props) {
  const roleMeta = ROLE_META[member.role];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 gap-0 flex flex-col">
        <SheetHeader className="border-b">
          <SheetTitle className="sr-only">Editar perfil del miembro</SheetTitle>
          <div className="flex items-center gap-3 pr-8">
            <Avatar className="size-12">
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                {getInitials(member.profile?.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{member.profile?.full_name ?? "—"}</div>
              <div className="text-xs text-muted-foreground truncate">{member.email ?? "—"}</div>
            </div>
            <Badge
              className="font-normal shrink-0"
              style={{
                color: roleMeta.color,
                backgroundColor: roleMeta.color + "15",
                borderColor: roleMeta.color + "30",
              }}
            >
              {roleMeta.label}
            </Badge>
          </div>
        </SheetHeader>

        {/*
          El form vive en un hijo montado sólo cuando el sheet está abierto:
          Radix desmonta el contenido al cerrar, así que al reabrir se re-monta
          con el profile fresco (post router.refresh()) sin necesidad de un
          useEffect que sincronice estado (evita set-state-in-effect).
        */}
        <ProfileForm member={member} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function ProfileForm({ member, onClose }: { member: Member; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(member.profile));

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    const fullName = form.full_name.trim();
    if (fullName.length < 2) {
      toast.error("El nombre es obligatorio");
      return;
    }

    const clean = (v: string): string | null => {
      const t = v.trim();
      return t.length ? t : null;
    };

    startTransition(async () => {
      try {
        await updateMemberProfile(member.user_id, {
          full_name: fullName,
          phone: clean(form.phone),
          job_title: clean(form.job_title),
          dni_number: clean(form.dni_number),
          cuit_cuil: clean(form.cuit_cuil),
          address: clean(form.address),
          birth_date: clean(form.birth_date),
          emergency_contact_name: clean(form.emergency_contact_name),
          emergency_contact_phone: clean(form.emergency_contact_phone),
          notes: clean(form.notes),
        });
        toast.success("Perfil actualizado");
        router.refresh();
        onClose();
      } catch (e) {
        toast.error("Error al guardar", { description: (e as Error).message });
      }
    });
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {/* Datos personales */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Datos personales</h3>
          <div className="space-y-1.5">
            <Label htmlFor="mp-full_name">Nombre completo</Label>
            <Input
              id="mp-full_name"
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              required
              minLength={2}
              placeholder="Nombre y apellido"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-phone">Teléfono</Label>
            <Input
              id="mp-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+54 9 351 …"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-job_title">Especialidad / puesto</Label>
            <Input
              id="mp-job_title"
              value={form.job_title}
              onChange={(e) => set("job_title", e.target.value)}
              placeholder="Plomero, electricista, portero…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-address">Domicilio</Label>
            <Input
              id="mp-address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Calle, número, barrio…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-birth_date">Fecha de nacimiento</Label>
            <Input
              id="mp-birth_date"
              type="date"
              value={form.birth_date}
              onChange={(e) => set("birth_date", e.target.value)}
            />
          </div>
        </section>

        <Separator />

        {/* Documentación */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Documentación</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mp-dni_number">DNI (número)</Label>
              <Input
                id="mp-dni_number"
                value={form.dni_number}
                onChange={(e) => set("dni_number", e.target.value)}
                placeholder="Sin puntos"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-cuit_cuil">CUIT / CUIL</Label>
              <Input
                id="mp-cuit_cuil"
                value={form.cuit_cuil}
                onChange={(e) => set("cuit_cuil", e.target.value)}
                placeholder="20-12345678-3"
              />
            </div>
          </div>
          <DniSection userId={member.user_id} canEdit title="Fotos del DNI" />
        </section>

        <Separator />

        {/* Contacto de emergencia */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Contacto de emergencia</h3>
          <div className="space-y-1.5">
            <Label htmlFor="mp-emergency_contact_name">Nombre</Label>
            <Input
              id="mp-emergency_contact_name"
              value={form.emergency_contact_name}
              onChange={(e) => set("emergency_contact_name", e.target.value)}
              placeholder="Nombre del contacto"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-emergency_contact_phone">Teléfono</Label>
            <Input
              id="mp-emergency_contact_phone"
              type="tel"
              value={form.emergency_contact_phone}
              onChange={(e) => set("emergency_contact_phone", e.target.value)}
              placeholder="+54 9 351 …"
            />
          </div>
        </section>

        <Separator />

        {/* Notas */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Notas</h3>
          <div className="space-y-1.5">
            <Label htmlFor="mp-notes">Notas internas</Label>
            <Textarea
              id="mp-notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={4}
              placeholder="Información interna del miembro…"
            />
          </div>
        </section>
      </div>

      <div className="border-t p-4 flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={isPending} className="gap-2">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Guardar
        </Button>
      </div>
    </>
  );
}
