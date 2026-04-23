import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Edit,
  MapPin,
  Bed,
  Bath,
  Users,
  Square,
  CalendarRange,
  Wrench,
  ShieldCheck,
} from "lucide-react";
import { getUnit } from "@/lib/actions/units";
import { listOwners } from "@/lib/actions/owners";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnitFormDialog } from "@/components/units/unit-form-dialog";
import { UnitOwnersManager } from "@/components/units/unit-owners-manager";
import { UNIT_STATUS_META } from "@/lib/constants";
import { formatMoney, getInitials } from "@/lib/format";
import type { Unit, UnitOwner, Owner } from "@/lib/types/database";

type UnitDetail = Unit & {
  unit_owners: (UnitOwner & { owner: Owner })[];
};

export default async function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [unit, owners] = await Promise.all([getUnit(id), listOwners()]);
  if (!unit) notFound();
  const u = unit as unknown as UnitDetail;
  const meta = UNIT_STATUS_META[u.status];

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <Link
        href="/dashboard/unidades"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Volver a Unidades
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div
            className="size-16 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-sm"
            style={{ backgroundColor: meta.color }}
          >
            {u.code.slice(0, 3)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{u.name}</h1>
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
              <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-foreground">
                <MapPin size={13} />
                {u.address}
                {u.neighborhood ? `, ${u.neighborhood}` : ""}
              </div>
            )}
          </div>
        </div>
        <UnitFormDialog unit={u}>
          <Button variant="outline" className="gap-2">
            <Edit size={14} /> Editar
          </Button>
        </UnitFormDialog>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: Bed, label: "Dormitorios", value: u.bedrooms ?? "—" },
          { icon: Bath, label: "Baños", value: u.bathrooms ?? "—" },
          { icon: Users, label: "Capacidad", value: u.max_guests ?? "—" },
          { icon: Square, label: "Superficie", value: u.size_m2 ? `${u.size_m2} m²` : "—" },
        ].map((s, i) => (
          <Card key={i} className="p-4 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <s.icon size={16} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
              <div className="font-semibold text-sm">{s.value}</div>
            </div>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="propietarios">Propietarios</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-3">Tarifas</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Precio base / noche</div>
                <div className="font-medium">{formatMoney(u.base_price, u.base_price_currency ?? "ARS")}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Fee limpieza</div>
                <div className="font-medium">{formatMoney(u.cleaning_fee, u.base_price_currency ?? "ARS")}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Comisión Apart Cba</div>
                <div className="font-medium">{u.default_commission_pct ?? 0}%</div>
              </div>
            </div>
          </Card>

          {u.description && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold mb-2">Descripción</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{u.description}</p>
            </Card>
          )}

          {u.notes && (
            <Card className="p-5">
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
