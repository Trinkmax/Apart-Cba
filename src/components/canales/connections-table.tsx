"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  Upload,
  MoreHorizontal,
  RefreshCw,
  Pause,
  Play,
  Search,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { HealthBadge } from "./health-badge";
import { pauseLink, resumeLink, syncChannelsNow } from "@/lib/actions/channels";
import type { ChannelLinkOverview } from "@/lib/actions/channels";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { ChannelLinkHealth } from "@/lib/channels/types";

/**
 * Matriz de conexiones: una fila por unidad×OTA con recepción (entrante),
 * publicación (saliente), última actividad, incidencia y acción recomendada.
 */
export function ConnectionsTable({ links }: { links: ChannelLinkOverview[] }) {
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("todos");
  const [stateFilter, setStateFilter] = useState<string>("todos");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return links.filter((l) => {
      if (channelFilter !== "todos" && l.channel !== channelFilter) return false;
      if (stateFilter !== "todos" && l.health_state !== stateFilter) return false;
      if (!q) return true;
      return (
        l.unit.code.toLowerCase().includes(q) ||
        l.unit.name.toLowerCase().includes(q) ||
        (l.external_listing_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [links, query, channelFilter, stateFilter]);

  if (links.length === 0) {
    return (
      <Card className="p-10 text-center space-y-2">
        <p className="font-medium">Todavía no hay departamentos conectados</p>
        <p className="text-sm text-muted-foreground">
          Conectá tu primer departamento con Airbnb o Booking para proteger el calendario.
        </p>
        <Button asChild className="mt-2">
          <Link href="/dashboard/canales/conectar">Conectar departamento</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar departamento…"
            className="pl-8 h-9"
            aria-label="Buscar departamento"
          />
        </div>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-[130px] h-9" aria-label="Filtrar por canal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los canales</SelectItem>
            <SelectItem value="airbnb">Airbnb</SelectItem>
            <SelectItem value="booking">Booking</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-[180px] h-9" aria-label="Filtrar por estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="healthy">Conectadas</SelectItem>
            <SelectItem value="degraded">Degradadas</SelectItem>
            <SelectItem value="critical">Críticas</SelectItem>
            <SelectItem value="verifying">Esperando verificación</SelectItem>
            <SelectItem value="paused">Pausadas</SelectItem>
            <SelectItem value="draft">Borradores</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground ml-auto">
          {filtered.length} de {links.length} conexiones
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Departamento</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    <Download size={12} /> Recepción
                  </span>
                </TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    <Upload size={12} /> Publicación
                  </span>
                </TableHead>
                <TableHead>Última actividad</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((link) => (
                <ConnectionRow key={link.id} link={link} />
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    Ninguna conexión coincide con la búsqueda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function ConnectionRow({ link }: { link: ChannelLinkOverview }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const src = BOOKING_SOURCE_META[link.channel];

  function doSync() {
    startTransition(async () => {
      try {
        const r = await syncChannelsNow(link.id);
        toast.success(
          r.errors > 0
            ? "La sincronización terminó con errores — mirá el detalle"
            : `Sincronizado: ${r.imported} nuevas, ${r.updated} actualizadas`,
        );
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al sincronizar");
      }
    });
  }

  function doPauseResume() {
    startTransition(async () => {
      try {
        if (link.status === "paused") {
          await resumeLink(link.id);
          toast.success("Conexión reanudada");
        } else {
          await pauseLink(link.id);
          toast.success("Conexión pausada");
        }
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  }

  return (
    <TableRow className="group">
      <TableCell>
        <Link
          href={`/dashboard/canales/${link.id}`}
          className="font-medium hover:underline underline-offset-2"
        >
          <span className="font-mono text-xs text-muted-foreground mr-2">{link.unit.code}</span>
          {link.unit.name}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="outline" style={{ color: src.color, borderColor: src.color + "40" }}>
          {src.label}
        </Badge>
      </TableCell>
      <TableCell>
        <HealthBadge health={link.health_state} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <ReceptionCell link={link} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <PublicationCell link={link} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {link.last_reservation_at ? (
          <>Reserva {timeAgo(link.last_reservation_at)}</>
        ) : link.last_success_at ? (
          <>Revisada {timeAgo(link.last_success_at)}</>
        ) : (
          "Sin actividad"
        )}
      </TableCell>
      <TableCell className="text-right">
        <RecommendedAction link={link} pending={pending} onSync={doSync} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Más acciones">
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/canales/${link.id}`}>
                <ExternalLink size={14} /> Ver detalle
              </Link>
            </DropdownMenuItem>
            {link.status === "active" && (
              <DropdownMenuItem onClick={doSync} disabled={pending}>
                <RefreshCw size={14} /> Sincronizar ahora
              </DropdownMenuItem>
            )}
            {(link.status === "active" || link.status === "paused") && (
              <DropdownMenuItem onClick={doPauseResume} disabled={pending}>
                {link.status === "paused" ? (
                  <>
                    <Play size={14} /> Reanudar
                  </>
                ) : (
                  <>
                    <Pause size={14} /> Pausar
                  </>
                )}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function ReceptionCell({ link }: { link: ChannelLinkOverview }) {
  if (!link.feed_secret_id) return <span>Sin calendario cargado</span>;
  if (link.status === "paused") return <span>En pausa</span>;
  if (link.consecutive_failures > 0) {
    return (
      <span className="text-rose-600 dark:text-rose-400">
        {link.consecutive_failures} {link.consecutive_failures === 1 ? "fallo" : "fallos"} seguidos
      </span>
    );
  }
  if (link.last_success_at) return <span>OK {timeAgo(link.last_success_at)}</span>;
  return <span>Pendiente de primera lectura</span>;
}

function PublicationCell({ link }: { link: ChannelLinkOverview }) {
  if (link.last_export_access_at) {
    return <span>La OTA lo consultó {timeAgo(link.last_export_access_at)}</span>;
  }
  return <span className="text-sky-700 dark:text-sky-400">Aún no consultado por la OTA</span>;
}

function RecommendedAction({
  link,
  pending,
  onSync,
}: {
  link: ChannelLinkOverview;
  pending: boolean;
  onSync: () => void;
}) {
  if (link.status === "draft") {
    return (
      <Button asChild size="sm" variant="secondary" className="mr-1">
        <Link href={`/dashboard/canales/conectar?link=${link.id}`}>Terminar conexión</Link>
      </Button>
    );
  }
  if (link.critical_issues > 0 || link.open_issues > 0) {
    return (
      <Button asChild size="sm" variant={link.critical_issues > 0 ? "destructive" : "secondary"} className="mr-1">
        <Link href={`/dashboard/canales/${link.id}`}>
          {link.critical_issues > 0 ? "Resolver" : "Revisar"} ({link.open_issues})
        </Link>
      </Button>
    );
  }
  if (link.health_state === "critical" || link.health_state === "degraded") {
    return (
      <Button size="sm" variant="secondary" className="mr-1" onClick={onSync} disabled={pending}>
        <RefreshCw size={13} className={pending ? "animate-spin" : ""} /> Reintentar
      </Button>
    );
  }
  return null;
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return "—";
  }
}
