"use client";
import type { Organization, OrgMessageTemplate } from "@/lib/types/database";
export function CommunicationsSection({
  organization: _organization,
  templates: _templates,
}: {
  organization: Organization;
  templates: OrgMessageTemplate[];
}) {
  return <div className="rounded-lg border p-6">Comunicaciones — TODO Tasks 19-23</div>;
}
