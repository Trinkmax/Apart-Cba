"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CircleAlert, Info, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { resolveChannelIssue } from "@/lib/actions/channels";
import type { ChannelIssueRow } from "@/lib/channels/types";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

type IssueWithUnit = ChannelIssueRow & {
  unit: { id: string; code: string; name: string } | null;
};

const SEVERITY_META = {
  critical: { label: "Crítica", icon: CircleAlert, className: "text-rose-600 dark:text-rose-400" },
  warning: { label: "Atención", icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
  info: { label: "Info", icon: Info, className: "text-sky-600 dark:text-sky-400" },
} as const;

/**
 * Panel "Qué tengo que resolver ahora": incidencias abiertas, ordenadas por
 * severidad, con acciones inline (reintentar, asignar unidad, descartar).
 */
export function IssuesPanel({
  issues,
  units,
}: {
  issues: IssueWithUnit[];
  units: { id: string; code: string; name: string }[];
}) {
  if (issues.length === 0) return null;
  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />
          Para resolver ({issues.length})
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} units={units} />
        ))}
      </ul>
    </Card>
  );
}

function IssueRow({
  issue,
  units,
}: {
  issue: IssueWithUnit;
  units: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [unitId, setUnitId] = useState<string>("");
  const [reason, setReason] = useState("");

  const sev = SEVERITY_META[issue.severity];
  const SevIcon = sev.icon;
  const suggested = (issue.suggested?.units ?? []) as Array<{ unit_id: string; unit_code: string }>;

  function run(action: "retry" | "dismiss" | "assign_unit", extra?: { unit_id?: string; reason?: string }) {
    startTransition(async () => {
      try {
        const r = await resolveChannelIssue({
          issue_id: issue.id,
          action,
          unit_id: extra?.unit_id,
          reason: extra?.reason,
        });
        if (r.ok) {
          toast.success(
            action === "dismiss"
              ? "Incidencia descartada"
              : action === "assign_unit"
                ? "Unidad asignada y reserva proyectada"
                : "Reintento ejecutado",
          );
          setAssignOpen(false);
          setDismissOpen(false);
          router.refresh();
        } else {
          toast.error(r.error ?? "No se pudo resolver");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  }

  const canAssign =
    (issue.issue_type === "unmapped_unit" || issue.issue_type === "ambiguous_unit") &&
    Boolean(issue.reservation_id);

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <SevIcon size={16} className={`mt-0.5 shrink-0 ${sev.className}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{issue.title}</span>
            {issue.unit && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {issue.unit.code}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{timeAgo(issue.created_at)}</span>
          </div>
          {issue.detail && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{issue.detail}</p>
          )}
          {issue.booking_id && (
            <Link
              href={`/dashboard/reservas/${issue.booking_id}`}
              className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground mt-1 inline-block"
            >
              Ver reserva vinculada
            </Link>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canAssign && (
            <Button size="sm" variant="secondary" onClick={() => setAssignOpen(true)} disabled={pending}>
              Asignar unidad
            </Button>
          )}
          {!canAssign && (
            <Button size="sm" variant="ghost" onClick={() => run("retry")} disabled={pending} className="gap-1.5">
              <RefreshCw size={13} className={pending ? "animate-spin" : ""} /> Reintentar
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground"
            aria-label="Descartar incidencia"
            onClick={() => setDismissOpen(true)}
            disabled={pending}
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Asignar unidad */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar unidad</DialogTitle>
            <DialogDescription>
              La reserva externa se proyectará sobre la unidad elegida. Esta acción queda auditada.
            </DialogDescription>
          </DialogHeader>
          {suggested.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Sugerencia según el nombre del listing:{" "}
              {suggested.map((s) => (
                <button
                  key={s.unit_id}
                  type="button"
                  className="underline underline-offset-2 mr-2"
                  onClick={() => setUnitId(s.unit_id)}
                >
                  {s.unit_code}
                </button>
              ))}
            </p>
          )}
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger aria-label="Unidad">
              <SelectValue placeholder="Elegí la unidad…" />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.code} · {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => unitId && run("assign_unit", { unit_id: unitId })}
              disabled={!unitId || pending}
            >
              Asignar y proyectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Descartar con motivo */}
      <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Descartar incidencia</DialogTitle>
            <DialogDescription>
              Contá brevemente por qué se descarta — queda en la auditoría.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo (ej.: ya resuelto en la OTA, falso positivo…)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => run("dismiss", { reason: reason || undefined })}
              disabled={pending}
            >
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return "";
  }
}
