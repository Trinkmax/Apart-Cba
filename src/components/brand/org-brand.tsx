import Image from "next/image";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";
import { isOpaqueLogo } from "@/lib/brand/logo";
import type { Organization } from "@/lib/types/database";

interface OrgBrandProps {
  organization: Pick<Organization, "name" | "logo_url" | "brand_show_name">;
  size?: "sm" | "md";
}

/**
 * La identidad de la organización arriba del sidebar. Es lo único que dice en
 * qué organización estás (la barra de arriba ya no repite el nombre), así que
 * siempre se lee el logo o el nombre:
 *
 * - Logo transparente (PNG/WebP/SVG) → silueta del color del texto
 *   (`brightness-0 dark:invert`): el PNG blanco de Apart CBA, pensado para fondo
 *   oscuro, se ve en los dos temas. `brightness(0)` conserva el alpha.
 * - Logo sin transparencia (JPG) → en sus colores, sobre blanco, como el ícono
 *   de una app. La silueta lo convertía en un rectángulo negro.
 * - Sin logo → la marca de rentOS y el nombre de la organización.
 *
 * Si `brand_show_name` es false, va sólo el logo, más grande.
 */
export function OrgBrand({ organization, size = "sm" }: OrgBrandProps) {
  const dim = size === "sm" ? 32 : 44;
  const showName = organization.brand_show_name !== false;
  const name = (
    <span className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] group-data-[collapsible=icon]:hidden">
      {organization.name}
    </span>
  );

  if (organization.logo_url && isOpaqueLogo(organization.logo_url)) {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white p-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/15",
            showName ? "size-9" : "h-11 w-auto max-w-[176px] px-1.5",
            "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:px-[3px]",
          )}
        >
          <Image
            src={organization.logo_url}
            alt={organization.name}
            width={dim * 2}
            height={dim * 2}
            unoptimized
            className={cn("object-contain", showName ? "size-full" : "h-full w-auto")}
          />
        </span>
        {showName ? name : null}
      </span>
    );
  }

  if (organization.logo_url) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Image
          src={organization.logo_url}
          alt={organization.name}
          width={dim}
          height={dim}
          unoptimized
          className={cn(
            "w-auto object-contain group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:max-w-[40px]",
            "brightness-0 dark:invert",
            showName ? "h-9 max-w-[120px]" : "h-12 max-w-[180px]",
          )}
        />
        {showName ? name : null}
      </span>
    );
  }

  // Sin logo: todas las organizaciones mostraban el mismo "rentOS" y no se
  // sabía en cuál estabas. La marca queda chica y el nombre manda.
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {/* 18 px de alto → 40 de ancho: entra en el sidebar colapsado (48 px). */}
      <Logo size={size} showWordmark={false} className="h-[18px] w-auto shrink-0" />
      {name}
    </span>
  );
}
