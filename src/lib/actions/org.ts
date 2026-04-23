"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "./auth";
import type { Organization, UserRole } from "@/lib/types/database";

const ORG_COOKIE = "apartcba_org";

/**
 * Devuelve la org activa del usuario (vía cookie o primera membership).
 */
export async function getCurrentOrg(): Promise<{
  organization: Organization;
  role: UserRole;
}> {
  const session = await requireSession();
  if (session.memberships.length === 0 && !session.profile.is_superadmin) {
    redirect("/sin-acceso");
  }

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ORG_COOKIE)?.value;

  // Si la cookie apunta a una membership válida, usarla
  if (cookieOrgId) {
    const m = session.memberships.find((mem) => mem.organization_id === cookieOrgId);
    if (m) return { organization: m.organization, role: m.role };
  }

  // Si no, primera membership activa
  if (session.memberships.length > 0) {
    return {
      organization: session.memberships[0].organization,
      role: session.memberships[0].role,
    };
  }

  // Superadmin sin memberships (caso borde) — no debería poder operar sin elegir org
  redirect("/superadmin");
}

export async function setCurrentOrg(orgId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  revalidatePath("/", "layout");
}
