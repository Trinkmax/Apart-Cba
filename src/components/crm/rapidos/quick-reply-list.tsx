"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Zap, Search, Variable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { upsertQuickReply, deleteQuickReply } from "@/lib/actions/crm-quick-replies";
import type { CrmQuickReply, UserRole } from "@/lib/types/database";

const ALL_ROLES: UserRole[] = ["admin", "recepcion", "mantenimiento", "limpieza", "owner_view"];

interface Props {
  rapidos: CrmQuickReply[];
  canEdit: boolean;
}

export function RapidosList({ rapidos, canEdit }: Props) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CrmQuickReply | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const filtered = rapidos.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.shortcut.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.body.toLowerCase().includes(q);
  });

  const handleDelete = (id: string) => {
    if (!confirm("¿Eliminar este rápido?")) return;
    startTransition(async () => {
      await deleteQuickReply(id);
      router.refresh();
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="size-6 text-amber-500" />
            Rápidos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plantillas reutilizables. Tipear <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">/shortcut</kbd> en el chat para insertarlos.
          </p>
        </div>
        {canEdit && (
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5">
                <Plus className="size-4" /> Nuevo rápido
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Nuevo rápido</DialogTitle></DialogHeader>
              <RapidoForm onClose={() => setCreating(false)} />
            </DialogContent>
          </Dialog>
        )}
      </header>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar rápidos..."
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center">
          <Zap className="size-12 mx-auto mb-3 text-muted-foreground/40" />
          <h2 className="font-semibold mb-1">Sin rápidos {search ? "que coincidan" : "todavía"}</h2>
          {canEdit && !search && (
            <Button onClick={() => setCreating(true)} className="bg-emerald-500 hover:bg-emerald-600 text-white mt-3">
              <Plus className="size-4 mr-1.5" /> Crear primer rápido
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={r.id} className="border border-border rounded-lg p-3 hover:border-foreground/20 transition-colors bg-card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono">
                      /{r.shortcut}
                    </code>
                    <span className="font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground">· usado {r.usage_count}x</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2 whitespace-pre-wrap">{r.body}</p>
                  {r.variables.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      <Variable className="size-3 text-muted-foreground" />
                      {r.variables.map((v) => (
                        <code key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{v}</code>
                      ))}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Dialog open={editing?.id === r.id} onOpenChange={(v) => setEditing(v ? r : null)}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><Pencil className="size-3.5" /></Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader><DialogTitle>Editar rápido</DialogTitle></DialogHeader>
                        {editing && <RapidoForm initial={editing} onClose={() => setEditing(null)} />}
                      </DialogContent>
                    </Dialog>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:text-red-500" onClick={() => handleDelete(r.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RapidoForm({ initial, onClose }: { initial?: CrmQuickReply; onClose: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [shortcut, setShortcut] = useState(initial?.shortcut ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [visibleToRoles, setVisibleToRoles] = useState<UserRole[]>(initial?.visible_to_roles ?? ["admin", "recepcion"]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await upsertQuickReply({
          id: initial?.id,
          shortcut: shortcut.trim().replace(/^\//, ""),
          title: title.trim(),
          body,
          visibleToRoles,
        });
        toast.success(initial ? "Rápido actualizado" : "Rápido creado");
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label>Shortcut</Label>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">/</span>
          <Input
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value.replace(/[^a-z0-9_-]/gi, "").toLowerCase())}
            placeholder="saludo"
            className="pl-5"
            required
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Solo letras, números, guiones. Tipear /{shortcut || "shortcut"} en el chat.</p>
      </div>
      <div>
        <Label>Título</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Saludo de bienvenida" required />
      </div>
      <div>
        <Label>Mensaje</Label>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Hola {{contact.name}}! Gracias por contactarte..." required />
        <p className="text-[10px] text-muted-foreground mt-1">Soporta variables: {"{{contact.name}}"}, {"{{guest_name}}"}, etc.</p>
      </div>
      <div>
        <Label>Visible para roles</Label>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {ALL_ROLES.map((role) => {
            const checked = visibleToRoles.includes(role);
            return (
              <label key={role} className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    if (v) setVisibleToRoles([...visibleToRoles, role]);
                    else setVisibleToRoles(visibleToRoles.filter((r) => r !== role));
                  }}
                />
                <span className="text-sm capitalize">{role}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white">{initial ? "Guardar" : "Crear"}</Button>
      </div>
    </form>
  );
}
