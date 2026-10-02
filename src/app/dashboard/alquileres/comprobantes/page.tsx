import type { Metadata } from "next";
import { AlertTriangle, FileCheck2 } from "lucide-react";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { EmptyState, HowItWorks, PageHeader } from "@/components/rentals/ui";
import { ProofsBoard, type ProofsTab } from "@/components/rentals/proofs/proofs-board";
import { ProofsKpis, ProofsMonthNav } from "@/components/rentals/proofs/proofs-kpis";
import { parseMonthParam } from "@/components/rentals/proofs/proof-helpers";
import { getProofsBoard } from "@/lib/actions/rentals-proofs";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { monthOf } from "@/lib/rentals/ymd";

export const metadata: Metadata = { title: "Comprobantes · Alquileres" };

const TABS: ProofsTab[] = ["revisar", "faltan", "avisos", "revisados"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Comprobantes de expensas y servicios: lo que suben los inquilinos (para
 * validar), lo que falta del mes (para pedir) y los avisos de pago del portal.
 * Estado en la URL (?tab, ?mes): se puede compartir y "atrás" funciona.
 */
export default async function ComprobantesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRentalsPage();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const requested = parseMonthParam(one(sp.mes));
  const month = requested && requested <= monthOf(ctx.today) ? requested : monthOf(ctx.today);
  const res = await getProofsBoard(month);

  if (!res.ok) {
    return (
      <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
        <PageHeader icon={FileCheck2} title="Comprobantes" />
        <EmptyState icon={AlertTriangle} title="No pudimos cargar los comprobantes" description={res.error} />
      </div>
    );
  }

  const { data } = res;
  const pendingReports = data.reports.filter((r) => r.status === "pendiente").length;
  const tabParam = one(sp.tab);
  const initialTab: ProofsTab = TABS.includes(tabParam as ProofsTab)
    ? (tabParam as ProofsTab)
    : data.review.length
      ? "revisar"
      : pendingReports
        ? "avisos"
        : data.missing.length
          ? "faltan"
          : "revisar";

  const subtitleParts = [
    data.review.length ? `${data.review.length} para revisar` : null,
    data.kpi.missingCount ? `${data.kpi.missingCount} ${data.kpi.missingCount === 1 ? "falta" : "faltan"}` : null,
    pendingReports ? `${pendingReports} ${pendingReports === 1 ? "aviso de pago" : "avisos de pago"}` : null,
  ].filter(Boolean);

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh
        tables={["rental_proofs", "rental_payment_reports"]}
        label="comprobante"
        labelPlural="comprobantes"
        throttleMs={5_000}
      />
      <PageHeader
        icon={FileCheck2}
        title="Comprobantes"
        subtitle={
          subtitleParts.length
            ? subtitleParts.join(" · ")
            : "Expensas y servicios que pagan los inquilinos: validá lo que suben y pedí lo que falta."
        }
        actions={<ProofsMonthNav month={data.month} today={data.today} tab={tabParam && TABS.includes(tabParam as ProofsTab) ? tabParam : undefined} />}
      />
      <ProofsKpis kpi={data.kpi} reviewCount={data.review.length} reportsCount={pendingReports} />
      <ProofsBoard key={data.month} data={data} initialTab={initialTab} />
      <HowItWorks title="Cómo funciona">
        <p>
          Cada mes, cada contrato pide los comprobantes que dice su configuración («Expensas y servicios»): las expensas si las paga
          el inquilino y los servicios marcados con «pedir comprobante» (los bimestrales, cada dos meses).
        </p>
        <p>
          El inquilino los sube desde su link, sin crear una cuenta. Si te los manda por otro lado, cargalos con «Subir yo». Todo lo
          que llega queda «Para revisar».
        </p>
        <p>
          Validá si muestra el pago del mes que corresponde. Si lo rechazás, el motivo le aparece en su link para que lo vuelva a
          subir.
        </p>
        <p>
          Un aviso de pago no es un cobro: fijate que la plata haya entrado y registrá el cobro con su recibo, o descartalo con el
          motivo.
        </p>
        <p>
          Por qué importa: una expensa o un servicio impago queda como deuda de la propiedad y, al final, lo termina pagando el
          propietario.
        </p>
      </HowItWorks>
    </div>
  );
}
