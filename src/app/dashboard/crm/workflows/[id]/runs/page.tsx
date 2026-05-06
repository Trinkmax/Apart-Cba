import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, CheckCircle2, XCircle, Clock, Pause } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getCrmWorkflow } from "@/lib/actions/crm-workflows";
import { listWorkflowRuns } from "@/lib/actions/crm-workflow-runs";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_ICON = {
  queued: Clock,
  running: Clock,
  success: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
  suspended: Pause,
};

const STATUS_COLOR: Record<string, string> = {
  queued: "text-zinc-500",
  running: "text-amber-500",
  success: "text-emerald-500",
  failed: "text-red-500",
  cancelled: "text-zinc-500",
  suspended: "text-violet-500",
};

export default async function WorkflowRunsListPage({ params }: Props) {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_workflows", "view")) redirect("/sin-acceso");

  const { id } = await params;
  const [workflow, runs] = await Promise.all([
    getCrmWorkflow(id),
    listWorkflowRuns(id, 100),
  ]);
  if (!workflow) notFound();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Button asChild size="sm" variant="ghost" className="h-7 w-7 p-0">
            <Link href={`/dashboard/crm/workflows/${id}`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            <Link href={`/dashboard/crm/workflows`} className="hover:underline">Workflows</Link>
            <ChevronRight className="size-3 inline mx-1" />
            <Link href={`/dashboard/crm/workflows/${id}`} className="hover:underline">{workflow.name}</Link>
            <ChevronRight className="size-3 inline mx-1" />
            Runs
          </span>
        </div>
        <h1 className="text-2xl font-bold">Historial de ejecuciones</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {workflow.runs_count} ejecuciones · {workflow.success_count} OK · {workflow.failure_count} fallidas
        </p>
      </header>

      {runs.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center text-sm text-muted-foreground">
          Sin ejecuciones todavía. El workflow se ejecuta cuando ocurre su trigger.
        </div>
      ) : (
        <div className="space-y-1.5">
          {runs.map((run) => {
            const Icon = STATUS_ICON[run.status];
            const colorCls = STATUS_COLOR[run.status];
            const durationMs = run.ended_at && run.started_at
              ? new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()
              : null;
            return (
              <Link
                key={run.id}
                href={`/dashboard/crm/workflows/runs/${run.id}`}
                className="flex items-center gap-3 p-3 border border-border rounded-md bg-card hover:border-foreground/20 transition-colors"
              >
                <Icon className={`size-4 shrink-0 ${colorCls}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-muted-foreground">{run.id.slice(0, 8)}</code>
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${colorCls}`}>
                      {run.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {run.steps_executed} pasos
                      {durationMs != null && ` · ${(durationMs / 1000).toFixed(2)}s`}
                    </span>
                  </div>
                  {run.error && (
                    <p className="text-xs text-red-500 line-clamp-1 mt-0.5">{run.error}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0" title={format(new Date(run.started_at), "PPp", { locale: es })}>
                  {formatDistanceToNowStrict(new Date(run.started_at), { locale: es, addSuffix: true })}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
