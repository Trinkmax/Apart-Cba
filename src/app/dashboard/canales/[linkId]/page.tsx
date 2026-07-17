import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, Upload, CalendarDays } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getLinkDetail, getChannelsOverview } from "@/lib/actions/channels";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { HealthBadge } from "@/components/canales/health-badge";
import { LinkActions } from "@/components/canales/link-actions";
import { IssuesPanel } from "@/components/canales/issues-panel";
import { CopyButton } from "@/components/canales/copy-button";
import { getLinkExportUrl } from "@/lib/actions/channels";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import type { ChannelReservationRow } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

export default async function LinkDetailPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { role } = await getCurrentOrg();
  if (!can(role, "channels", "view")) redirect("/dashboard");
  const { linkId } = await params;

  let detail;
  try {
    detail = await getLinkDetail(linkId);
  } catch {
    notFound();
  }
  const { link, health_state, reservations, issues } = detail;
  const overview = await getChannelsOverview();
  const src = BOOKING_SOURCE_META[link.channel];
  const openIssues = issues
    .filter((i) => i.status === "open")
    .map((i) => ({ ...i, unit: link.unit }));

  return (
    <div className="page-x page-y space-y-4 max-w-4xl mx-auto">
      <Link
        href="/dashboard/canales"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Canales de venta
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2 flex-wrap">
            <span className="font-mono text-base text-muted-foreground">{link.unit.code}</span>
            {link.unit.name}
            <Badge variant="outline" style={{ color: src.color, borderColor: src.color + "40" }}>
              {src.label}
            </Badge>
            <HealthBadge health={health_state} />
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {link.external_listing_id ? `Listing ${link.external_listing_id} · ` : ""}
            Conectada {format(new Date(link.created_at), "dd MMM yyyy", { locale: es })}
          </p>
        </div>
        <LinkActions
          linkId={link.id}
          status={link.status}
          hasFeed={Boolean(link.feed_secret_id)}
        />
      </div>

      {/* Recepción / Publicación */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Download size={12} /> Recepción de reservas
          </h2>
          <dl className="text-sm space-y-1.5">
            <Row k="Última lectura OK" v={timeAgoOr(link.last_success_at, "Nunca")} />
            <Row k="Último intento" v={timeAgoOr(link.last_attempt_at, "Nunca")} />
            <Row
              k="Errores consecutivos"
              v={String(link.consecutive_failures)}
              tone={link.consecutive_failures >= 3 ? "critical" : link.consecutive_failures > 0 ? "warning" : undefined}
            />
            <Row k="Última reserva recibida" v={timeAgoOr(link.last_reservation_at, "Sin reservas aún")} />
            {typeof link.health?.last_error === "string" && link.health.last_error && (
              <Row k="Último error" v={String(link.health.last_error)} tone="critical" />
            )}
          </dl>
        </Card>
        <Card className="p-4 space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Upload size={12} /> Publicación de disponibilidad
          </h2>
          <dl className="text-sm space-y-1.5">
            <Row
              k="Consultado por la OTA"
              v={timeAgoOr(link.last_export_access_at, "Aún no consultado")}
              tone={link.last_export_access_at ? undefined : "info"}
            />
          </dl>
          <div className="pt-1">
            <CopyButton
              getValue={() => getLinkExportUrl(link.id)}
              label="Copiar enlace de nuestro calendario"
              size="sm"
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            La consulta demuestra que la OTA accede al enlace; cuándo aplica los cambios lo decide la
            plataforma.
          </p>
        </Card>
      </div>

      {/* Incidencias del link */}
      <IssuesPanel issues={openIssues} units={overview.units} />

      {/* Reservas externas */}
      <Card className="p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <CalendarDays size={12} /> Reservas externas recientes
        </h2>
        {reservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se recibieron reservas por esta conexión.</p>
        ) : (
          <ul className="divide-y divide-border">
            {reservations.map((r) => (
              <ReservationRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReservationRow({ r }: { r: ChannelReservationRow }) {
  const stateLabel =
    r.external_status === "cancelled"
      ? { text: "Cancelada", cls: "text-muted-foreground" }
      : r.missing_since
        ? { text: "Verificando cancelación", cls: "text-amber-700 dark:text-amber-400" }
        : !r.booking_id
          ? { text: "Sin proyectar (revisar)", cls: "text-rose-700 dark:text-rose-400" }
          : Object.keys(r.guest ?? {}).length === 0
            ? { text: "Esperando datos de la OTA", cls: "text-sky-700 dark:text-sky-400" }
            : { text: "Completa", cls: "text-emerald-700 dark:text-emerald-400" };
  return (
    <li className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3 text-sm">
      <span className="font-mono text-xs text-muted-foreground w-32 truncate shrink-0">
        {r.confirmation_code ?? r.ical_uid?.slice(0, 12) ?? "—"}
      </span>
      <span className="tabular-nums text-xs">
        {r.check_in} → {r.check_out}
      </span>
      <span className="truncate text-xs text-muted-foreground flex-1">
        {r.guest?.name ?? ""}
      </span>
      <span className={`text-xs ${stateLabel.cls}`}>{stateLabel.text}</span>
      {r.booking_id && (
        <Link
          href={`/dashboard/reservas/${r.booking_id}`}
          className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground shrink-0"
        >
          Ver reserva
        </Link>
      )}
    </li>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "critical" | "warning" | "info" }) {
  const cls =
    tone === "critical"
      ? "text-rose-700 dark:text-rose-400"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "info"
          ? "text-sky-700 dark:text-sky-400"
          : "";
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={`text-xs text-right break-words max-w-[60%] ${cls}`}>{v}</dd>
    </div>
  );
}

function timeAgoOr(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return fallback;
  }
}
