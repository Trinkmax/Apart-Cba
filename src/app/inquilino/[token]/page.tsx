import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { getTenantPortal } from "@/lib/actions/rentals-portal";
import { ForceLightBody } from "@/components/rentals/portal/force-light-body";
import { TenantPortal } from "@/components/rentals/portal/tenant-portal";

// El link ES la llave del inquilino: nunca se indexa ni se cachea, y el token
// no sale de esta página en el Referer (WhatsApp, home banking, mapas).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu alquiler",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

type Params = Promise<{ token: string }>;

/**
 * Portal del inquilino (`/inquilino/<token>`), sin cuenta: cuánto debe y cómo
 * pagar, avisar un pago, subir expensas y servicios, bajar recibos y ver su
 * contrato. Token inválido, regenerado o portal apagado → not-found propio.
 */
export default async function TenantPortalPage({ params }: { params: Params }) {
  const { token } = await params;
  const view = await getTenantPortal(token);
  if (!view) notFound();
  return (
    <>
      <ForceLightBody />
      <TenantPortal view={view} token={token} />
    </>
  );
}
