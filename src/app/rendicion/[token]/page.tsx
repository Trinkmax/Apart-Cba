import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { getPublicStatement } from "@/lib/actions/rentals-statements";
import { formatDate } from "@/lib/format";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import { StatementDocument } from "@/components/rentals/statements/statement-document";
import { StatementPdfButton } from "@/components/rentals/statements/statement-pdf-button";

// El token no puede filtrarse por Referer (WhatsApp, mapas…) ni quedar indexado.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Rendición",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

export default async function PublicStatementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getPublicStatement(token);
  if (!data) notFound();
  const { model, branding, orgContact } = data;
  const brand = branding.primary_color && /^#[0-9a-f]{6}$/i.test(branding.primary_color) ? branding.primary_color : "#0F766E";
  const wa = toWhatsappDigits(orgContact.phone);

  return (
    <div className="min-h-dvh bg-muted/30 px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {branding.logo_url ? (
              <span className="flex h-11 shrink-0 items-center rounded-xl px-2.5" style={{ backgroundColor: brand }}>
                <Image src={branding.logo_url} alt={branding.name} width={88} height={32} unoptimized className="h-7 w-auto max-w-[110px] object-contain" />
              </span>
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: brand }}>
                {branding.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{branding.name}</div>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Tu rendición · {model.periodLabel}</h1>
            </div>
          </div>
          <StatementPdfButton model={model} branding={branding} />
        </header>

        <p className="text-sm text-muted-foreground">
          Hola {firstName(model.owner.full_name)}, este es el detalle de lo que cobramos por tus propiedades hasta el {formatDate(model.cutoffDate)}, lo que
          descontamos y {model.totals.net < 0 ? "el saldo que quedó a tu cargo" : "lo que te queda"}.
        </p>

        <StatementDocument model={model} brandColor={brand} orgName={branding.name} audience="owner" />

        {(orgContact.email || orgContact.phone) && (
          <div className="rounded-xl border bg-card p-4 text-sm">
            <p className="font-medium">¿Algo no te cierra?</p>
            <p className="mt-0.5 text-muted-foreground">Escribinos y lo revisamos con vos.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {wa && (
                <a
                  href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hola, te escribo por la rendición N° ${model.number}.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 font-medium transition-colors hover:bg-accent"
                >
                  <MessageCircle size={15} className="text-emerald-600" /> WhatsApp
                </a>
              )}
              {orgContact.phone && (
                <a href={`tel:${orgContact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 font-medium transition-colors hover:bg-accent">
                  <Phone size={15} /> Llamar
                </a>
              )}
              {orgContact.email && (
                <a
                  href={`mailto:${orgContact.email}?subject=${encodeURIComponent(`Rendición N° ${model.number}`)}`}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 font-medium transition-colors hover:bg-accent"
                >
                  <Mail size={15} /> {orgContact.email}
                </a>
              )}
            </div>
          </div>
        )}

        <p className="pt-2 text-center text-xs text-muted-foreground">Documento de solo lectura · Rendición N° {model.number}</p>
      </div>
    </div>
  );
}
