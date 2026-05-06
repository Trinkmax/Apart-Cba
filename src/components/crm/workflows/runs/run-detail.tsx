"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Pause, AlertCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { CrmWorkflowRun, CrmWorkflowStepLog } from "@/lib/types/database";

interface Props {
  run: CrmWorkflowRun;
  workflow: { id: string; name: string };
  steps: CrmWorkflowStepLog[];
}

const STATUS_CFG: Record<CrmWorkflowRun["status"], { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; cls: string }> = {
  queued: { label: "En cola", icon: Clock, cls: "text-zinc-500" },
  running: { label: "Ejecutando", icon: Clock, cls: "text-amber-500" },
  success: { label: "Éxito", icon: CheckCircle2, cls: "text-emerald-500" },
  failed: { label: "Fallido", icon: XCircle, cls: "text-red-500" },
  cancelled: { label: "Cancelado", icon: XCircle, cls: "text-zinc-500" },
  suspended: { label: "Suspendido", icon: Pause, cls: "text-violet-500" },
};

export function WorkflowRunDetail({ run, workflow, steps }: Props) {
  const status = STATUS_CFG[run.status];
  const StatusIcon = status.icon;
  const durationMs = run.ended_at && run.started_at
    ? new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()
    : null;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Button asChild size="sm" variant="ghost" className="h-7 w-7 p-0">
            <Link href={`/dashboard/crm/workflows/${workflow.id}`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            <Link href={`/dashboard/crm/workflows/${workflow.id}`} className="hover:underline">
              {workflow.name}
            </Link>
            <ChevronRight className="size-3 inline mx-1" />
            Run
          </span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <StatusIcon size={20} className={status.cls} />
          <h1 className="text-xl font-bold">Ejecución {run.id.slice(0, 8)}</h1>
          <span className={cn("text-xs uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-muted", status.cls)}>
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>Inició: {format(new Date(run.started_at), "PPp", { locale: es })}</span>
          {run.ended_at && <span>Terminó: {format(new Date(run.ended_at), "PPp", { locale: es })}</span>}
          {durationMs != null && <span>Duración: {(durationMs / 1000).toFixed(2)}s</span>}
          <span>Pasos: {run.steps_executed}</span>
        </div>
        {run.error && (
          <div className="mt-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="size-4 inline mr-1" /> {run.error}
          </div>
        )}
        {run.status === "suspended" && run.resume_at && (
          <div className="mt-3 p-3 rounded-lg border border-violet-500/30 bg-violet-500/10 text-sm">
            <Pause className="size-4 inline mr-1" />
            Suspendido — reanuda {format(new Date(run.resume_at), "PPp", { locale: es })} ({run.resume_reason})
          </div>
        )}
      </header>

      <section>
        <h2 className="font-semibold mb-3">Logs de pasos ({steps.length})</h2>
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin pasos ejecutados todavía.</p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2">
              {steps.map((step, idx) => <StepCard key={step.id} step={step} index={idx + 1} />)}
            </div>
          </ScrollArea>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold mb-2 text-sm">Variables del run</h2>
        <pre className="text-xs bg-muted/50 border border-border rounded-md p-3 overflow-auto max-h-48">
          {JSON.stringify(run.variables, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function StepCard({ step, index }: { step: CrmWorkflowStepLog; index: number }) {
  const isOk = step.status === "success";
  return (
    <div className={cn(
      "border rounded-lg p-3",
      isOk ? "border-border" : step.status === "failed" ? "border-red-500/40 bg-red-500/5" : "border-border",
    )}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">#{index}</span>
          <code className="text-sm font-mono">{step.node_type}</code>
          <span className={cn(
            "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded",
            step.status === "success" && "bg-emerald-500/15 text-emerald-600",
            step.status === "failed" && "bg-red-500/15 text-red-600",
            step.status === "skipped" && "bg-zinc-500/15 text-zinc-500",
          )}>
            {step.status}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {step.duration_ms != null ? `${step.duration_ms}ms` : "—"} · {format(new Date(step.created_at), "HH:mm:ss.SSS", { locale: es })}
        </span>
      </div>
      {step.error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{step.error}</p>
      )}
      {step.output_snapshot && Object.keys(step.output_snapshot).length > 0 && (
        <details className="mt-1.5">
          <summary className="text-xs text-muted-foreground cursor-pointer">Output</summary>
          <pre className="text-[11px] bg-muted/50 rounded p-2 mt-1 overflow-auto max-h-32">
            {JSON.stringify(step.output_snapshot, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
