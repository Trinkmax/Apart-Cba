import { listChannels } from "@/lib/actions/crm-channels";
import { getAISettings } from "@/lib/actions/crm-ai-settings";
import { listTemplates } from "@/lib/actions/crm-templates";
import { listTags } from "@/lib/actions/crm-tags";
import { CrmConfigClient } from "./crm-config-client";

export async function CrmConfigShell() {
  const [channels, aiSettings, templates, tags] = await Promise.all([
    listChannels(),
    getAISettings(),
    listTemplates(),
    listTags(),
  ]);

  return (
    <CrmConfigClient
      channels={channels}
      aiSettings={aiSettings}
      templates={templates}
      tags={tags}
    />
  );
}
