"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, Info, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { saveWebSettings } from "@/lib/actions/web-settings";
import { formatPhoneAR, whatsappLink } from "@/lib/marketplace/display";
import {
  aliasError,
  cbuChecksumOk,
  cbuError,
  cuitChecksumOk,
  cuitError,
  emailError,
  instagramError,
  intInRangeError,
  normalizeAlias,
  normalizeCbu,
  normalizeCuit,
  normalizeInstagram,
  senaExample,
  toWhatsappDigits,
  transferLines,
  validateWebSettingsInput,
  whatsappError,
  type DepositRule,
  type WebSettingsField,
  type WebSettingsInput,
} from "@/lib/marketplace/staff-helpers";

/** Valores del formulario tal cual se tipean (todo texto salvo la regla). */
export interface WebSettingsFormInitial {
  whatsapp_number: string;
  public_email: string;
  instagram_handle: string;
  response_hours: string;
  deposit_rule: DepositRule;
  deposit_percent: string;
  deposit_due_hours: string;
  transfer_holder: string;
  transfer_cuit: string;
  transfer_bank: string;
  transfer_cbu: string;
  transfer_alias: string;
  transfer_notes: string;
  cancellation_text: string;
}

type Errors = Partial<Record<WebSettingsField, string>>;

const RULES: Array<{ value: DepositRule; label: string; hint: string }> = [
  { value: "one_night", label: "Una noche", hint: "El valor de la primera noche (sin limpieza)." },
  { value: "percent", label: "Un porcentaje", hint: "Un % del total de la estadía." },
  { value: "none", label: "Sin seña", hint: "El huésped paga todo al llegar." },
];

