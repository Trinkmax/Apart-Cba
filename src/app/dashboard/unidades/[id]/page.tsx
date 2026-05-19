import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  Bed,
  Bath,
  Users,
  Square,
} from "lucide-react";
import { getUnit } from "@/lib/actions/units";
import { listOwners } from "@/lib/actions/owners";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditUnitButton } from "@/components/units/edit-unit-button";
import { UnitOwnersManager } from "@/components/units/unit-owners-manager";
import { UNIT_STATUS_META } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import type { Unit, UnitOwner, Owner } from "@/lib/types/database";

type UnitDetail = Unit & {
  unit_owners: (UnitOwner & { owner: Owner })[];
};

export default async function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [unit, owners, { role }] = await Promise.all([
    getUnit(id),
    listOwners(),
    getCurrentOrg(),
  ]);
  if (!unit) notFound();
  const u = unit as unknown as UnitDetail;
  const meta = UNIT_STATUS_META[u.status];
  const canViewMoney = can(role, "payments", "view");

  return (
    <div className="page-x page-y max-w-5xl mx-auto space-y-4 sm:space-y-5 md:space-y-6">
      <Link
        href="/dashboard/unidades"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Volver
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <div
            className="size-12 sm:size-16 rounded-xl flex items-center justify-center text-white font-bold text-base sm:text-xl shadow-sm shrink-0"
            style={{ backgroundColor: meta.color }}
          >
            {u.code.slice(0, 3)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{u.name}</h1>
              <Badge variant="outline" className="font-mono">{u.code}</Badge>
            </div>
            <Badge
              className="mt-2 gap-1.5 font-normal"
              style={{ color: meta.color, backgroundColor: meta.color + "15", borderColor: meta.color + "30" }}
            >
              <span className="status-dot" style={{ backgroundColor: meta.color }} />
              {meta.label}
            </Badge>
            {u.address && (
              <div className="flex items-start gap-1.5 mt-2 text-xs sm:text-sm text-muted-foreground">
                <MapPin size={13} className="mt-0.5 shrink-0" />
                <span>
                  {u.address}
                  {u.neighborhood ? `, ${u.neighborhood}` : ""}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <Link
            href={`/dashboard/unidades/${u.id}/marketplace`}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium bg-gradient-to-r from-sage-500 to-sage-600 text-white hover:from-sage-600 hover:to-sage-700 transition-all shadow-sm"
          >
            ✨ Marketplace rentOS
            {u.marketplace_published ? (
              <span className="ml-1 inline-flex items-center gap-1 text-[10px] bg-white/25 px-1.5 py-0.5 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                Live
              </span>
            ) : null}
          </Link>
          <EditUnitButton unit={u} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          { icon: Bed, label: "Dormitorios", value: u.bedrooms ?? "—" },
          { icon: Bath, label: "Baños", value: u.bathrooms ?? "—" },
          { icon: Users, label: "Capacidad", value: u.max_guests ?? "—" },
          { icon: Square, label: "Superficie", value: u.size_m2 ? `${u.size_m2} m²` : "—" },
        ].map((s, i) => (
          <Card key={i} className="p-3 sm:p-4 flex items-center gap-2.5 sm:gap-3">
            <div className="size-8 sm:size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <s.icon size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground truncate">{s.label}</div>
              <div className="font-semibold text-sm truncate">{s.value}</div>
            </div>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="general">
        <TabsList className="overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0 max-w-full justify-start">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="propietarios">Propietarios</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          {canViewMoney && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-sm font-semibold mb-3">Tarifas</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Precio / noche</div>
                  <div className="font-medium">{formatMoney(u.base_price, u.base_price_currency ?? "ARS")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Fee limpieza</div>
                  <div className="font-medium">{formatMoney(u.cleaning_fee, u.base_price_currency ?? "ARS")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Comisión</div>
                  <div className="font-medium">{u.default_commission_pct ?? 0}%</div>
                </div>
              </div>
            </Card>
          )}

          {u.description && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-sm font-semibold mb-2">Descripción</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{u.description}</p>
            </Card>
          )}

          {u.notes && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-sm font-semibold mb-2">Notas internas</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{u.notes}</p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="propietarios" className="mt-4">
          <UnitOwnersManager
            unitId={u.id}
            unitOwners={u.unit_owners}
            availableOwners={owners}
          />
        </TabsContent>

        <TabsContent value="historial" className="mt-4">
          <Card className="p-12 text-center text-sm text-muted-foreground">
            Historial de cambios próximamente
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
