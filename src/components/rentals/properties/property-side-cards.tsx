import Link from "next/link";
import { Building2, CheckCircle2, FileSignature, History, Mail, MessageCircle, Phone, Star, Users, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate, getInitials } from "@/lib/format";
import { SERVICE_KIND_META } from "@/lib/rentals/labels";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import type { RentalProperty } from "@/lib/types/database";
import { CopyButton } from "./copy-button";
import { ServiceIcon, SERVICE_TINT } from "./service-icon";
import type { PropertyEventView, PropertyOwnerView } from "./property-types";

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </h2>
  );
}

export function OwnersCard({ owners }: { owners: PropertyOwnerView[] }) {
  return (
    <Card className="p-4 sm:p-5 gap-3">
      <CardTitle icon={<Users size={15} />}>Propietarios</CardTitle>
      {!owners.length ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">Sin propietario cargado: hace falta para activar un contrato y rendir.</p>
      ) : (
        <ul className="space-y-3">
          {owners.map((o) => {
            const wa = toWhatsappDigits(o.phone);
            return (
              <li key={o.owner_id} className="space-y-1.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold shrink-0">
                    {getInitials(o.full_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/propietarios/${o.owner_id}`} className="text-sm font-medium hover:underline underline-offset-2 truncate block">
                      {o.full_name}
                    </Link>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      {o.is_primary && <Star size={10} className="fill-amber-400 text-amber-400" />}
                      {o.is_primary ? "Titular principal" : "Cotitular"}
                    </span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{o.ownership_pct.toLocaleString("es-AR")} %</span>
                </div>
                {owners.length > 1 && (
                  <div className="h-1 rounded-full bg-muted overflow-hidden ml-[2.625rem]">
                    <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.min(100, o.ownership_pct)}%` }} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1 ml-[2.625rem]">
                  {wa && (
                    <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40">
                      <MessageCircle size={12} /> WhatsApp
                    </a>
                  )}
                  {o.email && (
                    <a href={`mailto:${o.email}`} className="inline-flex items-center gap-1 h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 min-w-0">
                      <Mail size={12} /> <span className="truncate max-w-[10rem]">{o.email}</span>
                    </a>
                  )}
                </div>
                {(o.alias_cbu || o.cbu) && (
                  <div className="ml-[2.625rem] rounded-lg bg-muted/40 border px-2.5 py-1.5 space-y-0.5">
                    {o.alias_cbu && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-10 shrink-0">Alias</span>
                        <span className="font-mono truncate flex-1">{o.alias_cbu}</span>
                        <CopyButton value={o.alias_cbu} label="Alias" className="size-7" />
                      </div>
                    )}
                    {o.cbu && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-10 shrink-0">CBU</span>
                        <span className="font-mono truncate flex-1">{o.cbu}</span>
                        <CopyButton value={o.cbu} label="CBU" className="size-7" />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function ServicesCard({ services }: { services: RentalProperty["services"] }) {
  return (
    <Card className="p-4 sm:p-5 gap-3">
      <CardTitle icon={<Zap size={15} />}>Servicios e impuestos</CardTitle>
      {!services.length ? (
        <p className="text-xs text-muted-foreground leading-snug">Sin cuentas cargadas. Con “Editar” sumás EPEC, Ecogas, Aguas Cordobesas, Municipalidad o Rentas.</p>
      ) : (
        <ul className="space-y-2">
          {services.map((s, i) => (
            <li key={`${s.kind}-${i}`} className="flex items-center gap-2.5 min-w-0">
              <span className={cn("size-8 rounded-lg flex items-center justify-center shrink-0", SERVICE_TINT[s.kind])}>
                <ServiceIcon kind={s.kind} size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">
                  {SERVICE_KIND_META[s.kind]?.label ?? "Servicio"}
                  {s.provider && <span className="text-muted-foreground"> · {s.provider}</span>}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {s.account_number ? <span className="font-mono">{s.account_number}</span> : "Sin número de cuenta"}
                  {s.holder ? ` · ${s.holder}` : ""}
                </p>
              </div>
              {s.account_number && <CopyButton value={s.account_number} label="Número de cuenta" />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ConsortiumCard({ property: p }: { property: RentalProperty }) {
  if (!p.consortium_name && !p.consortium_phone && !p.consortium_email && !p.functional_unit && !p.cadastral_id) return null;
  const wa = toWhatsappDigits(p.consortium_phone);
  return (
    <Card className="p-4 sm:p-5 gap-3">
      <CardTitle icon={<Building2 size={15} />}>Consorcio y catastro</CardTitle>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
        {p.consortium_name && (
          <div className="col-span-2 min-w-0">
            <dt className="text-[11px] text-muted-foreground">Administración</dt>
            <dd className="font-medium truncate">{p.consortium_name}</dd>
          </div>
        )}
        {p.functional_unit && (
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">Unidad funcional</dt>
            <dd className="font-medium">{p.functional_unit}</dd>
          </div>
        )}
        {p.cadastral_id && (
          <div className="min-w-0 col-span-2">
            <dt className="text-[11px] text-muted-foreground">Catastro / cuenta de Rentas</dt>
            <dd className="flex items-center gap-1 min-w-0">
              <span className="font-mono text-xs truncate">{p.cadastral_id}</span>
              <CopyButton value={p.cadastral_id} label="Catastro" className="size-7" />
            </dd>
          </div>
        )}
      </dl>
      {(p.consortium_phone || p.consortium_email) && (
        <div className="flex flex-wrap gap-1 -ml-2">
          {p.consortium_phone && (
            <a href={`tel:${p.consortium_phone}`} className="inline-flex items-center gap-1 h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40">
              <Phone size={12} /> {p.consortium_phone}
            </a>
          )}
          {wa && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40">
              <MessageCircle size={12} /> WhatsApp
            </a>
          )}
          {p.consortium_email && (
            <a href={`mailto:${p.consortium_email}`} className="inline-flex items-center gap-1 h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 min-w-0">
              <Mail size={12} /> <span className="truncate max-w-[12rem]">{p.consortium_email}</span>
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

/** Mandato de administración (Ley 9445): firmado o pendiente. */
export function MandateCard({ property: p }: { property: RentalProperty }) {
  const signed = Boolean(p.mandate_signed_at);
  return (
    <Card className={cn("p-4 sm:p-5 gap-2", !signed && "border-amber-500/30 bg-amber-500/[0.04]")}>
      <CardTitle icon={<FileSignature size={15} />}>Mandato de administración</CardTitle>
      {signed ? (
        <p className="text-sm flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={14} /> Firmado el {formatDate(p.mandate_signed_at)}
        </p>
      ) : (
        <p className="text-sm text-amber-800 dark:text-amber-200 leading-snug">
          Sin fecha cargada. La Ley 9445 pide el mandato escrito del dueño para administrar: cargá la fecha con “Editar” y subí el documento abajo.
        </p>
      )}
    </Card>
  );
}

/** "12/10/2026 14:30" en la zona de la org (el servidor corre en UTC). */
function formatStamp(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function PropertyEventsCard({ events, tz }: { events: PropertyEventView[]; tz: string }) {
  if (!events.length) return null;
  return (
    <Card className="p-4 sm:p-5 gap-3">
      <CardTitle icon={<History size={15} />}>Historial</CardTitle>
      <ol className="relative border-l border-border/60 ml-1.5 space-y-3 pl-4">
        {events.slice(0, 8).map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-card bg-teal-600/70" />
            <p className="text-xs leading-snug">{e.summary}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {e.actor_name ? `${e.actor_name} · ` : ""}
              {formatStamp(e.created_at, tz)}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
