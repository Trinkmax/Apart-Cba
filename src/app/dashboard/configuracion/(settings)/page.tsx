import { redirect } from "next/navigation";
import { Building2, Clock, Globe2 } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { Card } from "@/components/ui/card";

export default async function GeneralConfigPage() {
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") redirect("/dashboard");

  const fields: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string | null | undefined }[] = [
    { icon: Building2, label: "Organización", value: organization.name },
    { icon: Globe2, label: "Slug", value: organization.slug },
    { icon: Clock, label: "Zona horaria", value: organization.timezone },
  ];

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
          General
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Información de la organización. La edición desde acá llegará pronto.
        </p>
      </header>

      <Card className="divide-y">
        {fields.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.label} className="flex items-center gap-3 px-4 py-3">
              <Icon size={16} className="text-muted-foreground shrink-0" />
              <div className="text-xs uppercase tracking-wide text-muted-foreground w-32 shrink-0">
                {f.label}
              </div>
              <div className="text-sm font-medium truncate">
                {f.value ?? "—"}
              </div>
            </div>
          );
        })}
      </Card>
    </section>
  );
}
