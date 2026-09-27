import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  Bed,
  Bath,
  Users,
  Square,
  DollarSign,
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
import { UNIT_DEFAULT_MODE_META, UNIT_STATUS_META } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { unitMonthlyPrice, unitPriceKinds } from "@/lib/units/pricing";
import { cn } from "@/lib/utils";
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
  // Mantenimiento y limpieza entran a la ficha (units: view) pero no la
  // editan: sin esto veían "Editar" y el guardado recién se frenaba en el
  // servidor.
  const canEditUnit = can(role, "units", "update");
  // Cada vocación muestra sus precios (migraciones 063 y 066): temporaria →
  // noche, mensual → mes, mixta → los dos. La noche de una mensual queda en la
  // base sólo para la web pública: acá no describe la unidad. El mes se lee
  // por el helper para no mostrar un valor viejo de una unidad que cambió de
  // vocación.
  const priceKinds = unitPriceKinds(u.default_mode);
  const monthlyPrice = unitMonthlyPrice(u);
  const modeMeta = UNIT_DEFAULT_MODE_META[u.default_mode] ?? UNIT_DEFAULT_MODE_META.temporario;
  const currency = u.base_price_currency ?? "ARS";

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
          {/* Mismo corte que la tarjeta "Tarifas" y que la propia pantalla de
              precios: sin permiso de ver plata el botón llevaba a un rebote. */}
          {canViewMoney && (
            <Link
              href={`/dashboard/unidades/${u.id}/precios`}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <DollarSign size={14} />
              Tarifas
            </Link>
          )}
          {canEditUnit && <EditUnitButton unit={u} />}
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
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold">Tarifas</h2>
                {/* La vocación va en todas: es la que decide qué precios lleva
                    la tarjeta (una mensual sin "Precio / noche" no es un olvido). */}
                <Badge
                  variant="outline"
                  className="gap-1.5 font-normal text-[10px] text-muted-foreground"
                  title={modeMeta.description}
                >
                  <span className="status-dot" style={{ backgroundColor: modeMeta.color }} />
                  {modeMeta.label}
                </Badge>
              </div>
              {/* Mixta: 4 celdas. Hasta lg van de a 2 para que los dos precios
                  queden juntos en la primera fila y "Comisión de administración"
                  no se parta en una columna angosta (el sidebar come ancho).
                  Temporaria y mensual: 3 celdas, un solo precio. */}
              <div
                className={cn(
                  "grid grid-cols-2 gap-3 sm:gap-4 text-sm",
                  priceKinds.nightly && priceKinds.monthly ? "lg:grid-cols-4" : "sm:grid-cols-3",
                )}
              >
                {priceKinds.nightly && (
                  <div>
                    <div className="text-xs text-muted-foreground">Precio / noche</div>
                    <div className="font-medium">{formatMoney(u.base_price, currency)}</div>
                  </div>
                )}
                {priceKinds.monthly && (
                  <div>
                    <div className="text-xs text-muted-foreground">Precio / mes</div>
                    {monthlyPrice !== null ? (
                      <div className="font-medium">{formatMoney(monthlyPrice, currency)}</div>
                    ) : (
                      // "Sin cargar" y no "—": una mensual o mixta sin precio
                      // mensual es un dato faltante que el operador tiene que
                      // ver, no un cero.
                      <div className="font-medium text-muted-foreground italic">Sin cargar</div>
                    )}
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground">Fee limpieza</div>
                  <div className="font-medium">{formatMoney(u.cleaning_fee, currency)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Comisión de administración</div>
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
            unitDefaultCommissionPct={u.default_commission_pct}
            canEdit={can(role, "units", "update")}
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
