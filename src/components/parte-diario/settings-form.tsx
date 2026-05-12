"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquareText, Clock, Sparkles, Wand2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateParteDiarioManual, updateParteDiarioSettings } from "@/lib/actions/parte-diario";
import type { ParteDiarioSettings } from "@/lib/types/database";

interface SettingsFormProps {
  initial: ParteDiarioSettings;
  channels: { id: string; display_name: string; phone_number: string | null; status: string }[];
  organizationName: string;
}

const TIMEZONES = [
  "America/Argentina/Cordoba",
  "America/Argentina/Buenos_Aires",
  "America/Argentina/Mendoza",
  "America/Santiago",
  "America/Montevideo",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "America/Lima",
  "America/Bogota",
  "Europe/Madrid",
];

export function SettingsForm({ initial, channels, organizationName }: SettingsFormProps) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [channelId, setChannelId] = useState<string>(initial.channel_id ?? "");
  const [templateName, setTemplateName] = useState(initial.template_name);
  const [templateLang, setTemplateLang] = useState(initial.template_language);
  const [autoCreate, setAutoCreate] = useState(initial.auto_create_cleaning_tasks);
  const [autoAssign, setAutoAssign] = useState(initial.auto_assign_cleaning);
  const [orgLabel, setOrgLabel] = useState(initial.organization_label ?? organizationName);
  const [pending, startTransition] = useTransition();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateParteDiarioSettings({
          enabled,
          timezone,
          channel_id: channelId || null,
          template_name: templateName,
          template_language: templateLang,
          auto_create_cleaning_tasks: autoCreate,
          auto_assign_cleaning: autoAssign,
          organization_label: orgLabel,
        });
        toast.success("Configuración guardada");
      } catch (err) {
        toast.error("No se pudo guardar", { description: (err as Error).message });
      }
    });
  };

  const handleGenerateNow = () => {
    startTransition(async () => {
      try {
        const res = await generateParteDiarioManual();
        toast.success(`Borrador generado para ${res.date}`, {
          description: "Lo encontrás en /dashboard/parte-diario",
        });
      } catch (err) {
        toast.error("No se pudo generar", { description: (err as Error).message });
      }
    });
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Bloque: activación */}
      <Card icon={<Sparkles className="size-4 text-cyan-500" />} title="Generación automática">
        <Row label="Habilitar el parte diario automático" hint="El cron horario revisa todas las orgs cada hora.">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </Row>
        <Row label="Nombre que aparece en el PDF + WhatsApp">
          <Input
            value={orgLabel}
            onChange={(e) => setOrgLabel(e.target.value)}
            placeholder={organizationName}
            className="max-w-xs"
          />
        </Row>
      </Card>

      {/* Bloque: timing */}
      <Card icon={<Clock className="size-4 text-amber-500" />} title="Horarios">
        <Row label="Zona horaria" hint="Define qué fecha cuenta como 'mañana' al armar el parte.">
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <ScheduleInfo timezone={timezone} />
      </Card>

      {/* Bloque: automatismos */}
      <Card icon={<Wand2 className="size-4 text-violet-500" />} title="Automatismos del borrador">
        <Row
          label="Crear tareas de limpieza faltantes"
          hint="Para cada check-out de mañana sin tarea, crea una con checklist por defecto."
        >
          <Switch checked={autoCreate} onCheckedChange={setAutoCreate} />
        </Row>
        <Row
          label="Auto-asignar limpiezas balanceando carga"
          hint="Round-robin entre staff con rol limpieza/recepción/mantenimiento."
        >
          <Switch checked={autoAssign} onCheckedChange={setAutoAssign} />
        </Row>
      </Card>

      {/* Bloque: WhatsApp */}
      <Card icon={<MessageSquareText className="size-4 text-emerald-500" />} title="WhatsApp">
        <Row
          label="Canal"
          hint={
            channels.length === 0
              ? "Configurá un canal Meta Cloud en /dashboard/crm/canales antes de enviar."
              : "Desde qué número WA se envía."
          }
        >
          <Select value={channelId} onValueChange={setChannelId} disabled={channels.length === 0}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Seleccionar canal" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.display_name} {c.phone_number ? `· +${c.phone_number}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Nombre de plantilla aprobada" hint="Definida en Meta Business Manager.">
          <Input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            className="max-w-xs font-mono text-sm"
          />
        </Row>
        <Row label="Idioma de la plantilla">
          <Input
            value={templateLang}
            onChange={(e) => setTemplateLang(e.target.value)}
            placeholder="es"
            className="max-w-[120px] font-mono text-sm"
          />
        </Row>
      </Card>

      <TemplateGuide templateName={templateName} language={templateLang} />

      <div className="sticky bottom-0 -mx-4 sm:-mx-6 border-t bg-background/90 backdrop-blur-xl px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleGenerateNow}
          disabled={pending}
          className="gap-1.5"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Generar borrador ahora
        </Button>
        <Button type="submit" disabled={pending} className="gap-1.5">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card overflow-hidden">
      <header className="flex items-center gap-2 px-5 py-3 border-b bg-muted/30">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground mt-0.5">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ScheduleInfo({ timezone }: { timezone: string }) {
  // Vercel Hobby restringe crons a "una vez por día". Los disparamos a horas
  // UTC fijas y mostramos el equivalente local de cada org acá.
  const draftLocal = utcHourToLocal(23, timezone);
  const reminderLocal = utcHourToLocal(3, timezone);
  return (
    <div className="px-5 py-3.5 bg-muted/20 border-t border-dashed">
      <div className="flex items-start gap-2 text-xs">
        <Info className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p className="text-foreground">
            <span className="font-medium">Horarios automáticos</span> (configurados por la
            plataforma — Hobby permite una corrida diaria por cron):
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              · <span className="font-medium text-foreground">Borrador del parte</span>: 23:00 UTC
              {" → "}
              <span className="tabular-nums font-medium">{draftLocal}</span> hora local
            </li>
            <li>
              · <span className="font-medium text-foreground">Recordatorio</span>: 03:00 UTC
              {" → "}
              <span className="tabular-nums font-medium">{reminderLocal}</span> hora local (si
              sigue en borrador)
            </li>
          </ul>
          <p className="text-muted-foreground/80">
            Para otros horarios usá <span className="font-medium">Generar borrador ahora</span>{" "}
            abajo.
          </p>
        </div>
      </div>
    </div>
  );
}

