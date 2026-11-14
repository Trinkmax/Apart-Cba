"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OrgBrand } from "@/components/brand/org-brand";
import { setCurrentOrg } from "@/lib/actions/org";
import { ROLE_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Organization, OrganizationMember } from "@/lib/types/database";

/**
 * Arriba del sidebar: quién sos (el logo o el nombre de la organización) y,
 * si trabajás en más de una, el lugar para cambiar. Antes eso vivía en un
 * recuadro con las iniciales en la barra de arriba, que repetía lo que ya
 * decía el sidebar.
 */
export function SidebarOrgHeader({
  currentOrg,
  memberships,
  homeHref,
}: {
  currentOrg: Organization;
  memberships: (OrganizationMember & { organization: Organization })[];
  homeHref: string;
}) {
  const [pending, startTransition] = React.useTransition();
  const [target, setTarget] = React.useState<string | null>(null);

  if (memberships.length <= 1) {
    return (
      <Link href={homeHref} className="flex min-w-0 items-center rounded-xl px-1.5 py-1">
        <OrgBrand organization={currentOrg} />
      </Link>
    );
  }

  const switchTo = (orgId: string) => {
    if (orgId === currentOrg.id) return;
    setTarget(orgId);
    startTransition(async () => {
      await setCurrentOrg(orgId);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={`${currentOrg.name}: cambiar de organización`}
          className={cn(
            "flex w-full min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 text-left outline-none transition-colors",
            "hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent/70",
            "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
            pending && "opacity-60",
          )}
        >
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
            <OrgBrand organization={currentOrg} />
          </span>
          {pending ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
          ) : (
            <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/45 group-data-[collapsible=icon]:hidden" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-64"
        // Que al cerrarse no quede el anillo de foco pintado sobre el logo.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Tus organizaciones</DropdownMenuLabel>
        {memberships.map((m) => {
          const current = m.organization_id === currentOrg.id;
          const color = m.organization.primary_color ?? "var(--brand-teal)";
          return (
            <DropdownMenuItem
              key={m.organization_id}
              onSelect={() => switchTo(m.organization_id)}
              className="cursor-pointer gap-2.5 py-2"
            >
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-lg text-[10px] font-bold"
                style={{
                  color: `color-mix(in oklab, ${color} 55%, var(--foreground))`,
                  background: `color-mix(in oklab, ${color} 16%, transparent)`,
                }}
              >
                {initials(m.organization.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.organization.name}</span>
                <span className="block text-[11px] text-muted-foreground">{ROLE_META[m.role].label}</span>
              </span>
              {target === m.organization_id && pending ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : current ? (
                <Check className="size-3.5 text-primary" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}
