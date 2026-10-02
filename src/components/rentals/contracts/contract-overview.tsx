import Link from "next/link";
import { Building2, Mail, MessageCircle, Phone, ShieldCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { formatDate, getInitials } from "@/lib/format";
import { GUARANTEE_TYPE_LABEL } from "@/lib/rentals/labels";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import { termGroups, type ContractTerms, type TermGroup } from "./contract-terms";
import type { ContractDetailData, ContractPartyView } from "./types";

/** Pestaña "Resumen": partes, propietarios y las condiciones del contrato en castellano. */

export function TermsGrid({ groups }: { groups: TermGroup[] }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.title} className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <span className="h-3.5 w-1 rounded-full" style={{ backgroundColor: RENTALS_ACCENT }} />
            {g.title}
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px rounded-lg border bg-border overflow-hidden">
            {g.rows.map((r) => (
              <div key={`${g.title}-${r.label}`} className="bg-card px-3.5 py-2.5 min-w-0">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</dt>
                <dd className="text-sm font-medium mt-0.5 leading-snug break-words">{r.value}</dd>
                {r.hint && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.hint}</p>}
              </div>
            ))}
            {g.rows.length % 2 === 1 && <div className="hidden sm:block bg-card" />}
          </dl>
        </section>
      ))}
    </div>
  );
}

function ContactLinks({ phone, email }: { phone: string | null; email: string | null }) {
  const wa = phone ? toWhatsappDigits(phone) : "";
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {wa.length >= 8 && (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border px-2 h-8 text-xs hover:bg-accent/40 transition-colors"
          aria-label="Abrir WhatsApp"
        >
          <MessageCircle size={13} className="text-emerald-600" /> WhatsApp
        </a>
      )}
      {phone && (
        <a href={`tel:${phone}`} className="inline-flex items-center gap-1 rounded-md border px-2 h-8 text-xs hover:bg-accent/40 transition-colors">
          <Phone size={13} /> {phone}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className="inline-flex items-center gap-1 rounded-md border px-2 h-8 text-xs hover:bg-accent/40 transition-colors max-w-full">
          <Mail size={13} /> <span className="truncate">{email}</span>
        </a>
      )}
    </div>
  );
}

function PartyCard({ p }: { p: ContractPartyView }) {
  const guarantor = p.role === "garante";
  return (
    <div className="rounded-xl border bg-card p-3.5 min-w-0">
      <div className="flex items-start gap-3">
        <span
          className="size-10 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
          style={guarantor ? undefined : { backgroundColor: `${RENTALS_ACCENT}18`, color: RENTALS_ACCENT }}
        >
          {guarantor ? <ShieldCheck size={16} className="text-muted-foreground" /> : getInitials(p.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/dashboard/alquileres/personas/${p.personId}`} className="text-sm font-medium hover:underline truncate">
              {p.name}
            </Link>
            {p.isPrimary && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium" style={{ color: RENTALS_ACCENT, borderColor: `${RENTALS_ACCENT}55` }}>
                Titular de los recibos
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {guarantor ? (p.guaranteeType ? GUARANTEE_TYPE_LABEL[p.guaranteeType] : "Garante") : "Inquilino"}
            {p.docLabel ? ` · ${p.docLabel}` : ""}
          </p>
          {guarantor && p.guaranteeDetail && <p className="text-xs mt-1 leading-snug">{p.guaranteeDetail}</p>}
          {guarantor && p.consentAt && <p className="text-[11px] text-muted-foreground mt-1">Conformidad para renovar: {formatDate(p.consentAt)}</p>}
          <ContactLinks phone={p.phone} email={p.email} />
        </div>
      </div>
    </div>
  );
}

export function ContractOverview({ detail }: { detail: ContractDetailData }) {
  const c = detail.contract;
  const tenants = detail.parties.filter((p) => p.role === "inquilino");
  const guarantors = detail.parties.filter((p) => p.role === "garante");
  const terms: ContractTerms = c;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="p-4 sm:p-5 gap-4 min-w-0 order-2 lg:order-1">
        <TermsGrid groups={termGroups(terms)} />
        {(c.special_clauses || c.notes || c.early_termination_notes) && (
          <div className="space-y-3 border-t pt-4">
            {c.early_termination_notes && <Note title="Sobre la rescisión" text={c.early_termination_notes} />}
            {c.special_clauses && <Note title="Cláusulas especiales" text={c.special_clauses} />}
            {c.notes && <Note title="Notas internas" text={c.notes} amber />}
          </div>
        )}
      </Card>
      <div className="space-y-4 order-1 lg:order-2 min-w-0">
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <UserRound size={13} /> {tenants.length === 1 ? "Inquilino" : "Inquilinos"}
          </h3>
          {tenants.map((p) => (
            <PartyCard key={`${p.personId}-i`} p={p} />
          ))}
        </section>
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck size={13} /> Garantías
          </h3>
          {guarantors.length ? (
            guarantors.map((p) => <PartyCard key={`${p.personId}-g`} p={p} />)
          ) : (
            <p className="text-xs text-muted-foreground rounded-lg border border-dashed px-3 py-2.5">Sin garantes cargados.</p>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Building2 size={13} /> Propietarios
          </h3>
          <div className="rounded-xl border bg-card divide-y">
            {detail.owners.length ? (
              detail.owners.map((o) => (
                <Link
                  key={o.ownerId}
                  href={`/dashboard/propietarios/${o.ownerId}`}
                  className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-accent/30 transition-colors"
                >
                  <span className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold shrink-0">
                    {getInitials(o.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{o.name}</span>
                    {o.isPrimary && <span className="block text-[11px] text-muted-foreground">Principal</span>}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{o.pct.toLocaleString("es-AR")} %</span>
                </Link>
              ))
            ) : (
              <p className="px-3.5 py-3 text-xs text-muted-foreground">
                La propiedad no tiene propietarios cargados. Agregalos desde la{" "}
                <Link href={`/dashboard/alquileres/propiedades/${detail.property.id}`} className="underline hover:no-underline">
                  ficha de la propiedad
                </Link>
                .
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Note({ title, text, amber }: { title: string; text: string; amber?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className={amber ? "text-sm mt-1 whitespace-pre-wrap text-amber-700 dark:text-amber-300" : "text-sm mt-1 whitespace-pre-wrap"}>{text}</p>
    </div>
  );
}
