import { UserPlus, Users } from "lucide-react";
import { listTeamMembers } from "@/lib/actions/team";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { InviteDialog } from "@/components/team/invite-dialog";
import { TeamMemberActions } from "@/components/team/team-member-actions";
import { ROLE_META } from "@/lib/constants";
import { getInitials, formatTimeAgo } from "@/lib/format";

export default async function EquipoPage() {
  const members = await listTeamMembers();

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="size-5 text-primary" />
            Equipo y permisos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {members.length} {members.length === 1 ? "miembro" : "miembros"} en esta organización
          </p>
        </div>
        <InviteDialog>
          <Button className="gap-2"><UserPlus size={16} /> Invitar usuario</Button>
        </InviteDialog>
      </div>

      <Card className="overflow-hidden">
        <div className="divide-y">
          {members.map((m) => {
            const roleMeta = ROLE_META[m.role];
            return (
              <div key={m.id} className="flex items-center gap-4 p-4 hover:bg-accent/30 transition-colors">
                <Avatar className="size-11">
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                    {getInitials(m.profile?.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{m.profile?.full_name ?? "—"}</span>
                    {!m.active && <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{m.email ?? "—"}</div>
                  {m.joined_at && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Se unió {formatTimeAgo(m.joined_at)}
                    </div>
                  )}
                </div>
                <Badge
                  className="font-normal"
                  style={{ color: roleMeta.color, backgroundColor: roleMeta.color + "15", borderColor: roleMeta.color + "30" }}
                >
                  {roleMeta.label}
                </Badge>
                <TeamMemberActions member={m} />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
