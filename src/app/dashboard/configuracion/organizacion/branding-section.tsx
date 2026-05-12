"use client";

import { useRouter } from "next/navigation";
import { ImageUploader } from "@/components/ui/image-uploader";
import { uploadOrgLogo, deleteOrgLogo } from "@/lib/actions/org";
import type { Organization } from "@/lib/types/database";

interface Props {
  organization: Organization;
}

export function BrandingSection({ organization }: Props) {
  const router = useRouter();
  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold">Branding</h2>
        <p className="text-sm text-muted-foreground">
          Subí el logo de tu organización. Se va a mostrar en el sidebar del producto en lugar del logo de rentOS.
          Si lo eliminás, vuelve al brand rentOS por default.
        </p>
      </header>
      <div className="max-w-md mx-auto">
        <ImageUploader
          currentUrl={organization.logo_url}
          uploadAction={uploadOrgLogo}
          deleteAction={deleteOrgLogo}
          maxSizeMB={5}
          acceptedTypes={["image/jpeg", "image/png", "image/webp", "image/svg+xml"]}
          previewSize={180}
          shape="square"
          placeholderText="Arrastrá tu logo o hacé click para subirlo"
          onUploaded={() => router.refresh()}
        />
      </div>
    </section>
  );
}
