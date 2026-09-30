import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import type { OrgWebSettings } from "@/lib/types/database";
import { resolveWebSettings, type ResolvedWebSettings } from "./web-settings";

/**
 * Lecturas server-side de la configuración de la web (Configuración → Web y
 * cobros). Service role: la usan páginas públicas, emails y crons.
 *
 * Tag de caché: `web-settings` (el guardado del panel lo revalida).
 *
 * Errores de lectura: los loaders que van a `unstable_cache` LANZAN (modo
 * `strict`). Si devolvieran los defaults, la caché los guardaría 5 minutos y
 * la web se quedaría sin datos de transferencia ni WhatsApp. Un error no se
 * cachea (y si había un valor viejo, Next sigue sirviéndolo); el que llama
 * lo ataja en el borde y cae a una lectura sin caché (modo `lenient`: loguea
 * y sigue con defaults, lo de siempre) que tampoco se cachea.
 */
export const WEB_SETTINGS_TAG = "web-settings";

type LoadMode = "strict" | "lenient";

async function loadResolved(orgId: string, mode: LoadMode): Promise<ResolvedWebSettings> {
  const admin = createAdminClient();
  const [settingsRes, orgRes] = await Promise.all([
    admin.from("org_web_settings").select("*").eq("organization_id", orgId).maybeSingle(),
    admin.from("organizations").select("contact_email, contact_phone").eq("id", orgId).maybeSingle(),
  ]);
  const readError = settingsRes.error ?? orgRes.error;
  if (readError) {
    if (mode === "strict") {
      throw new Error(`No se pudo leer la configuración de la web (${orgId}): ${readError.message}`);
    }
    console.error("[web-settings] lectura con error, sigo con los defaults:", orgId, readError.message);
  }
  return resolveWebSettings((settingsRes.data as OrgWebSettings | null) ?? null, {
    email: orgRes.data?.contact_email ?? null,
    phone: orgRes.data?.contact_phone ?? null,
  });
}

const loadResolvedCached = (orgId: string) =>
  unstable_cache(() => loadResolved(orgId, "strict"), ["web-settings", orgId], {
    revalidate: 300,
    tags: [WEB_SETTINGS_TAG],
  })();

/**
 * Configuración resuelta (con defaults) de una organización. Si la lectura
 * cacheada falla, lee sin caché (`getResolvedWebSettingsFresh`): ese
 * resultado —aunque sean defaults— no queda guardado.
 */
export const getResolvedWebSettings = cache(async (orgId: string): Promise<ResolvedWebSettings> => {
  try {
    return await loadResolvedCached(orgId);
  } catch (err) {
    unstable_rethrow(err);
    console.error("[web-settings] la lectura cacheada falló, leo sin caché:", err);
    return getResolvedWebSettingsFresh(orgId);
  }
});

/**
 * Lo mismo sin caché: para acciones que escriben o mandan mails recién
 * guardada la config. Un error de lectura no lanza: loguea y usa defaults.
 */
export async function getResolvedWebSettingsFresh(orgId: string): Promise<ResolvedWebSettings> {
  return loadResolved(orgId, "lenient");
}

export interface SiteContact {
  organizationId: string | null;
  organizationName: string;
  whatsappNumber: string | null;
  publicEmail: string | null;
  instagramHandle: string | null;
  responseHours: number;
}

/** Contacto sin organización: lo que se muestra si no hay vidriera o no se pudo leer. */
const DEFAULT_SITE_CONTACT: SiteContact = {
  organizationId: null,
  organizationName: "apart",
  whatsappNumber: null,
  publicEmail: null,
  instagramHandle: null,
  responseHours: 24,
};

async function loadSiteContact(mode: LoadMode): Promise<SiteContact> {
  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, name")
    .eq("marketplace_enabled", true)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (mode === "strict") throw new Error(`No se pudo leer la organización de la web: ${error.message}`);
    console.error("[web-settings] contacto del sitio: lectura con error, sigo con los defaults:", error.message);
  }
  if (!org) return { ...DEFAULT_SITE_CONTACT };
  const s = await loadResolved(org.id, mode);
  return {
    organizationId: org.id,
    organizationName: org.name,
    whatsappNumber: s.whatsappNumber,
    publicEmail: s.publicEmail,
    instagramHandle: s.instagramHandle,
    responseHours: s.responseHours,
  };
}

/**
 * Contacto del sitio (header, footer, "Cómo reservar"): el de la organización
 * que vende en la web. Hoy la vidriera es una sola (Apart CBA).
 *
 * NUNCA lanza (el layout depende de esto): si la lectura cacheada falla, lee
 * sin caché; si eso también falla, devuelve el contacto por defecto. Ninguno
 * de los dos resultados de emergencia se cachea.
 */
export const getSiteContact = cache(async (): Promise<SiteContact> => {
  try {
    return await unstable_cache(() => loadSiteContact("strict"), ["site-contact"], {
      revalidate: 300,
      tags: [WEB_SETTINGS_TAG],
    })();
  } catch (err) {
    unstable_rethrow(err);
    console.error("[web-settings] contacto del sitio: la lectura cacheada falló, leo sin caché:", err);
  }
  try {
    return await loadSiteContact("lenient");
  } catch (err) {
    unstable_rethrow(err);
    console.error("[web-settings] contacto del sitio: uso el contacto por defecto:", err);
    return { ...DEFAULT_SITE_CONTACT };
  }
});
