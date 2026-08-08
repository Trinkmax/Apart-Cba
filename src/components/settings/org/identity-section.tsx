"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { updateOrgIdentity } from "@/lib/actions/org";
import type { Organization } from "@/lib/types/database";

interface Props {
  organization: Organization;
}

/**
 * Contacto público de la organización. El nombre comercial NO se edita acá:
 * vive en OrganizationProfileForm (misma página) para no tener dos formularios
 * peleando por el mismo campo.
 */
export function IdentitySection({ organization }: Props) {
  const [description, setDescription] = useState(organization.description ?? "");
  const [address, setAddress] = useState(organization.address ?? "");
  const [phone, setPhone] = useState(organization.contact_phone ?? "");
  const [email, setEmail] = useState(organization.contact_email ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateOrgIdentity({
        description: description.trim() || null,
        address: address.trim() || null,
        contact_phone: phone.trim() || null,
        contact_email: email.trim() || null,
      });
      if (!result.ok) {
        toast.error("Error al guardar", { description: result.error });
        return;
      }
      toast.success("Datos de contacto actualizados");
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Contacto público</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Aparece en los mails al huésped y en el sitio público.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="org_desc">Descripción</Label>
          <Textarea
            id="org_desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Una frase breve que describa tu negocio."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org_addr">Dirección</Label>
          <Input
            id="org_addr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={500}
            placeholder="Calle 123, Ciudad, Provincia"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="org_phone">Teléfono de contacto</Label>
            <Input
              id="org_phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
              placeholder="+54 9 351 ..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org_email">Email de contacto</Label>
            <Input
              id="org_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              placeholder="hola@miorg.com"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} variant="outline" className="gap-1.5">
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar contacto
          </Button>
        </div>
      </form>
    </div>
  );
}
