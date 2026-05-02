import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Edit,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Building2,
  FileText,
} from "lucide-react";
import { getOwnerWithUnits } from "@/lib/actions/owners";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { OwnerFormDialog } from "@/components/owners/owner-form-dialog";
import { UNIT_STATUS_META } from "@/lib/constants";
import { getInitials } from "@/lib/format";
import type { Owner, Unit, UnitOwner, UnitStatus } from "@/lib/types/database";

type OwnerWithUnits = Owner & {
  unit_owners: (UnitOwner & {
    unit: Pick<Unit, "id" | "code" | "name" | "status">;
  })[];
};

export default async function OwnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = (await getOwnerWithUnits(id)) as OwnerWithUnits | null;
  if (!owner) notFound();

  const totalOwnership = owner.unit_owners.reduce((acc, uo) => acc + Number(uo.ownership_pct), 0);

  return (
    <div className="page-x page-y max-w-5xl mx-auto space-y-4 sm:space-y-5 md:space-y-6">
      <Link
        href="/dashboard/propietarios"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Volver
      </Link>

      <div className="flex items-start gap-3 sm:gap-5 flex-wrap">
        <Avatar className="size-14 sm:size-20 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary text-lg sm:text-2xl font-semibold">
            {getInitials(owner.full_name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold truncate">{owner.full_name}</h1>
          {owner.document_number && (
            <p className="text-xs sm:text-sm text-muted-foreground">
              {owner.document_type ?? "Doc"}: {owner.document_number}
            </p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2 sm:mt-3 text-xs sm:text-sm">
            {owner.email && (
              <a href={`mailto:${owner.email}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground tap min-w-0">
                <Mail size={13} className="shrink-0" /> <span className="truncate">{owner.email}</span>
              </a>
            )}
            {owner.phone && (
              <a href={`tel:${owner.phone}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground tap">
                <Phone size={13} /> {owner.phone}
              </a>
            )}
            {owner.address && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground min-w-0">
                <MapPin size={13} className="shrink-0" /> <span className="truncate">{owner.address}{owner.city ? `, ${owner.city}` : ""}</span>
              </span>
            )}
          </div>
        </div>
        <OwnerFormDialog owner={owner}>
          <Button variant="outline" className="gap-2">
            <Edit size={14} /> Editar
          </Button>
        </OwnerFormDialog>
      </div>

      <Separator />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="size-4 text-muted-foreground" />
            <h2 className="font-medium">Unidades ({owner.unit_owners.length})</h2>
            {totalOwnership > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {totalOwnership.toFixed(0)}% total
              </Badge>
            )}
          </div>
          {owner.unit_owners.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Este propietario no tiene unidades asignadas
            </div>
          ) : (
            <div className="space-y-2">
              {owner.unit_owners.map((uo) => {
                const meta = UNIT_STATUS_META[uo.unit.status as UnitStatus];
                return (
                  <Link
                    key={uo.unit.id}
                    href={`/dashboard/unidades/${uo.unit.id}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="status-dot" style={{ backgroundColor: meta.color }} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{uo.unit.code} · {uo.unit.name}</div>
                        <div className="text-xs text-muted-foreground">{meta.label}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">{Number(uo.ownership_pct).toFixed(0)}%</Badge>
                      {uo.is_primary && (
                        <Badge className="bg-primary/15 text-primary hover:bg-primary/20">Principal</Badge>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="size-4 text-muted-foreground" />
            <h2 className="font-medium">Datos bancarios</h2>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Banco</dt>
              <dd className="font-medium">{owner.bank_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cobra en</dt>
              <dd className="font-medium">{owner.preferred_currency ?? "ARS"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">CBU</dt>
              <dd className="font-mono text-xs break-all">{owner.cbu ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Alias CBU</dt>
              <dd className="font-mono text-xs">{owner.alias_cbu ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        {owner.notes && (
          <Card className="p-5 lg:col-span-3">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="size-4 text-muted-foreground" />
              <h2 className="font-medium">Notas</h2>
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{owner.notes}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
