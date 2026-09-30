import { Mail } from "lucide-react";
import type { ReservationView } from "@/lib/marketplace/contracts";
import { cn } from "@/lib/utils";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { WhatsAppIcon } from "@/components/marketplace/shell/whatsapp-icon";

type ContactButtonVariant = "primary" | "secondary" | "soft" | "inverse" | "cta";

/** Superficie de la web: papel, borde crema, esquinas de 24 px. */
export function Panel({
  className,
  children,
  labelledBy,
  as: Tag = "section",
}: {
  className?: string;
  children: React.ReactNode;
  labelledBy?: string;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag
      aria-labelledby={labelledBy}
      className={cn("rounded-3xl bg-paper p-5 shadow-apart-sm ring-1 ring-cream-300 sm:p-7", className)}
    >
      {children}
    </Tag>
  );
}

export function PanelTitle({
  id,
  children,
  className,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 id={id} className={cn("text-lg font-extrabold tracking-[-0.01em] text-forest-700 sm:text-xl", className)}>
      {children}
    </h2>
  );
}

/** Fila "ícono + etiqueta + dato" (dirección, check-in, salida). */
export function InfoRow({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3", className)}>
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-t-full rounded-b-md bg-leaf-100 text-forest-700">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500">{label}</p>
        <div className="mt-0.5 text-[0.9375rem] font-semibold leading-snug text-ink-900">{children}</div>
      </div>
    </div>
  );
}

/** Fila de dinero: etiqueta a la izquierda, monto a la derecha (tabular). */
export function MoneyRow({
  label,
  value,
  hint,
  strong = false,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className={cn("min-w-0", strong ? "font-bold text-forest-700" : "text-ink-700")}>
        {label}
        {hint ? <span className="block text-[0.8125rem] font-normal text-ink-500">{hint}</span> : null}
      </dt>
      <dd className={cn("shrink-0 tabular-nums", strong ? "text-lg font-extrabold text-forest-700" : "font-semibold text-ink-900")}>
        {value}
      </dd>
    </div>
  );
}

/** Botón de WhatsApp (abre wa.me en otra pestaña con el mensaje precargado). */
export function WhatsAppButton({
  href,
  children = "Escribinos",
  variant = "primary",
  size = "lg",
  className,
}: {
  href: string;
  children?: React.ReactNode;
  variant?: ContactButtonVariant;
  size?: "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <ApartButton asChild variant={variant} size={size} className={className}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <WhatsAppIcon />
        {children}
        <span className="sr-only"> (se abre WhatsApp)</span>
      </a>
    </ApartButton>
  );
}

/** Botón de mail (mailto con el asunto precargado). */
export function MailButton({
  email,
  subject,
  children = "Escribinos por mail",
  variant = "secondary",
  size = "lg",
  className,
}: {
  email: string;
  subject: string;
  children?: React.ReactNode;
  variant?: ContactButtonVariant;
  size?: "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <ApartButton asChild variant={variant} size={size} className={className}>
      <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}>
        <Mail aria-hidden />
        {children}
      </a>
    </ApartButton>
  );
}

/**
 * Cómo escribirnos: WhatsApp si la organización cargó un número; si no, mail.
 * Sin ninguno de los dos no dibuja nada (nunca un botón que no lleva a ningún
 * lado ni un WhatsApp sin número).
 */
export function ContactButton({
  contact,
  subject,
  whatsappLabel = "Escribinos por WhatsApp",
  mailLabel = "Escribinos por mail",
  variant = "soft",
  size = "lg",
  className,
}: {
  contact: ReservationView["contact"];
  /** Asunto del mail (sólo si se cae a mail). */
  subject: string;
  whatsappLabel?: React.ReactNode;
  mailLabel?: React.ReactNode;
  variant?: ContactButtonVariant;
  size?: "md" | "lg" | "xl";
  className?: string;
}) {
  if (contact.whatsapp_url) {
    return (
      <WhatsAppButton href={contact.whatsapp_url} variant={variant} size={size} className={className}>
        {whatsappLabel}
      </WhatsAppButton>
    );
  }
  if (contact.email) {
    return (
      <MailButton email={contact.email} subject={subject} variant={variant} size={size} className={className}>
        {mailLabel}
      </MailButton>
    );
  }
  return null;
}
