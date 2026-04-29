import { Plus, Building2, Users, Globe, Calendar } from "lucide-react";
import { listAllOrganizations } from "@/lib/actions/superadmin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateOrgDialog } from "@/components/superadmin/create-org-dialog";
import { formatDate } from "@/lib/format";

export default async function SuperadminHome() {
  const orgs = await listAllOrganizations();

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizaciones</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {orgs.length} {orgs.length === 1 ? "organización" : "organizaciones"} en el sistema
          </p>
        </div>
        <CreateOrgDialog>
          <Button className="gap-2">
            <Plus size={16} /> Nueva organización
          </Button>
        </CreateOrgDialog>
      </div>

      {orgs.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Building2 className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Sin organizaciones</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {orgs.map((o) => (
            <Card key={o.id} className="p-5 hover:shadow-md hover:border-primary/30 transition-all">
              <div className="flex items-start gap-3">
                <div
                  className="size-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm shrink-0"
                  style={{ backgroundColor: o.primary_color ?? "#0F766E" }}
                >
                  {o.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{o.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">/{o.slug}</div>
                  {!o.active && <Badge variant="destructive" className="mt-2 text-[10px]">Inactiva</Badge>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-border/50 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1"><Users size={11} /> {o.member_count}</div>
                <div className="flex items-center gap-1"><Globe size={11} /> {o.default_currency}</div>
                <div className="flex items-center gap-1"><Calendar size={11} /> {formatDate(o.created_at, "MMM yyyy")}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
