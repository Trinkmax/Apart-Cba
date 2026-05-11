"use client";

import { useState, useTransition, useRef } from "react";
import { Eye, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { updateOrgTemplate } from "@/lib/actions/org";
import { ALLOWED_TEMPLATE_VARS } from "@/lib/email/templates/variables";
import { renderTemplate } from "@/lib/email/render";
import type { OrgMessageTemplate } from "@/lib/types/database";

const SAMPLE_VARS = {
  guest: {
    full_name: "María González",
    first_name: "María",
    email: "maria@example.com",
    phone: "+54 9 351 555-1234",
  },
  org: {
    name: "Monaco Suites",
    contact_phone: "+54 9 351 444-0000",
    contact_email: "hola@monacosuites.com",
    address: "Av. Colón 123, Córdoba",
  },
  unit: {
    name: "Departamento 3B",
    code: "MONACO-3B",
    address: "Av. Colón 123, Córdoba",
  },
  booking: {
    check_in_date: "Lun 12 May 2026",
    check_in_date_iso: "2026-05-12",
    check_out_date: "Vie 16 May 2026",
    check_out_date_iso: "2026-05-16",
    nights: 4,
    guests_count: 2,
    total_amount: "$ 240.000",
    total_amount_raw: "240000",
    currency: "ARS",
    balance_due: "$ 0",
    payment_link: "https://app/pay/abc123",
  },
};

interface Props {
  template: OrgMessageTemplate;
}

export function TemplateEditor({ template }: Props) {
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const variables = ALLOWED_TEMPLATE_VARS[template.event_type] ?? [];

  function insertVariable(varName: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const insert = `{{${varName}}}`;
    const next = body.slice(0, start) + insert + body.slice(end);
    setBody(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + insert.length, start + insert.length);
    }, 0);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateOrgTemplate({
        id: template.id,
        subject: subject.trim() || null,
        body: body.trim(),
      });
      if (!result.ok) {
        toast.error("Error al guardar", { description: result.error });
        return;
      }
      toast.success("Template actualizado");
    });
  }

  function handleRestore() {
    if (!confirm("¿Restaurar al template default? Vas a perder tus cambios.")) return;
    // TODO: Un restore "real" requeriría un server action que reseed el template
    // desde el default original. Por ahora notificamos al usuario.
    toast.info("Para restaurar al default, contactá a soporte (feature en desarrollo).");
  }

  const renderedBody = renderTemplate(body, SAMPLE_VARS);
  const renderedSubject = renderTemplate(subject || "", SAMPLE_VARS);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
      <div className="space-y-3">
        {template.channel === "email" && (
          <div className="space-y-2">
            <Label htmlFor={`s_${template.id}`}>Asunto</Label>
            <Input
              id={`s_${template.id}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={`b_${template.id}`}>Cuerpo</Label>
          <Textarea
            id={`b_${template.id}`}
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={handleRestore}>
            <RotateCcw size={14} className="mr-1.5" /> Restaurar default
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye size={14} className="mr-1.5" /> Vista previa
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            Guardar
          </Button>
        </div>
      </div>

      <aside>
        <Label className="text-xs">Variables disponibles</Label>
        <p className="text-xs text-muted-foreground mb-2">Click para insertar en el cuerpo.</p>
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="block w-full text-left text-xs font-mono px-2 py-1 rounded hover:bg-accent"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </aside>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Vista previa con datos de ejemplo</DialogTitle>
          </DialogHeader>
          {template.channel === "email" && renderedSubject && (
            <div className="text-sm">
              <span className="font-semibold">Asunto: </span>
              {renderedSubject}
            </div>
          )}
          <div className="rounded-md border bg-background p-4 whitespace-pre-wrap text-sm">
            {renderedBody}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
