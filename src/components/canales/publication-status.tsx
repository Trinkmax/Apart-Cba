import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { intervalLabel, stayLabel, type PublicationState } from "@/lib/channels/export-reads";
import { formatTimeInTz } from "@/lib/channels/publication-copy";
import type { Channel } from "@/lib/channels/types";

/**
 * El lado saliente de una conexión, en una línea: si la OTA ya vio lo que hay
 * cargado, o qué le falta ver y cuándo va a pasar.
 *
 * Es la respuesta a «lo cargué acá y en Airbnb sigue disponible»: con iCal la
 * OTA viene a leer cuando quiere (Airbnb cada 3 h, Booking cada 2), y hasta
 * entonces muestra lo que vio la vez anterior. «Conectada» no alcanzaba para
 * saberlo.
 */
export function PublicationStatus({
  channel,
  lastReadAt,
  intervalMin,
  publication,
  detailed = false,
}: {
  channel: Channel;
  lastReadAt: string | null;
  intervalMin: number | null;
  publication: PublicationState | null;
  /** En la ficha: lista los cambios con sus fechas en vez de contarlos. */
  detailed?: boolean;
}) {
  const ota = channel === "airbnb" ? "Airbnb" : "Booking";
  const pace = intervalLabel(intervalMin);

  if (!publication) {
    return lastReadAt ? (
      <span>La leyó {ago(lastReadAt)}</span>
    ) : (
      <span className="text-sky-700 dark:text-sky-400">Aún no consultado por la OTA</span>
    );
  }

  if (publication.kind === "waiting") {
    return <span className="text-sky-700 dark:text-sky-400">{ota} todavía no lo leyó</span>;
  }
  if (publication.kind === "never") {
    return (
      <span className="text-rose-600 dark:text-rose-400">
        {ota} nunca leyó tu calendario
      </span>
    );
  }
  if (publication.kind === "stale") {
    return (
      <span className="text-rose-600 dark:text-rose-400">
        {ota} no lo lee desde {lastReadAt ? ago(lastReadAt) : "hace días"}
      </span>
    );
  }

  const { toBlock, toRelease } = publication.changes;
  const next = publication.nextReadAt ? `lo ve ~${formatTimeInTz(publication.nextReadAt)}` : null;

  if (publication.kind === "pending") {
    const total = toBlock.length + toRelease.length;
    if (!detailed) {
      const dates = [...toBlock, ...toRelease].map(stayLabel);
      const title = [
        toBlock.length > 0 ? `Por cerrar en ${ota}: ${toBlock.map(stayLabel).join(", ")}` : null,
        toRelease.length > 0 ? `Por liberar en ${ota}: ${toRelease.map(stayLabel).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        <span title={title}>
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {total === 1 ? `Falta que lea ${dates[0]}` : `Faltan que lea ${total} cambios`}
          </span>
          {next ? <> · {next}</> : pace ? <> · lee {pace}</> : null}
        </span>
      );
    }
    return (
      <div className="space-y-1.5">
        <p className="font-medium text-amber-700 dark:text-amber-400">
          {ota} todavía no vio {total === 1 ? "este cambio" : "estos cambios"}
          {next ? ` (${next})` : ""}:
        </p>
        <ul className="space-y-0.5">
          {toBlock.map((s) => (
            <li key={`b${s[0]}${s[1]}`}>
              <span className="tabular-nums">{stayLabel(s)}</span> — acá está ocupado y {ota} lo
              sigue mostrando libre
            </li>
          ))}
          {toRelease.map((s) => (
            <li key={`r${s[0]}${s[1]}`}>
              <span className="tabular-nums">{stayLabel(s)}</span> — acá se liberó y {ota} lo
              sigue cerrando
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <span>
      <span className="text-emerald-700 dark:text-emerald-400">Al día</span>
      {lastReadAt ? <> · leyó {ago(lastReadAt)}</> : null}
      {detailed && pace ? <> · lee {pace}</> : null}
    </span>
  );
}

function ago(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return "—";
  }
}