const toInt = (v: string): number | null => {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Error de UN campo (validación en línea al salir del campo). */
function fieldError(field: WebSettingsField, v: WebSettingsFormInitial): string | null {
  switch (field) {
    case "whatsapp_number":
      return whatsappError(toWhatsappDigits(v.whatsapp_number));
    case "public_email":
      return emailError(v.public_email.trim().toLowerCase());
    case "instagram_handle":
      return instagramError(normalizeInstagram(v.instagram_handle));
    case "response_hours":
      return intInRangeError(toInt(v.response_hours), 1, 48, "Respondemos en");
    case "deposit_percent": {
      if (v.deposit_rule !== "percent") return null;
      const n = toInt(v.deposit_percent);
      return n == null || n < 1 || n > 100 ? "El porcentaje va de 1 a 100." : null;
    }
    case "deposit_due_hours":
      return intInRangeError(toInt(v.deposit_due_hours), 1, 168, "Plazo para transferir");
    case "transfer_cuit":
      return cuitError(normalizeCuit(v.transfer_cuit));
    case "transfer_cbu":
      return cbuError(normalizeCbu(v.transfer_cbu));
    case "transfer_alias":
      return aliasError(normalizeAlias(v.transfer_alias));
    default:
      return null;
  }
}

export function WebSettingsForm({
  initial,
  orgContactEmail,
}: {
  initial: WebSettingsFormInitial;
  orgContactEmail: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<WebSettingsFormInitial>(initial);
  const [saved, setSaved] = useState<WebSettingsFormInitial>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = useMemo(
    () => (Object.keys(values) as Array<keyof WebSettingsFormInitial>).some((k) => values[k] !== saved[k]),
    [values, saved],
  );

  function set<K extends keyof WebSettingsFormInitial>(key: K, value: WebSettingsFormInitial[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Mientras corrige, el error viejo se va; vuelve a validarse al salir del campo.
    if (errors[key as WebSettingsField]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validateOnBlur(field: WebSettingsField) {
    const err = fieldError(field, values);
    setErrors((prev) => ({ ...prev, [field]: err ?? undefined }));
  }

  function focusField(field: string) {
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function toInput(v: WebSettingsFormInitial): WebSettingsInput {
    // Con "Sin seña" el plazo no se ve: si quedó inválido, va el guardado (o 24 h).
    const hiddenDueInvalid = v.deposit_rule === "none" && fieldError("deposit_due_hours", v) != null;
    const fallbackDue = fieldError("deposit_due_hours", saved) == null ? saved.deposit_due_hours : "24";
    return {
      ...v,
      deposit_percent: v.deposit_rule === "percent" ? v.deposit_percent : null,
      deposit_due_hours: hiddenDueInvalid ? fallbackDue : v.deposit_due_hours,
    };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const local = validateWebSettingsInput(toInput(values));
    if (!local.ok) {
      setErrors((prev) => ({ ...prev, [local.field]: local.error }));
      focusField(local.field);
      toast.error("Revisá los datos marcados.");
      return;
    }
    startTransition(async () => {
      const res = await saveWebSettings(toInput(values));
      if (!res.ok) {
        if (res.field) {
          setErrors((prev) => ({ ...prev, [res.field as WebSettingsField]: res.error }));
          focusField(res.field);
        }
        toast.error(res.error);
        return;
      }
      // Lo guardado queda normalizado (dígitos, alias en minúsculas, CUIT con guiones).
      const v = local.value;
      const normalized: WebSettingsFormInitial = {
        ...values,
        whatsapp_number: v.whatsapp_number ?? "",
        public_email: v.public_email ?? "",
        instagram_handle: v.instagram_handle ?? "",
        response_hours: String(v.response_hours),
        deposit_percent: v.deposit_percent != null ? String(v.deposit_percent) : "",
        deposit_due_hours: String(v.deposit_due_hours),
        transfer_holder: v.transfer_holder ?? "",
        transfer_cuit: v.transfer_cuit ?? "",
        transfer_bank: v.transfer_bank ?? "",
        transfer_cbu: v.transfer_cbu ?? "",
        transfer_alias: v.transfer_alias ?? "",
        transfer_notes: v.transfer_notes ?? "",
        cancellation_text: v.cancellation_text ?? "",
      };
      setValues(normalized);
      setSaved(normalized);
      setErrors({});
      toast.success("Guardamos la configuración de la web.");
      router.refresh();
    });
  }

  // ─── Derivados para las ayudas en vivo ───────────────────────────────────
  const waDigits = toWhatsappDigits(values.whatsapp_number);
  const waValid = waDigits.length > 0 && !whatsappError(waDigits);
  const waPretty = waValid ? formatPhoneAR(waDigits) : null;
  const waTest = waValid ? whatsappLink(waDigits) : null;

  const percentNum = toInt(values.deposit_percent);
  const example = senaExample({
    rule: values.deposit_rule,
    percent: values.deposit_rule === "percent" && percentNum != null && percentNum > 0 ? percentNum : null,
  });
  const exampleText =
    values.deposit_rule === "percent" && (percentNum == null || percentNum <= 0 || percentNum > 100)
      ? "Poné el porcentaje para ver el ejemplo."
      : example.sena != null && example.sena > 0
        ? `Para ${example.nights} noches a ${formatMoney(example.nightly)}: seña ${formatMoney(example.sena)}, al llegar ${formatMoney(example.resto)}.`
        : `Para ${example.nights} noches a ${formatMoney(example.nightly)}: sin seña, al llegar ${formatMoney(example.total)}.`;

  const cbuDigits = normalizeCbu(values.transfer_cbu);
  const cbuWarn = cbuDigits.length === 22 && !cbuChecksumOk(cbuDigits);
  const cuitDigits = normalizeCuit(values.transfer_cuit);
  const cuitWarn = cuitDigits.length === 11 && !cuitChecksumOk(cuitDigits);

  const previewLines = transferLines({
    holder: values.transfer_holder.trim() || null,
    cuit: values.transfer_cuit.trim() || null,
    bank: values.transfer_bank.trim() || null,
    cbu: cbuDigits || null,
    alias: normalizeAlias(values.transfer_alias) || null,
    notes: values.transfer_notes.trim() || null,
  });
  const hasTransfer = Boolean(cbuDigits || normalizeAlias(values.transfer_alias));

  const bind = (field: WebSettingsField) => ({
    id: `ws-${field}`,
    name: field,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": `ws-${field}-help ws-${field}-error`,
    onBlur: () => validateOnBlur(field),
  });

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      {/* 1 · Contacto */}
      <Section
        title="Contacto en la web"
        description="Por dónde te escriben los huéspedes y qué les prometemos."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            field="whatsapp_number"
            label="WhatsApp"
            error={errors.whatsapp_number}
            help={
              <>
                Aparece en la web y en los mails. Es por donde te escriben los huéspedes.
                {waPretty && waTest ? (
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 text-foreground/80">
                    <Check className="size-3.5 text-emerald-600" aria-hidden />
                    Se guarda como {waPretty}
                    <a
                      href={waTest}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                    >
                      Probar <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </span>
                ) : null}
              </>
            }
          >
            <Input
              {...bind("whatsapp_number")}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+54 9 351 123 4567"
              value={values.whatsapp_number}
              onChange={(e) => set("whatsapp_number", e.target.value)}
            />
          </Field>

          <Field
            field="public_email"
            label="Email público"
            error={errors.public_email}
            help={
              orgContactEmail
                ? `Si lo dejás vacío usamos ${orgContactEmail}. Las respuestas a los mails llegan acá.`
                : "Las respuestas de los huéspedes a los mails llegan acá."
            }
          >
            <Input
              {...bind("public_email")}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={orgContactEmail ?? "reservas@tudominio.com"}
              value={values.public_email}
              onChange={(e) => set("public_email", e.target.value)}
            />
          </Field>

          <Field field="instagram_handle" label="Instagram" error={errors.instagram_handle} help="Sin @. Por ejemplo: apart.cba">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                @
              </span>
              <Input
                {...bind("instagram_handle")}
                className="pl-7"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="apart.cba"
                value={values.instagram_handle}
                onChange={(e) => set("instagram_handle", e.target.value)}
              />
            </div>
          </Field>

          <Field
            field="response_hours"
            label="Respondemos en"
            error={errors.response_hours}
            help="Lo que prometemos al huésped (hasta 36 h). Las solicitudes vencen solas a las 48 h."
          >
            <UnitInput suffix="horas">
              <Input
                {...bind("response_hours")}
                type="number"
                inputMode="numeric"
                min={1}
                max={36}
                step={1}
                className="pr-16"
                value={values.response_hours}
                onChange={(e) => set("response_hours", e.target.value)}
              />
            </UnitInput>
          </Field>
        </div>
      </Section>

      {/* 2 · Seña */}
      <Section
        title="Seña"
        description="Cuánto le pedimos al huésped para asegurar la reserva. El resto lo paga al llegar."
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">¿Cómo se calcula?</legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
            {RULES.map((r) => {
              const checked = values.deposit_rule === r.value;
              return (
                <label
                  key={r.value}
                  className={cn(
                    "relative flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm transition-colors",
                    "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                    checked ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="deposit_rule"
                      value={r.value}
                      checked={checked}
                      onChange={() => {
                        set("deposit_rule", r.value);
                        setErrors((prev) => ({ ...prev, deposit_percent: undefined }));
                      }}
                      className="size-4 accent-primary"
                    />
                    {r.label}
                  </span>
                  <span className="pl-6 text-xs text-muted-foreground">{r.hint}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {values.deposit_rule === "percent" ? (
            <Field field="deposit_percent" label="Porcentaje de la seña" error={errors.deposit_percent} help="Del total de la estadía, de 1 a 100.">
              <UnitInput suffix="%">
                <Input
                  {...bind("deposit_percent")}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={100}
                  step="any"
                  className="pr-10"
                  placeholder="30"
                  value={values.deposit_percent}
                  onChange={(e) => set("deposit_percent", e.target.value)}
                />
              </UnitInput>
            </Field>
          ) : null}

          {values.deposit_rule !== "none" ? (
            <Field
              field="deposit_due_hours"
              label="Plazo para transferirla"
              error={errors.deposit_due_hours}
              help="Desde que confirmás la reserva. Entre 1 y 168 horas (una semana)."
            >
              <UnitInput suffix="horas">
                <Input
                  {...bind("deposit_due_hours")}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={168}
                  step={1}
                  className="pr-16"
                  value={values.deposit_due_hours}
                  onChange={(e) => set("deposit_due_hours", e.target.value)}
                />
              </UnitInput>
            </Field>
          ) : null}
        </div>

        <p
          className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <span className="font-medium text-foreground">Ejemplo: </span>
          {exampleText}
        </p>
      </Section>

      {/* 3 · Datos para transferir */}
      <Section title="Datos para transferir la seña" description="A dónde transfiere el huésped cuando confirmás su reserva.">
        <p className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs sm:text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Se muestran al huésped recién cuando confirmás su reserva.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field field="transfer_holder" label="Titular" error={errors.transfer_holder} help="Como figura en la cuenta.">
            <Input
              {...bind("transfer_holder")}
              autoComplete="off"
              placeholder="Apart Cba SRL"
              value={values.transfer_holder}
              onChange={(e) => set("transfer_holder", e.target.value)}
            />
          </Field>

          <Field
            field="transfer_cuit"
            label="CUIT o CUIL"
            error={errors.transfer_cuit}
            warning={cuitWarn ? "El dígito verificador no coincide. Revisalo antes de guardar." : null}
            help="11 números, con o sin guiones."
          >
            <Input
              {...bind("transfer_cuit")}
              inputMode="numeric"
              autoComplete="off"
              placeholder="30-12345678-9"
              value={values.transfer_cuit}
              onChange={(e) => set("transfer_cuit", e.target.value)}
            />
          </Field>

          <Field field="transfer_bank" label="Banco o billetera" error={errors.transfer_bank} help="Por ejemplo: Banco Galicia, Mercado Pago.">
            <Input
              {...bind("transfer_bank")}
              autoComplete="off"
              value={values.transfer_bank}
              onChange={(e) => set("transfer_bank", e.target.value)}
            />
          </Field>

          <Field
            field="transfer_cbu"
            label="CBU o CVU"
            error={errors.transfer_cbu}
            warning={cbuWarn ? "Los dígitos verificadores no coinciden. Si es un CVU puede estar bien; si es un CBU, revisalo." : null}
            help={
              <span className="tabular-nums">
                22 números · {cbuDigits.length}/22
              </span>
            }
          >
            <Input
              {...bind("transfer_cbu")}
              inputMode="numeric"
              autoComplete="off"
              className="font-mono tabular-nums"
              placeholder="0000000000000000000000"
              value={values.transfer_cbu}
              onChange={(e) => {
                set("transfer_cbu", e.target.value);
                const d = normalizeCbu(e.target.value);
                // En línea: apenas pasa de 22 lo marcamos; al completar 22 se limpia.
                if (d.length > 22) setErrors((prev) => ({ ...prev, transfer_cbu: cbuError(d) ?? undefined }));
              }}
            />
          </Field>

          <Field field="transfer_alias" label="Alias" error={errors.transfer_alias} help="Entre 6 y 20 caracteres: letras, números, puntos o guiones.">
            <Input
              {...bind("transfer_alias")}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="apart.cba.reservas"
              value={values.transfer_alias}
              onChange={(e) => set("transfer_alias", e.target.value)}
            />
          </Field>

          <Field
            field="transfer_notes"
            label="Notas (opcional)"
            error={errors.transfer_notes}
            help="Por ejemplo: «En el concepto poné tu apellido»."
            className="sm:col-span-2"
          >
            <Textarea
              {...bind("transfer_notes")}
              rows={2}
              maxLength={500}
              value={values.transfer_notes}
              onChange={(e) => set("transfer_notes", e.target.value)}
            />
          </Field>
        </div>

        <TransferPreview lines={previewLines} hasTransfer={hasTransfer} />
      </Section>

      {/* 4 · Cancelación */}
      <Section
        title="Política de cancelación"
        description="Opcional. Si la dejás vacía, cada unidad muestra la suya."
      >
        <Field field="cancellation_text" label="Texto para el huésped" error={errors.cancellation_text} help="Se muestra en la web y en el mail de confirmación. Máximo 2000 caracteres.">
          <Textarea
            {...bind("cancellation_text")}
            rows={4}
            maxLength={2000}
            placeholder="Por ejemplo: si cancelás hasta 7 días antes de la llegada te devolvemos la seña completa."
            value={values.cancellation_text}
            onChange={(e) => set("cancellation_text", e.target.value)}
          />
        </Field>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {pending ? "Guardando…" : dirty ? "Tenés cambios sin guardar." : "Todo guardado."}
        </p>
        {dirty && !pending ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              setValues(saved);
              setErrors({});
            }}
          >
            Descartar cambios
          </Button>
        ) : null}
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending || !dirty}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
          Guardar
        </Button>
      </div>
    </form>
  );
}

// ─── Piezas ────────────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Field({
  field,
  label,
  help,
  error,
  warning,
  className,
  children,
}: {
  field: WebSettingsField;
  label: string;
  help?: React.ReactNode;
  error?: string;
  warning?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const id = `ws-${field}`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      <div id={`${id}-help`} className="text-xs text-muted-foreground">
        {help}
      </div>
      <p id={`${id}-error`} role={error ? "alert" : undefined} className={cn("text-xs text-destructive", !error && "sr-only")}>
        {error ?? ""}
      </p>
      {!error && warning ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {warning}
        </p>
      ) : null}
    </div>
  );
}

function UnitInput({ suffix, children }: { suffix: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
        {suffix}
      </span>
    </div>
  );
}

/** Lo que ve el huésped al confirmar (misma lista que el mail y el WhatsApp). */
function TransferPreview({ lines, hasTransfer }: { lines: string[]; hasTransfer: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Así lo ve el huésped</p>
      {hasTransfer ? (
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm font-semibold">Datos para transferir la seña</p>
          <div className="mt-2 space-y-1 text-sm">
            {lines.map((line, i) => {
              const idx = line.indexOf(": ");
              if (idx < 0) {
                return (
                  <p key={i} className="pt-1 text-muted-foreground">
                    {line}
                  </p>
                );
              }
              return (
                <div key={i} className="flex flex-wrap gap-x-2">
                  <span className="text-muted-foreground">{line.slice(0, idx)}</span>
                  <span className="font-medium break-all">{line.slice(idx + 2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Todavía no cargaste CBU, CVU ni alias. Mientras tanto, al confirmar una reserva el huésped ve
          «te pasamos los datos por WhatsApp».
        </p>
      )}
    </div>
  );
}