function utcHourToLocal(utcHour: number, timezone: string): string {
  // Construyo un Date arbitrario hoy a la hora UTC y formateo en la tz local.
  const today = new Date();
  const probe = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
      utcHour,
      0,
      0,
    ),
  );
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(probe);
}

function TemplateGuide({ templateName, language }: { templateName: string; language: string }) {
  return (
    <section className="rounded-2xl border border-dashed bg-muted/20 overflow-hidden">
      <header className="px-5 py-3 border-b border-dashed bg-muted/30">
        <h2 className="text-sm font-semibold">Plantilla sugerida para Meta</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Copiá este contenido en Meta Business Manager → WhatsApp → Plantillas → Crear plantilla.
          Una vez aprobada, podés enviar partes diarios.
        </p>
      </header>
      <div className="p-5 space-y-3 text-sm">
        <Field label="Nombre" value={templateName} mono />
        <Field label="Categoría" value="UTILITY" />
        <Field label="Idioma" value={language === "es" ? "Spanish (es)" : language} />
        <Field label="Encabezado" value="Documento  ← (sin contenido estático)" />
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
            Cuerpo
          </p>
          <pre className="text-xs whitespace-pre-wrap rounded-lg border bg-background px-3 py-2 font-mono leading-relaxed">
{`Hola {{1}}, te compartimos el parte diario de {{2}} para {{3}}.

Adjuntamos el PDF con los check-ins, check-outs, limpiezas asignadas y arreglos del día. También podés ver tus tareas individuales abriendo el sistema desde tu celular.`}
          </pre>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
            Ejemplos para Meta
          </p>
          <ul className="text-xs space-y-1 font-mono">
            <li>{"{{1}}"} = Deysy</li>
            <li>{"{{2}}"} = rentOS</li>
            <li>{"{{3}}"} = miércoles 7 de mayo</li>
          </ul>
        </div>
        <Field label="Pie (opcional)" value="Notificación operativa automatizada" />
        <Field label="Botones" value="Ninguno" />
      </div>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground w-32 shrink-0">
        {label}
      </span>
      <span className={mono ? "font-mono text-xs" : "text-sm"}>{value}</span>
    </div>
  );
}
