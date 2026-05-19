import Image from "next/image";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";
import type { Organization } from "@/lib/types/database";

interface OrgBrandProps {
  organization: Pick<
    Organization,
    "id" | "name" | "logo_url" | "brand_show_name"
  >;
  size?: "sm" | "md";
}

/**
 * Brand del sidebar:
 * - Con logo_url → logo personalizado (white-label). Si brand_show_name es
 *   false, se oculta el nombre y el logo toma más protagonismo (más grande).
 * - Sin logo → fallback al logo rentOS.
 *
 * El logo subido se renderiza como silueta monocroma adaptable al tema
 * (`brightness-0 dark:invert`): negro sobre el sidebar claro
 * (`--sidebar` oklch(0.97)), blanco sobre el oscuro (oklch(0.13)). Así un PNG
 * pensado para fondo oscuro no queda invisible en modo claro. `brightness(0)`
 * conserva el canal alpha, por lo que la transparencia del logo se respeta.
 */
export function OrgBrand({ organization, size = "sm" }: OrgBrandProps) {
  const dim = size === "sm" ? 32 : 44;

  if (organization.logo_url) {
    const showName = organization.brand_show_name !== false;
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Image
          src={organization.logo_url}
          alt={organization.name}
          width={dim}
          height={dim}
          unoptimized
          className={cn(
            "w-auto object-contain group-data-[collapsible=icon]:h-8",
            "brightness-0 dark:invert",
            showName ? "h-9 max-w-[120px]" : "h-12 max-w-[180px]",
          )}
        />
        {showName && (
          <span className="font-semibold text-sm truncate group-data-[collapsible=icon]:hidden">
            {organization.name}
          </span>
        )}
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
