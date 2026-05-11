import Image from "next/image";
import { Logo } from "./logo";
import type { Organization } from "@/lib/types/database";

interface OrgBrandProps {
  organization: Pick<Organization, "id" | "name" | "logo_url">;
  size?: "sm" | "md";
}

/**
 * Brand del sidebar:
 * - Si la org tiene logo_url → renderiza ese logo (white-label total).
 * - Si no → fallback al <Logo> de Apart Cba.
 *
 * Decisión Spec 2: las orgs sin logo siguen viendo "APART" como antes.
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
        <span className="font-semibold text-sm truncate">{organization.name}</span>
      </div>
    );
  }
  return <Logo size={size} />;
}
