"use client";

import { useEffect, useState, useTransition } from "react";
import {
  MessageSquareText,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "@/lib/actions/messaging";
import { SectionHeader } from "./section-header";
import { toast } from "sonner";
import type { MessagingTemplate } from "@/lib/types/database";

const CATEGORIES = [
  { key: "pre-arrival", label: "Pre-llegada", color: "#3b82f6" },
  { key: "during-stay", label: "En estadía", color: "#10b981" },
  { key: "post-stay", label: "Post-estadía", color: "#a855f7" },
  { key: "service", label: "Servicio", color: "#f59e0b" },
];

interface Props {
  initialTemplates: MessagingTemplate[];
}

export function MessagingQuickReplies({ initialTemplates }: Props) {
  const [templates, setTemplates] = useState<MessagingTemplate[]>(initialTemplates);
  const [editing, setEditing] = useState<MessagingTemplate | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | "all">("all");

  const filtered = templates.filter((t) => {
    if (category !== "all" && (t.category ?? "") !== category) return false;
    if (search.trim()) {
      const s = search.toLowerCase();
      return (
        t.shortcut.toLowerCase().includes(s) ||
        t.title.toLowerCase().includes(s) ||
        t.body.toLowerCase().includes(s)
      );
    }
    return true;
  });

  return (
    <>
      <SectionHeader
        title="Mensajes rápidos"
        description='Plantillas que insertás en el chat con "/" durante una conversación'
        icon={MessageSquareText}
        iconColor="text-emerald-500"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            className="gap-2"
          >
            <Plus size={15} />
            Nuevo mensaje
          </Button>
        }
      />

      <div className="flex-shrink-0 border-b border-border px-6 py-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por shortcut, título o contenido…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          <CategoryPill active={category === "all"} label="Todos" onClick={() => setCategory("all")} />
          {CATEGORIES.map((c) => (
            <CategoryPill
              key={c.key}
              active={category === c.key}
              label={c.label}
              color={c.color}
              onClick={() => setCategory(c.key)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="grid place-items-center py-20">
            <div className="text-center max-w-md space-y-3">
              <div className="size-14 mx-auto rounded-2xl bg-muted/60 grid place-items-center">
                <MessageSquareText className="size-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold">
                {templates.length === 0 ? "Sin mensajes rápidos" : "Sin resultados"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {templates.length === 0
                  ? "Creá plantillas para responder más rápido. Las invocás en el chat tipeando /"
                  : "Probá con otro filtro o buscador"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 max-w-[1800px]">
            {filtered.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onEdit={() => {
                  setEditing(t);
                  setOpen(true);
                }}
                onChange={(updated) => {
                  setTemplates((prev) =>
                    updated
                      ? prev.map((x) => (x.id === updated.id ? updated : x))
                      : prev.filter((x) => x.id !== t.id)
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>

      <TemplateFormDialog
        open={open}
        onOpenChange={setOpen}
        template={editing}
        onSaved={(t) =>
          setTemplates((prev) => {
            const idx = prev.findIndex((x) => x.id === t.id);
            if (idx === -1) return [t, ...prev];
            const copy = [...prev];
            copy[idx] = t;
            return copy;
          })
        }
      />
    </>
  );
}

function CategoryPill({
  active,
  label,
  color,
  onClick,
}: {
  active: boolean;
  label: string;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-medium border transition-colors",
        active
          ? "bg-foreground text-background border-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      style={
        active && color
          ? {
              backgroundColor: color,
              borderColor: color,
              color: "#fff",
            }
          : undefined
      }
    >
      {label}
    </button>
  );
}

function TemplateCard({
  template,
  onEdit,
  onChange,
}: {
  template: MessagingTemplate;
  onEdit: () => void;
  onChange: (updated: MessagingTemplate | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const cat = CATEGORIES.find((c) => c.key === template.category);
  return (
    <article className="rounded-2xl border border-border bg-card p-4 space-y-3 group hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <code
          className="text-xs font-mono px-2 py-0.5 rounded bg-primary/10 text-primary font-medium"
          title="Shortcut"
        >
          {template.shortcut}
        </code>
        {cat && (
          <span
            className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${cat.color}1A`, color: cat.color }}
          >
            {cat.label}
          </span>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold leading-snug line-clamp-1">{template.title}</h3>
        <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap mt-1">
          {template.body}
        </p>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{template.usage_count} usos</span>
        <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => {
              navigator.clipboard.writeText(template.body);
              toast.success("Copiado al portapapeles");
            }}
            title="Copiar"
          >
            <Copy size={12} />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" onClick={onEdit} title="Editar">
            <Pencil size={12} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
            disabled={pending}
            onClick={() => {
              if (!confirm("¿Eliminar este mensaje rápido?")) return;
              startTransition(async () => {
                try {
                  await deleteTemplate(template.id);
                  onChange(null);
                  toast.success("Eliminado");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error");
                }
              });
            }}
            title="Eliminar"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>
    </article>
  );
}

function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: MessagingTemplate | null;
  onSaved: (t: MessagingTemplate) => void;
}) {
  const [shortcut, setShortcut] = useState("/");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setShortcut(template?.shortcut ?? "/");
    setTitle(template?.title ?? "");
    setBody(template?.body ?? "");
    setCategory(template?.category ?? "");
  }, [open, template]);

  const submit = () => {
    const sc = shortcut.trim();
    if (!sc.startsWith("/")) return toast.error('El shortcut debe empezar con "/"');
    if (!title.trim() || !body.trim()) return;

    startTransition(async () => {
      try {
        const r = template
          ? await updateTemplate(template.id, {
              shortcut: sc,
              title: title.trim(),
              body: body.trim(),
              category: category || null,
            })
          : await createTemplate({
              shortcut: sc,
              title: title.trim(),
              body: body.trim(),
              category: category || null,
              attachments: [],
              active: true,
            });
        onSaved(r);
        toast.success(template ? "Actualizado" : "Creado");
        onOpenChange(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{template ? "Editar mensaje rápido" : "Nuevo mensaje rápido"}</DialogTitle>
          <DialogDescription>
            Crea plantillas que invocás en el chat con &quot;/&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tpl-sc">Shortcut</Label>
              <Input
                id="tpl-sc"
                value={shortcut}
                onChange={(e) => setShortcut(e.target.value)}
                placeholder="/info"
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="tpl-cat">Categoría</Label>
              <select
                id="tpl-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1.5 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sin categoría</option>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="tpl-title">Título</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ej. Bienvenida estándar"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="tpl-body">Cuerpo del mensaje</Label>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Hola {NOMBRE}…"
              className="mt-1.5 resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!shortcut.trim() || !title.trim() || !body.trim() || pending}>
            {template ? "Guardar cambios" : "Crear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
