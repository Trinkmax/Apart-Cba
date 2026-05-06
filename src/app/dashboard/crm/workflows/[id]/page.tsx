import { notFound, redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getCrmWorkflow } from "@/lib/actions/crm-workflows";
import { listTags } from "@/lib/actions/crm-tags";
import { listChannels } from "@/lib/actions/crm-channels";
import { listTemplates } from "@/lib/actions/crm-templates";
import { getAISettings } from "@/lib/actions/crm-ai-settings";
import { WorkflowEditor } from "@/components/crm/workflows/editor/workflow-editor";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorkflowEditorPage({ params }: Props) {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "view")) redirect("/sin-acceso");

  const { id } = await params;
  const [workflow, tags, channels, templates, aiSettings] = await Promise.all([
    getCrmWorkflow(id),
    listTags(),
    listChannels(),
    listTemplates(),
    getAISettings(),
  ]);

  if (!workflow) notFound();

  return (
    <WorkflowEditor
      workflow={workflow}
      tags={tags}
      channels={channels}
      templates={templates}
      aiEnabledModels={aiSettings?.enabled_models ?? ["claude-sonnet-4-6", "gpt-5"]}
      canEdit={can(role, "crm_workflows", "update")}
    />
  );
}
