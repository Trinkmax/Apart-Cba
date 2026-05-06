"use client";

import { useMemo, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listNodes } from "@/lib/crm/workflows/registry";
import { VariablePicker } from "./variable-picker";
import type { Node } from "@xyflow/react";
import type { CrmTag, CrmWhatsAppTemplate } from "@/lib/types/database";

interface Props {
  node: Node;
  tags: CrmTag[];
  templates: CrmWhatsAppTemplate[];
  aiEnabledModels: string[];
  onClose: () => void;
  onChange: (config: Record<string, unknown>) => void;
  onDelete: () => void;
}

const ALL_NODES = listNodes();

export function NodeSettingsDrawer({ node, tags, templates, aiEnabledModels, onClose, onChange, onDelete }: Props) {
  const data = node.data as { nodeType: string; config?: Record<string, unknown> };
  const def = useMemo(() => ALL_NODES.find((n) => n.type === data.nodeType), [data.nodeType]);
  // El parent monta este componente con `key={node.id}` al cambiar de nodo,
  // por lo que el state inicial siempre arranca limpio sin necesidad de useEffect.
  const [config, setConfig] = useState<Record<string, unknown>>(data.config ?? {});

  const update = (key: string, value: unknown) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    onChange(next);
  };

  if (!def) {
    return (
      <Sheet open onOpenChange={onClose}>
        <SheetContent className="w-[420px] sm:max-w-[420px]">
          <SheetTitle>Nodo desconocido</SheetTitle>
          <p className="text-sm text-muted-foreground">Tipo: {data.nodeType}</p>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent className="w-[440px] sm:max-w-[440px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            {def.label}
            <button onClick={onClose} className="size-7 flex items-center justify-center rounded hover:bg-muted">
              <X className="size-4" />
            </button>
          </SheetTitle>
          <p className="text-xs text-muted-foreground">{def.description}</p>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Render fields según tipo de nodo */}
          {renderFields(def.type, config, update, { tags, templates, aiEnabledModels })}
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          {!def.isTrigger && (
            <Button variant="ghost" className="w-full text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onDelete}>
              <Trash2 className="size-4 mr-1.5" /> Eliminar nodo
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function renderFields(
  type: string,
  config: Record<string, unknown>,
  update: (key: string, value: unknown) => void,
  ctx: { tags: CrmTag[]; templates: CrmWhatsAppTemplate[]; aiEnabledModels: string[] },
) {
  switch (type) {
    case "send_message":
      return (
        <>
          <Field
            label="Texto del mensaje"
            hint="Soporta variables {{contact.name}}, {{text}}, etc."
            action={<VariablePicker onInsert={(v) => update("text", `${(config.text as string) ?? ""}${v}`)} />}
          >
            <Textarea
              value={(config.text as string) ?? ""}
              onChange={(e) => update("text", e.target.value)}
              rows={5}
            />
          </Field>
          <Field label="Mostrar preview de URL">
            <Switch
              checked={!!config.previewUrl}
              onCheckedChange={(v) => update("previewUrl", v)}
            />
          </Field>
        </>
      );

    case "send_template":
      return (
        <>
          <Field label="Template aprobado" hint="Solo APPROVED visibles">
            <Select value={(config.templateId as string) ?? ""} onValueChange={(v) => update("templateId", v)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {ctx.templates.filter((t) => t.meta_status === "approved").map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} · {t.language}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className="text-xs text-muted-foreground">
            Las variables del template se mapean automáticamente desde las vars del workflow.
          </p>
        </>
      );

    case "wait_time":
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duración">
            <Input type="number" min={1} value={(config.duration as number) ?? 60} onChange={(e) => update("duration", parseInt(e.target.value, 10))} />
          </Field>
          <Field label="Unidad">
            <Select value={(config.unit as string) ?? "seconds"} onValueChange={(v) => update("unit", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">Segundos</SelectItem>
                <SelectItem value="minutes">Minutos</SelectItem>
                <SelectItem value="hours">Horas</SelectItem>
                <SelectItem value="days">Días</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      );

    case "wait_for_reply":
      return (
        <Field label="Timeout (minutos)">
          <Input type="number" min={1} value={(config.timeoutMinutes as number) ?? 60} onChange={(e) => update("timeoutMinutes", parseInt(e.target.value, 10))} />
        </Field>
      );

    case "condition": {
      const rules = (config.rules as { path: string; op: string; value?: string }[]) ?? [{ path: "text", op: "contains", value: "" }];
      return (
        <>
          <Field label="Reglas (todas deben cumplirse si AND, alguna si OR)">
            <div className="space-y-2">
              {rules.map((rule, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input
                    placeholder="path (ej: text)"
                    value={rule.path}
                    onChange={(e) => {
                      const next = [...rules];
                      next[idx] = { ...rule, path: e.target.value };
                      update("rules", next);
                    }}
                    className="flex-1"
                  />
                  <Select value={rule.op} onValueChange={(v) => {
                    const next = [...rules];
                    next[idx] = { ...rule, op: v };
                    update("rules", next);
                  }}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eq">igual a</SelectItem>
                      <SelectItem value="neq">distinto</SelectItem>
                      <SelectItem value="contains">contiene</SelectItem>
                      <SelectItem value="gt">mayor que</SelectItem>
                      <SelectItem value="lt">menor que</SelectItem>
                      <SelectItem value="matches">regex</SelectItem>
                      <SelectItem value="is_empty">vacío</SelectItem>
                      <SelectItem value="not_empty">no vacío</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="valor"
                    value={rule.value ?? ""}
                    onChange={(e) => {
                      const next = [...rules];
                      next[idx] = { ...rule, value: e.target.value };
                      update("rules", next);
                    }}
                    className="flex-1"
                  />
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => update("rules", [...rules, { path: "", op: "contains", value: "" }])}>
                + Agregar regla
              </Button>
            </div>
          </Field>
          <Field label="Joiner">
            <Select value={(config.joiner as string) ?? "and"} onValueChange={(v) => update("joiner", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="and">AND</SelectItem>
                <SelectItem value="or">OR</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      );
    }

    case "add_tag":
    case "remove_tag":
      return (
        <Field label="Tag">
          <Select value={(config.tagSlug as string) ?? ""} onValueChange={(v) => update("tagSlug", v)}>
            <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              {ctx.tags.map((t) => (
                <SelectItem key={t.id} value={t.slug}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );

    case "ai_response":
      return (
        <>
          <Field label="Modelo">
            <Select value={(config.model as string) ?? ctx.aiEnabledModels[0]} onValueChange={(v) => update("model", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ctx.aiEnabledModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="System prompt">
            <Textarea value={(config.systemPrompt as string) ?? ""} onChange={(e) => update("systemPrompt", e.target.value)} rows={6} />
          </Field>
          <Field label="Incluir historial">
            <Switch checked={!!config.includeHistory} onCheckedChange={(v) => update("includeHistory", v)} />
          </Field>
          <Field label="Enviar como mensaje al cliente">
            <Switch checked={!!config.sendAsMessage} onCheckedChange={(v) => update("sendAsMessage", v)} />
          </Field>
        </>
      );

    case "ai_auto_tag":
      return (
        <>
          <Field label="Modelo">
            <Select value={(config.model as string) ?? ctx.aiEnabledModels[0]} onValueChange={(v) => update("model", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ctx.aiEnabledModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tags candidatos a aplicar">
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-auto">
              {ctx.tags.map((t) => {
                const slugs = (config.candidateTagSlugs as string[]) ?? [];
                const checked = slugs.includes(t.slug);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => update("candidateTagSlugs", checked ? slugs.filter((s) => s !== t.slug) : [...slugs, t.slug])}
                    className="px-2 py-1 rounded-full text-xs border"
                    style={{
                      backgroundColor: checked ? `${t.color}33` : "transparent",
                      borderColor: checked ? t.color : "rgba(255,255,255,0.1)",
                      color: checked ? t.color : "currentColor",
                    }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </Field>
        </>
      );

    case "crm_alert":
      return (
        <>
          <Field label="Título"><Input value={(config.title as string) ?? ""} onChange={(e) => update("title", e.target.value)} /></Field>
          <Field label="Cuerpo (opcional)"><Textarea rows={3} value={(config.body as string) ?? ""} onChange={(e) => update("body", e.target.value)} /></Field>
          <Field label="Severidad">
            <Select value={(config.severity as string) ?? "warning"} onValueChange={(v) => update("severity", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
                <SelectItem value="success">Success</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      );

    case "http_request":
      return (
        <>
          <Field label="Método">
            <Select value={(config.method as string) ?? "GET"} onValueChange={(v) => update("method", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="URL"><Input value={(config.url as string) ?? ""} onChange={(e) => update("url", e.target.value)} /></Field>
          <Field label="Body (opcional)"><Textarea rows={4} value={(config.body as string) ?? ""} onChange={(e) => update("body", e.target.value)} /></Field>
          <Field label="Guardar respuesta como"><Input placeholder="ej: response_data" value={(config.saveAs as string) ?? ""} onChange={(e) => update("saveAs", e.target.value)} /></Field>
        </>
      );

    case "set_variable":
      return (
        <>
          <Field label="Nombre"><Input value={(config.name as string) ?? ""} onChange={(e) => update("name", e.target.value)} /></Field>
          <Field label="Valor (soporta variables)"><Input value={(config.value as string) ?? ""} onChange={(e) => update("value", e.target.value)} /></Field>
        </>
      );

    case "trigger.message_received":
      return (
        <Field label="Filtros (opcional)">
          <p className="text-xs text-muted-foreground">Configuración avanzada en próxima fase. Por defecto matchea todo mensaje recibido.</p>
        </Field>
      );

    case "trigger.pms_event":
      return (
        <Field label="Evento PMS">
          <Select value={(config.pmsEvent as string) ?? "booking.created"} onValueChange={(v) => update("pmsEvent", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[
                "booking.created", "booking.confirmed", "booking.cancelled",
                "booking.checkin_today", "booking.checkout_today", "booking.checkin_tomorrow",
                "ticket.created", "ticket.closed",
                "cleaning.assigned", "cleaning.completed",
                "payment.received", "payment.overdue",
                "concierge.created",
              ].map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      );

    case "pms_create_ticket":
      return (
        <>
          <Field label="Título"><Input value={(config.title as string) ?? ""} onChange={(e) => update("title", e.target.value)} /></Field>
          <Field label="Descripción (opcional)"><Textarea rows={3} value={(config.description as string) ?? ""} onChange={(e) => update("description", e.target.value)} /></Field>
          <Field label="Prioridad">
            <Select value={(config.priority as string) ?? "media"} onValueChange={(v) => update("priority", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["baja", "media", "alta", "urgente"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Unit source">
            <Select value={(config.unitFrom as string) ?? "contact_active_booking"} onValueChange={(v) => update("unitFrom", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contact_active_booking">Booking activo del contacto</SelectItem>
                <SelectItem value="fixed">Unit fija (especificar)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      );

    default:
      return (
        <p className="text-xs text-muted-foreground">
          Sin formulario específico para este nodo. Edita el config como JSON:
        </p>
      );
  }
}

function Field({
  label, hint, children, action,
}: { label: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {action}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground mb-1">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}
