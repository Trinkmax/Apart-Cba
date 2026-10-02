import { getInitials } from "@/lib/format";
import { PortalContactCard, PortalContractCard, PortalPaymentsCard } from "./portal-history-cards";
import { PortalHowToPay, PortalPaymentCard, PortalReports } from "./portal-payment-card";
import { PortalProofsCard } from "./portal-proofs-card";
import { readableTextOn } from "./portal-helpers";
import type { TenantPortalView } from "./portal-types";

/**
 * Portal del inquilino: una sola columna pensada para el celular, con la
 * marca de la inmobiliaria. Orden = lo que la persona viene a hacer: cuánto
 * debe y cómo pagarlo, subir lo que falta, bajar recibos, entender su contrato.
 * Siempre en modo claro (la clase `light` fija los tokens).
 */
export function TenantPortal({ view, token }: { view: TenantPortalView; token: string }) {
  const { org, contract } = view;
  const fg = readableTextOn(org.brandColor);
  return (
    <div className="light min-h-dvh bg-[#f4f5f7] text-foreground">
      <header className="sticky top-0 z-20 border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo público de la org (dominio de Supabase)
            <img src={org.logoUrl} alt={org.name} className="h-9 w-auto max-w-[9rem] object-contain" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={{ backgroundColor: org.brandColor, color: fg }}>
              {getInitials(org.name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{org.name}</p>
            <p className="text-[11px] text-muted-foreground">Tu alquiler · {contract.number}</p>
          </div>
        </div>
        <div className="h-0.5" style={{ backgroundColor: org.brandColor }} aria-hidden />
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 pb-12 pt-5 animate-fade-up">
        <section className="px-1">
          <h1 className="text-2xl font-semibold tracking-tight">Hola{view.tenantFirstName ? `, ${view.tenantFirstName}` : ""}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {contract.address}
            {contract.city ? `, ${contract.city}` : ""}
          </p>
        </section>

        <PortalPaymentCard view={view} token={token} />
        <PortalReports view={view} />
        <PortalHowToPay view={view} />
        <PortalProofsCard view={view} token={token} />
        <PortalPaymentsCard view={view} token={token} />
        <PortalContractCard view={view} />
        <PortalContactCard view={view} />

        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          {org.name} · actualizado al {view.today.split("-").reverse().join("/")}
        </p>
      </main>
    </div>
  );
}
