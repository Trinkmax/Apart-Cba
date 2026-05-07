"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  removeOrganizationLogo,
  updateOrganizationProfile,
  uploadOrganizationLogo,
} from "@/lib/actions/org";
import type { Organization } from "@/lib/types/database";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = "#0F766E";

export function OrganizationProfileForm({
  organization,
}: {
  organization: Pick<
    Organization,
    "name" | "legal_name" | "tax_id" | "primary_color" | "logo_url" | "slug" | "timezone"
  >;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(organization.name);
  const [legalName, setLegalName] = useState(organization.legal_name ?? "");
  const [taxId, setTaxId] = useState(organization.tax_id ?? "");
  const [color, setColor] = useState(organization.primary_color ?? DEFAULT_COLOR);
  const [logoUrl, setLogoUrl] = useState(organization.logo_url);

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    if (color.trim() && !HEX_RE.test(color.trim())) {
      toast.error("Color inválido", {
        description: "Esperamos formato #RRGGBB (ej. #0F766E).",
      });
      return;
    }
    startTransition(async () => {
      try {
        await updateOrganizationProfile({
          name: name.trim(),
          legal_name: legalName,
          tax_id: taxId,
          primary_color: color.trim() || null,
        });
        toast.success("Datos de la organización actualizados");
        router.refresh();
      } catch (e) {
        toast.error("No se pudieron guardar los cambios", {
          description: (e as Error).message,
        });
      }
    });
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = await uploadOrganizationLogo(fd);
      setLogoUrl(url);
      toast.success("Logo actualizado");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo subir el logo", {
        description: (err as Error).message,
      });
    } finally {
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleLogoRemove() {
    if (!logoUrl) return;
    setIsUploading(true);
    startTransition(async () => {
      try {
        await removeOrganizationLogo();
        setLogoUrl(null);
        toast.success("Logo eliminado");
        router.refresh();
      } catch (err) {
        toast.error("No se pudo eliminar el logo", {
          description: (err as Error).message,
        });
      } finally {
        setIsUploading(false);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Logo */}
      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Logo</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aparece en el sidebar y en los comprobantes en PDF. PNG, JPG, WebP o SVG, hasta 4 MB.
          </p>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div
            className="size-20 rounded-lg border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0"
            aria-label="Vista previa del logo"
          >
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Logo"
                width={80}
                height={80}
                className="size-full object-contain"
                unoptimized
              />
            ) : (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Sin logo
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleLogoChange}
              disabled={isUploading || isPending}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={isUploading || isPending}
              className="gap-1.5"
            >
              {isUploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {logoUrl ? "Cambiar logo" : "Subir logo"}
            </Button>
            {logoUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleLogoRemove}
                disabled={isUploading || isPending}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 size={14} /> Quitar
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Datos */}
      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Datos de la organización</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Se usan en el sidebar, en los comprobantes y en los documentos generados.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Nombre comercial</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Apart CBA"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-legal">Razón social</Label>
            <Input
              id="org-legal"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              maxLength={160}
              placeholder="Opcional"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-tax">CUIT / Tax ID</Label>
            <Input
              id="org-tax"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              maxLength={40}
              placeholder="Opcional"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-color">Color principal</Label>
            <div className="flex items-center gap-2">
              <Input
                id="org-color-picker"
                type="color"
                value={HEX_RE.test(color) ? color : DEFAULT_COLOR}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer p-1"
                aria-label="Color principal"
              />
              <Input
                id="org-color"
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="font-mono text-xs uppercase tracking-wide"
                placeholder="#RRGGBB"
                pattern="#[0-9a-fA-F]{6}"
                spellCheck={false}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Se usa como acento en los comprobantes en PDF.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
          <ReadOnlyField label="Slug" value={organization.slug} />
          <ReadOnlyField label="Zona horaria" value={organization.timezone} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || isUploading}
          className="gap-1.5"
        >
          {isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      <Input value={value} readOnly disabled className="bg-muted/30" />
    </div>
  );
}
