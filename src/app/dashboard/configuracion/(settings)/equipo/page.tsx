import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { listTeamMembers } from "@/lib/actions/team";
import { getCurrentOrg } from "@/lib/actions/org";
import { isAdminLevel } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { InviteDialog } from "@/components/team/invite-dialog";
import { TeamMemberActions } from "@/components/team/team-member-actions";
import { ROLE_META } from "@/lib/constants";
import { getInitials, formatTimeAgo } from "@/lib/format";

export default async function EquipoPage() {
  // Los perfiles del equipo incluyen datos personales sensibles (DNI, CUIT,
  // domicilio, contacto de emergencia…): solo admin/recepción pueden verlos.
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) redirect("/dashboard");

  const members = await listTeamMembers();

  return (
    <section className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
            Equipo y permisos
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {members.length} {members.length === 1 ? "miembro" : "miembros"} en esta organización
          </p>
        </div>
        <InviteDialog orgName={organization.name}>
          <Button className="gap-2"><UserPlus size={16} /> Invitar usuario</Button>
        </InviteDialog>
      </header>

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
                    {/* `joined_at` se setea al insertar la membresía: decía "se unió"
                        de gente que nunca había podido entrar. El único dato honesto
                        es el último ingreso real de auth.users. */}
                    {m.active && !m.last_sign_in_at && (
                      <Badge className="text-[10px] font-normal border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        Invitado · nunca ingresó
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{m.email ?? "—"}</div>
                  {m.profile?.job_title && (
                    <div className="text-xs text-muted-foreground">{m.profile.job_title}</div>
                  )}
                  {m.active && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {m.last_sign_in_at
                        ? `Último ingreso ${formatTimeAgo(m.last_sign_in_at)}`
                        : "Pasale el acceso desde el menú ⋯"}
                    </div>
                  )}
                </div>
                <Badge
                  className="font-normal"
                  style={{ color: roleMeta.color, backgroundColor: roleMeta.color + "15", borderColor: roleMeta.color + "30" }}
                >
                  {roleMeta.label}
                </Badge>
                <TeamMemberActions member={m} orgName={organization.name} />
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
