import { headers } from "next/headers";
import { listChannels } from "@/lib/actions/crm-channels";
import { getAISettings } from "@/lib/actions/crm-ai-settings";
import { listTemplates } from "@/lib/actions/crm-templates";
import { listTags } from "@/lib/actions/crm-tags";
import { CrmConfigClient } from "./crm-config-client";

/**
 * Resuelve la URL pública real para mostrar en la sección "URL del webhook":
 * 1. Prioriza NEXT_PUBLIC_APP_URL si está configurada.
 * 2. Cae al header x-forwarded-host de Vercel (siempre presente en producción).
 * 3. Como último recurso usa el host del request.
 *
 * Esto evita el bug histórico donde el cliente mostraba "https://tu-app.vercel.app"
 * porque la env var no estaba seteada — y el admin terminaba pegándola en Meta.
 */
async function resolveAppUrl(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function CrmConfigShell() {
  const [channels, aiSettings, templates, tags, appUrl] = await Promise.all([
    listChannels(),
    getAISettings(),
    listTemplates(),
    listTags(),
    resolveAppUrl(),
  ]);

  return (
    <CrmConfigClient
      channels={channels}
      aiSettings={aiSettings}
      templates={templates}
      tags={tags}
      appUrl={appUrl}
    />
  );
}
