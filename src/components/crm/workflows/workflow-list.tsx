"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Copy,
  Trash2,
  Pencil,
  Bell,
  Clock,
  MessageSquare,
  Building2,
  PlayCircle,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  createCrmWorkflow,
  duplicateCrmWorkflow,
  deleteCrmWorkflow,
  setCrmWorkflowStatus,
  installFromLibrary,
} from "@/lib/actions/crm-workflows";
import { WORKFLOW_LIBRARY } from "@/lib/crm/workflow-library";
import type { CrmWorkflow, CrmWorkflowTriggerType } from "@/lib/types/database";

interface Props {
  workflows: CrmWorkflow[];
  canEdit: boolean;
}

export function WorkflowsList({ workflows, canEdit }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  const handleToggle = (wf: CrmWorkflow, on: boolean) => {
    startTransition(async () => {
      try {
        await setCrmWorkflowStatus(wf.id, on ? "active" : "inactive");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("¿Eliminar este workflow? Esta acción no se puede deshacer.")) return;
    startTransition(async () => {
      await deleteCrmWorkflow(id);
      toast.success("Workflow eliminado");
      router.refresh();
    });
  };

  const handleDuplicate = (id: string) => {
    startTransition(async () => {
      const r = await duplicateCrmWorkflow(id);
      router.push(`/dashboard/crm/workflows/${r.id}`);
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="size-6 text-amber-500" />
            Automatizaciones
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Workflows visuales para responder, etiquetar y gestionar conversaciones automáticamente.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <LibraryDialog />
            <Dialog open={creating} onOpenChange={setCreating}>
              <DialogTrigger asChild>
                <Button className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5">
                  <Plus className="size-4" /> Nuevo workflow
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Crear nuevo workflow</DialogTitle>
                </DialogHeader>
                <CreateForm onClose={() => setCreating(false)} />
              </DialogContent>
            </Dialog>
          </div>
        )}
      </header>

      {workflows.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center">
          <GitBranch className="size-12 mx-auto mb-3 text-muted-foreground/40" />
          <h2 className="font-semibold mb-1">Workflows de automatización</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Creá flujos visuales para responder automáticamente, gestionar reseñas, etiquetar conversaciones y crear alertas en el CRM.
          </p>
          {canEdit && (
            <Button onClick={() => setCreating(true)} className="bg-emerald-500 hover:bg-emerald-600 text-white">
              <Plus className="size-4 mr-1.5" /> Crear primer workflow
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="flex items-center gap-3 p-3 border border-border rounded-lg hover:border-foreground/20 transition-colors bg-card"
            >
              <TriggerIcon type={wf.trigger_type} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link href={`/dashboard/crm/workflows/${wf.id}`} className="font-medium hover:underline">
                    {wf.name}
                  </Link>
                  {wf.status === "draft" && (
                    <span className="text-[10px] uppercase tracking-wider text-amber-600 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                      Borrador
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-muted">{wf.trigger_type}</span>
                  {wf.runs_count > 0 && (
                    <span>
                      {wf.success_count}/{wf.runs_count} runs OK
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {canEdit && (
                  <Switch
                    checked={wf.status === "active"}
                    onCheckedChange={(on) => handleToggle(wf, on)}
                    aria-label={wf.status === "active" ? "Desactivar" : "Activar"}
                  />
                )}
                <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs" title="Ver runs">
                  <Link href={`/dashboard/crm/workflows/${wf.id}/runs`}>
                    Runs
                  </Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0">
                  <Link href={`/dashboard/crm/workflows/${wf.id}`}>
                    <Pencil className="size-3.5" />
                  </Link>
                </Button>
                {canEdit && (
                  <>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleDuplicate(wf.id)} title="Duplicar">
                      <Copy className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:text-red-500" onClick={() => handleDelete(wf.id)} title="Eliminar">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TriggerIcon({ type }: { type: CrmWorkflowTriggerType }) {
  const map: Record<CrmWorkflowTriggerType, { icon: React.ComponentType<{ size?: number; className?: string }>; bg: string; color: string }> = {
    message_received: { icon: MessageSquare, bg: "bg-emerald-500/10", color: "text-emerald-500" },
    conversation_closed: { icon: Bell, bg: "bg-amber-500/10", color: "text-amber-500" },
    pms_event: { icon: Building2, bg: "bg-blue-500/10", color: "text-blue-500" },
    scheduled: { icon: Clock, bg: "bg-violet-500/10", color: "text-violet-500" },
    manual: { icon: PlayCircle, bg: "bg-zinc-500/10", color: "text-zinc-500" },
  };
  const cfg = map[type];
  const Icon = cfg.icon;
  return (
    <div className={`size-9 rounded-md flex items-center justify-center ${cfg.bg} shrink-0`}>
      <Icon className={`size-4 ${cfg.color}`} />
    </div>
  );
}

function LibraryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const install = (slug: string) => {
    startTransition(async () => {
      try {
        const r = await installFromLibrary(slug);
        toast.success("Template instalado como borrador");
        setOpen(false);
        router.push(`/dashboard/crm/workflows/${r.id}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <GitBranch className="size-4" /> Biblioteca
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Biblioteca de workflows</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Workflows pre-armados listos para usar. Se instalan como borrador y podés editarlos antes de activar.
        </p>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {WORKFLOW_LIBRARY.map((tpl) => (
            <div key={tpl.slug} className="border border-border rounded-lg p-3 hover:border-foreground/20 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm">{tpl.name}</h3>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{tpl.category}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{tpl.description}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => install(tpl.slug)}>
                  Instalar
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<CrmWorkflowTriggerType>("message_received");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      try {
        const result = await createCrmWorkflow({
          name: name.trim(),
          description: description.trim() || undefined,
          triggerType,
        });
        toast.success("Workflow creado");
        onClose();
        router.push(`/dashboard/crm/workflows/${result.id}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="wf-name">Nombre</Label>
        <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Bienvenida nuevo lead" required />
      </div>
      <div>
        <Label htmlFor="wf-desc">Descripción (opcional)</Label>
        <Input id="wf-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para qué sirve" />
      </div>
      <div>
        <Label>Trigger</Label>
        <Select value={triggerType} onValueChange={(v) => setTriggerType(v as CrmWorkflowTriggerType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="message_received">Mensaje recibido</SelectItem>
            <SelectItem value="conversation_closed">Conversación cerrada</SelectItem>
            <SelectItem value="pms_event">Evento PMS (booking, ticket, etc.)</SelectItem>
            <SelectItem value="scheduled">Programado (cron)</SelectItem>
            <SelectItem value="manual">Manual desde chat</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white">Crear</Button>
      </div>
    </form>
  );
}
