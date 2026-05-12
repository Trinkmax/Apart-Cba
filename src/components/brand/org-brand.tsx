import Image from "next/image";
import { Logo } from "./logo";
import type { Organization } from "@/lib/types/database";

interface OrgBrandProps {
  organization: Pick<Organization, "id" | "name" | "logo_url">;
  size?: "sm" | "md";
}

/**
 * Brand del sidebar:
 * - Si la org tiene logo_url → renderiza ese logo personalizado (white-label).
 * - Si no → fallback al logo rentOS (wordmark expandido / icon "rOS" colapsado).
 *
 * Cuando el Sidebar de shadcn está en `collapsible="icon"`, expone
 * `data-collapsible="icon"` en el group ancestro; los hijos lo leen con
 * `group-data-[collapsible=icon]:*` para reaccionar al estado colapsado.
 */
export function OrgBrand({ organization, size = "sm" }: OrgBrandProps) {
  const dim = size === "sm" ? 32 : 44;

  if (organization.logo_url) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Image
          src={organization.logo_url}
          alt={organization.name}
          width={dim}
          height={dim}
          unoptimized
          className="h-9 w-auto max-w-[120px] object-contain"
        />
        <span className="font-semibold text-sm truncate group-data-[collapsible=icon]:hidden">
          {organization.name}
        </span>
      </div>
    );
  }

  return (
    <>
      <Logo size={size} className="group-data-[collapsible=icon]:hidden" />
      <Logo
        size={size}
        showWordmark={false}
        className="hidden group-data-[collapsible=icon]:block"
      />
    </>
  );
}
