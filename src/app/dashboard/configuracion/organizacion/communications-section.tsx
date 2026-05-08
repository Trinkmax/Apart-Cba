"use client";

import { DomainCard } from "./domain-card";
import { TemplatesSection } from "./templates-section";
import type { Organization, OrgMessageTemplate } from "@/lib/types/database";

interface Props {
  organization: Organization;
  templates: OrgMessageTemplate[];
}

export function CommunicationsSection({ organization, templates }: Props) {
  return (
    <section className="rounded-lg border bg-card p-6 space-y-8">
      <header>
        <h2 className="text-lg font-semibold">Comunicaciones</h2>
        <p className="text-sm text-muted-foreground">
          Dominio para mails al huésped y plantillas editables.
        </p>
      </header>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Dominio Resend
        </h3>
        <DomainCard organization={organization} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Plantillas
        </h3>
        <TemplatesSection templates={templates} />
      </div>
    </section>
  );
}
