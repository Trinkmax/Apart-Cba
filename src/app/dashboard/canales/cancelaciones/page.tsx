import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  listPendingCancellations,
  listCancellationHistory,
} from "@/lib/actions/channel-cancellations";
import { CancellationRequestCard } from "@/components/channels/cancellation-request-card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Cancelaciones a confirmar · Canales" };

/**
 * La bandeja de decisiones. Todo lo que una OTA propone cancelar pasa por acá y
 * espera una persona; nada se ejecuta solo.
 */
export default async function CancelacionesPage() {
  const [pending, history] = await Promise.all([
    listPendingCancellations(),
    listCancellationHistory(),
  ]);

  return (
    <div className="page-x page-y max-w-4xl mx-auto space-y-6">
      <Link
        href="/dashboard/canales"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Canales de venta
      </Link>

      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
          Cancelaciones a confirmar
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cuando una OTA deja de mostrar una reserva, el sistema te avisa pero no la cancela.
          Mientras tanto las fechas siguen ocupadas.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <ShieldCheck className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No hay nada esperando tu decisión</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ninguna reserva se cancela sin que vos lo confirmes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((p) => (
            <CancellationRequestCard key={p.id} request={p} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <section className="space-y-3 pt-2">
          <h2 className="text-sm font-medium text-muted-foreground">Decisiones anteriores</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3">
                <Badge
                  variant="outline"
                  className={
                    h.status === "kept"
                      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                      : "border-destructive/40 text-destructive"
                  }
                >
                  {h.status === "kept" ? "Se mantuvo" : "Se canceló"}
                </Badge>
                <span className="font-medium">
                  {h.snapshot?.huesped ?? h.snapshot?.unidad ?? "Reserva"}
                </span>
                <span className="text-muted-foreground">
                  {h.snapshot?.unidad && h.snapshot?.huesped ? `· ${h.snapshot.unidad} ` : ""}
                  {h.snapshot?.check_in} → {h.snapshot?.check_out}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {h.decided_by_name ?? "—"}
                  {h.decided_at && ` · ${new Date(h.decided_at).toLocaleDateString("es-AR")}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
