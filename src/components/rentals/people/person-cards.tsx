import Link from "next/link";
import { BriefcaseBusiness, FileText, KeyRound, Mail, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { CONTRACT_STATE_META, GUARANTEE_TYPE_LABEL, formatContractNumber } from "@/lib/rentals/labels";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import type { RentalPerson } from "@/lib/types/database";
import { Money, StatusBadge } from "@/components/rentals/ui";
import { CopyButton } from "@/components/rentals/properties/copy-button";
import { BalanceLine } from "@/components/rentals/properties/property-card";
import { INCOME_COVERAGE_TARGET, coverageTone, docLabel, formatDocNumber, incomeCoverage } from "./person-helpers";
import type { PersonContractLink } from "./person-types";

const ACTION = "inline-flex items-center gap-1.5 h-9 rounded-lg border bg-card px-3 text-sm hover:bg-accent/40 transition-colors";

/** Botones de contacto grandes (WhatsApp, llamar, mail). */
export function ContactButtons({ person }: { person: RentalPerson }) {
  const wa = toWhatsappDigits(person.phone);
  if (!wa && !person.phone && !person.email) {
    return <p className="text-xs text-muted-foreground">Sin teléfono ni mail cargados.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {wa && (
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className={cn(ACTION, "text-emerald-700 dark:text-emerald-400 border-emerald-500/30")}>
          <MessageCircle size={14} /> WhatsApp
        </a>
      )}
      {person.phone && (
        <a href={`tel:${person.phone}`} className={ACTION}>
          <Phone size={14} /> <span className="tabular-nums">{person.phone}</span>
        </a>
      )}
      {person.email && (
        <a href={`mailto:${person.email}`} className={cn(ACTION, "min-w-0 max-w-full")}>
          <Mail size={14} className="shrink-0" /> <span className="truncate">{person.email}</span>
        </a>
      )}
    </div>
  );
}

function ageOf(birth: string, today: string): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

function Item({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card px-4 py-3 min-w-0", className)}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium mt-0.5 leading-snug break-words">{children}</dd>
    </div>
  );
}

/** Datos personales en grilla de líneas finas (estilo documento). */
export function PersonDataCard({ person: p, today }: { person: RentalPerson; today: string }) {
  const juridica = p.person_type === "juridica";
  const doc = docLabel(p.doc_type, p.doc_number);
  const cuit = p.tax_id ? formatDocNumber("CUIT", p.tax_id) : null;
  // Una empresa tiene un solo número (CUIT); a una persona con CUIT/CUIL como
  // documento tampoco se lo mostramos dos veces.
  const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
  const sameNumber = !!p.tax_id && digits(p.tax_id) === digits(p.doc_number);
  const singleId = juridica || sameNumber;
  const idValue = juridica ? (p.tax_id ?? p.doc_number) : p.doc_number;
  // La etiqueta ya dice "CUIT": el valor va sin prefijo.
  const idText = juridica ? (cuit ?? formatDocNumber(p.doc_type, p.doc_number)) : doc;
  return (
    <Card className="p-0 gap-0 overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <FileText size={15} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">{juridica ? "Datos de la empresa" : "Datos personales"}</h2>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-border">
        <Item label={juridica ? "CUIT" : "Documento"} className={singleId ? "col-span-2" : undefined}>
          {idText ? (
            <span className="flex items-center gap-1">
              <span className="tabular-nums">{idText}</span>
              {idValue && <CopyButton value={idValue} label={juridica ? "CUIT" : "Documento"} className="size-7 -my-1" />}
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">—</span>
          )}
        </Item>
        {!singleId && <Item label="CUIT / CUIL">{cuit ?? <span className="text-muted-foreground font-normal">—</span>}</Item>}
        {p.person_type === "fisica" && (
          <Item label="Nacimiento">
            {p.birth_date ? `${formatDate(p.birth_date)} (${ageOf(p.birth_date, today)} años)` : <span className="text-muted-foreground font-normal">—</span>}
          </Item>
        )}
        {p.person_type === "fisica" && <Item label="Nacionalidad">{p.nationality || <span className="text-muted-foreground font-normal">—</span>}</Item>}
        <Item label={p.person_type === "juridica" ? "Domicilio legal" : "Domicilio"} className="col-span-2">
          {[p.address, p.city, p.province].filter(Boolean).join(", ") || <span className="text-muted-foreground font-normal">—</span>}
        </Item>
        {p.phone_alt && <Item label="Otro teléfono" className="col-span-2">{p.phone_alt}</Item>}
      </dl>
    </Card>
  );
}

/** Trabajo, ingresos y cuánto cubren el alquiler de sus contratos vigentes. */
export function WorkIncomeCard({ person: p, links }: { person: RentalPerson; links: PersonContractLink[] }) {
  const live = links.filter((l) => l.status === "vigente");
  const coverage = live
    .filter((l) => (p.income_currency ?? "ARS") === l.currency)
    .map((l) => ({ link: l, ratio: incomeCoverage(p.monthly_income, l.current_rent) }))
    .filter((x) => x.ratio != null);
  const empty = !p.occupation && !p.employer && p.monthly_income == null;
  return (
    <Card className="p-4 sm:p-5 gap-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <BriefcaseBusiness size={15} className="text-muted-foreground" /> {p.person_type === "juridica" ? "Actividad e ingresos" : "Trabajo e ingresos"}
      </h2>
      {empty ? (
        <p className="text-xs text-muted-foreground leading-snug">
          {p.person_type === "juridica"
            ? "Sin datos de actividad. Para evaluar a una empresa conviene cargar a qué se dedica y cuánto factura por mes."
            : "Sin datos laborales. Para un garante con recibo de sueldo conviene cargar empleador e ingresos."}
        </p>
      ) : (
        <dl className="space-y-2.5 text-sm">
          {p.occupation && (
            <div>
              <dt className="text-[11px] text-muted-foreground">{p.person_type === "juridica" ? "Actividad" : "Ocupación"}</dt>
              <dd className="font-medium">{p.occupation}</dd>
            </div>
          )}
          {p.employer && (
            <div>
              <dt className="text-[11px] text-muted-foreground">Dónde trabaja</dt>
              <dd className="font-medium">
                {p.employer}
                {p.employer_phone && (
                  <a href={`tel:${p.employer_phone}`} className="ml-2 text-xs font-normal text-muted-foreground hover:text-foreground">
                    {p.employer_phone}
                  </a>
                )}
              </dd>
            </div>
          )}
          {p.monthly_income != null && (
            <div>
              <dt className="text-[11px] text-muted-foreground">Ingresos mensuales</dt>
              <dd>
                <Money amount={p.monthly_income} currency={p.income_currency ?? "ARS"} className="text-lg font-semibold" />
              </dd>
            </div>
          )}
        </dl>
      )}
      {coverage.length > 0 && (
        <ul className="space-y-1.5 border-t pt-3">
          {coverage.map(({ link, ratio }) => {
            const tone = coverageTone(ratio);
            return (
              <li key={`${link.contract_id}-${link.role}`} className="text-xs leading-snug">
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    tone === "ok" && "text-emerald-700 dark:text-emerald-400",
                    tone === "warn" && "text-amber-700 dark:text-amber-300",
                    tone === "low" && "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {ratio?.toLocaleString("es-AR")} veces
                </span>{" "}
                <span className="text-muted-foreground">
                  el alquiler {link.role === "garante" ? "que garantiza" : ""} en {link.property?.address ?? formatContractNumber(link.number)}
                  {tone !== "ok" ? ` (lo habitual es ${INCOME_COVERAGE_TARGET} o más)` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ContractRow({ link }: { link: PersonContractLink }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {link.property ? (
              <Link href={`/dashboard/alquileres/propiedades/${link.property.id}`} className="text-sm font-medium hover:underline underline-offset-2 truncate">
                {link.property.address}
              </Link>
            ) : (
              <span className="text-sm font-medium">Propiedad</span>
            )}
            <StatusBadge meta={CONTRACT_STATE_META[link.display_state]} compact />
          </div>
          <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-1.5">
            <Link href={`/dashboard/alquileres/contratos/${link.contract_id}`} className="font-mono hover:text-foreground">
              {formatContractNumber(link.number)}
            </Link>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {formatDate(link.start_date)} → {formatDate(link.end_date)}
            </span>
            {link.role === "garante" && link.tenant_name && (
              <>
                <span aria-hidden>·</span>
                <span>Inquilino: {link.tenant_name}</span>
              </>
            )}
            {link.role === "garante" && link.guarantee_type && (
              <>
                <span aria-hidden>·</span>
                <span>{GUARANTEE_TYPE_LABEL[link.guarantee_type]}</span>
              </>
            )}
            {link.role === "inquilino" && !link.is_primary && (
              <>
                <span aria-hidden>·</span>
                <span>Co-inquilino</span>
              </>
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <Money amount={link.current_rent} currency={link.currency} className="text-sm font-semibold" />
          {link.status === "vigente" && (
            <div>
              <BalanceLine balance={link.balance} overdue={link.overdue} currency={link.currency} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Contratos de la persona, separados por rol. */
export function PersonContractsCard({ links }: { links: PersonContractLink[] }) {
  const asTenant = links.filter((l) => l.role === "inquilino");
  const asGuarantor = links.filter((l) => l.role === "garante");
  return (
    <Card className="p-4 sm:p-5 gap-4">
      <h2 className="text-sm font-semibold">Contratos</h2>
      {!links.length && (
        <p className="text-sm text-muted-foreground">Todavía no figura en ningún contrato. Se suma al cargar un contrato (como inquilino o garante).</p>
      )}
      {asTenant.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <KeyRound size={12} /> Como inquilino
          </h3>
          <ul className="divide-y">{asTenant.map((l) => <ContractRow key={`${l.contract_id}-t`} link={l} />)}</ul>
        </section>
      )}
      {asGuarantor.length > 0 && (
        <section className={cn("space-y-2", asTenant.length > 0 && "border-t pt-4")}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck size={12} /> Como garante
          </h3>
          <ul className="divide-y">{asGuarantor.map((l) => <ContractRow key={`${l.contract_id}-g`} link={l} />)}</ul>
        </section>
      )}
    </Card>
  );
}
