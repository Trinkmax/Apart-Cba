"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgePercent, HandCoins, Landmark, Loader2, ReceiptText, RotateCcw, Save, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { parseAmountInput, parsePercentInput } from "@/lib/format";
import { INDEX_CODES, INDEX_META, type IndexCode } from "@/lib/rentals/indices";
import { LATE_FEE_TYPE_LABEL, ROUNDING_LABEL } from "@/lib/rentals/labels";
import type { RentalCommissionBasis, RentalLateFeeType, RentalRounding, RentalVatCondition } from "@/lib/types/database";
import { updateRentalSettings } from "@/lib/actions/rentals-settings";
import {
  fromSettingsForm,
  lateFeeEquivalent,
  lateFeeWarning,
  paymentWindowText,
  toSettingsForm,
  type CommissionForm,
  type RentalSettingsForm,
  type RentalSettingsValues,
} from "./settings-model";
import { ChipGroup, Field, SettingsSection, SuffixInput } from "./settings-fields";

const VAT_LABEL: Record<RentalVatCondition, string> = {
  responsable_inscripto: "Responsable inscripto",
  monotributo: "Monotributo",
  exento: "Exento",
};

const BASIS_LABEL: Record<RentalCommissionBasis, string> = {
  pct_total_contrato: "% del total del contrato",
  meses: "Meses de alquiler",
  monto_fijo: "Monto fijo",
  ninguna: "No se cobra",
};

const EVERY_OPTIONS = [
  { value: "3", label: "Trimestral" },
  { value: "4", label: "Cuatrimestral" },
  { value: "6", label: "Semestral" },
  { value: "12", label: "Anual" },
];

const DURATION_OPTIONS = [
  { value: "24", label: "24 meses" },
  { value: "36", label: "36 meses" },
];

function CommissionEditor({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: CommissionForm;
  onChange: (v: CommissionForm) => void;
  error?: boolean;
}) {
  const suffix = value.basis === "pct_total_contrato" ? "%" : value.basis === "meses" ? "meses" : undefined;
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-center">
      <Select value={value.basis} onValueChange={(b) => onChange({ ...value, basis: b as RentalCommissionBasis })}>
        <SelectTrigger className="h-10 w-full" aria-label="Base de los honorarios">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(BASIS_LABEL) as RentalCommissionBasis[]).map((b) => (
            <SelectItem key={b} value={b}>
              {BASIS_LABEL[b]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.basis !== "ninguna" && (
        <>
          <SuffixInput
            id={id}
            value={value.value}
            onChange={(v) => onChange({ ...value, value: v })}
            suffix={suffix}
            prefix={value.basis === "monto_fijo" ? "$" : undefined}
            invalid={error}
          />
          <label className="flex h-10 items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={value.vat} onCheckedChange={(vat) => onChange({ ...value, vat })} aria-label="Sumar IVA" /> + IVA
          </label>
        </>
      )}
    </div>
  );
}

export function RentalsSettingsForm({ initial }: { initial: RentalSettingsValues }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<RentalSettingsForm>(() => toSettingsForm(initial));
  const [f, setF] = useState<RentalSettingsForm>(saved);
  const [errorField, setErrorField] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const set = <K extends keyof RentalSettingsForm>(k: K, v: RentalSettingsForm[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    if (errorField === k) setErrorField(null);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = fromSettingsForm(f);
    if (!parsed.ok) {
      setErrorField(parsed.field);
      toast.error("Revisá un dato", { description: parsed.error });
      document.getElementById(`rs-${parsed.field}`)?.focus();
      return;
    }
    startTransition(async () => {
      const res = await updateRentalSettings(parsed.values);
      if (!res.ok) {
        if (res.field) setErrorField(res.field);
        toast.error("No se pudo guardar", { description: res.error });
        return;
      }
      const next = toSettingsForm(parsed.values);
      setSaved(next);
      setF(next);
      toast.success("Configuración guardada", { description: "Los contratos nuevos ya salen con estos valores." });
      router.refresh();
    });
  }

  const lateNum = f.late_fee_type === "fijo_diario" ? parseAmountInput(f.late_fee_value) : parsePercentInput(f.late_fee_value);
  const lateEq = lateFeeEquivalent(f.late_fee_type, lateNum);
  const lateWarn = lateFeeWarning(f.late_fee_type, lateNum);
  const err = (k: string) => errorField === k;

  return (
    <form onSubmit={submit} className="space-y-5">
      <SettingsSection
        icon={HandCoins}
        title="Cobro del alquiler"
        description="Cuándo vence cada mes y qué pasa si el inquilino paga tarde. Es lo que se precarga en cada contrato nuevo; después se puede cambiar contrato por contrato."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Plazo para pagar" htmlFor="rs-payment_window_days" help={paymentWindowText(Number(f.payment_window_days)) || "Días desde el inicio del período."} error={err("payment_window_days") ? "Entre 1 y 28 días." : null}>
            <SuffixInput id="rs-payment_window_days" inputMode="numeric" value={f.payment_window_days} onChange={(v) => set("payment_window_days", v)} suffix="días" invalid={err("payment_window_days")} />
          </Field>
          <Field label="Días de gracia" htmlFor="rs-grace_days" help="Si paga dentro de la gracia no hay punitorio; después se cuenta desde el vencimiento.">
            <SuffixInput id="rs-grace_days" inputMode="numeric" value={f.grace_days} onChange={(v) => set("grace_days", v)} suffix="días" invalid={err("grace_days")} />
          </Field>
          <Field label="Generar el cargo" htmlFor="rs-charge_lead_days" help="Días antes de cada período: así el inquilino ve lo que debe con tiempo.">
            <SuffixInput id="rs-charge_lead_days" inputMode="numeric" value={f.charge_lead_days} onChange={(v) => set("charge_lead_days", v)} suffix="días antes" invalid={err("charge_lead_days")} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Punitorios por mora" help="La mora es automática (art. 886 CCyC): corre desde el día siguiente al vencimiento.">
            <Select value={f.late_fee_type} onValueChange={(v) => set("late_fee_type", v as RentalLateFeeType)}>
              <SelectTrigger className="h-10 w-full" aria-label="Tipo de punitorio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LATE_FEE_TYPE_LABEL) as RentalLateFeeType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {LATE_FEE_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {f.late_fee_type !== "ninguno" && (
            <Field
              label={f.late_fee_type === "fijo_diario" ? "Monto por día" : "Porcentaje"}
              htmlFor="rs-late_fee_value"
              help={lateWarn ?? lateEq}
              error={err("late_fee_value") ? "Cargá el valor del punitorio." : null}
            >
              <SuffixInput
                id="rs-late_fee_value"
                value={f.late_fee_value}
                onChange={(v) => set("late_fee_value", v)}
                suffix={f.late_fee_type === "fijo_diario" ? undefined : f.late_fee_type === "diario_pct" ? "% diario" : "% mensual"}
                prefix={f.late_fee_type === "fijo_diario" ? "$" : undefined}
                invalid={err("late_fee_value") || !!lateWarn}
              />
            </Field>
          )}
          {f.late_fee_type !== "ninguno" && (
            <Field label="Los punitorios son para" help="Lo habitual: el propietario (es su plata la que llegó tarde).">
              <ChipGroup
                label="Quién se queda los punitorios"
                value={f.late_fee_payee}
                onChange={(v) => set("late_fee_payee", v)}
                options={[
                  { value: "propietario", label: "Propietario" },
                  { value: "inmobiliaria", label: "Inmobiliaria" },
                ]}
              />
            </Field>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        icon={BadgePercent}
        title="Honorarios"
        description="Lo que cobra la inmobiliaria. La administración se descuenta de cada rendición; los honorarios de la locación se cobran una vez, al firmar."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Administración"
            htmlFor="rs-admin_fee_pct"
            help="Se pacta con el propietario y se puede cambiar en cada contrato. Si no hay acuerdo, la Ley 9445 fija 10 % de lo cobrado (15 % si la propiedad es de otra plaza)."
          >
            <SuffixInput id="rs-admin_fee_pct" value={f.admin_fee_pct} onChange={(v) => set("admin_fee_pct", v)} suffix="% de lo cobrado" invalid={err("admin_fee_pct")} />
          </Field>
          <Field label="IVA sobre la administración" help={f.admin_fee_vat ? "Se suma 21 % en cada rendición." : "Sin IVA (monotributo o exento)."}>
            <label className="flex h-10 items-center gap-2.5 text-sm">
              <Switch checked={f.admin_fee_vat} onCheckedChange={(v) => set("admin_fee_vat", v)} aria-label="Sumar IVA a la administración" />
              {f.admin_fee_vat ? "Suma IVA" : "No suma IVA"}
            </label>
          </Field>
          <Field label="Condición frente al IVA" help="Si sos responsable inscripto, tus honorarios llevan IVA.">
            <Select value={f.vat_condition} onValueChange={(v) => set("vat_condition", v as RentalVatCondition)}>
              <SelectTrigger className="h-10 w-full" aria-label="Condición frente al IVA">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(VAT_LABEL) as RentalVatCondition[]).map((v) => (
                  <SelectItem key={v} value={v}>
                    {VAT_LABEL[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Honorarios de la locación al inquilino" htmlFor="rs-tenant_commission" help="Se pacta libremente. Si no hay acuerdo, la Ley 9445 fija 5 % del monto total del contrato, a cargo del inquilino." error={err("tenant_commission") ? "Revisá el valor." : null}>
          <CommissionEditor id="rs-tenant_commission" value={f.tenant_commission} onChange={(v) => set("tenant_commission", v)} error={err("tenant_commission")} />
        </Field>
        <Field label="Honorarios de la locación al propietario" htmlFor="rs-owner_commission" help="Si se cobran, se descuentan de su primera rendición." error={err("owner_commission") ? "Revisá el valor." : null}>
          <CommissionEditor id="rs-owner_commission" value={f.owner_commission} onChange={(v) => set("owner_commission", v)} error={err("owner_commission")} />
        </Field>
      </SettingsSection>

      <SettingsSection
        icon={TrendingUp}
        title="Contratos nuevos"
        description="Con qué se precarga el alta de cada contrato. Desde el DNU 70/2023 el índice y la frecuencia son libres: lo más común hoy es IPC trimestral."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Índice" help={INDEX_META[f.default_index as IndexCode]?.hint}>
            <Select value={f.default_index} onValueChange={(v) => set("default_index", v as IndexCode)}>
              <SelectTrigger className="h-10 w-full" aria-label="Índice por defecto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDEX_CODES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {INDEX_META[c].label} · {INDEX_META[c].publisher}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Redondeo del monto nuevo" help="Se aplica después de la cuenta: ese monto es el que paga y la base del ajuste siguiente.">
            <Select value={f.default_rounding} onValueChange={(v) => set("default_rounding", v as RentalRounding)}>
              <SelectTrigger className="h-10 w-full" aria-label="Redondeo por defecto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROUNDING_LABEL) as RentalRounding[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROUNDING_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Frecuencia de ajuste" htmlFor="rs-default_adjustment_every">
            <div className="flex flex-wrap items-center gap-1.5">
              <ChipGroup label="Frecuencia de ajuste" value={f.default_adjustment_every} onChange={(v) => set("default_adjustment_every", v)} options={EVERY_OPTIONS} />
              {!EVERY_OPTIONS.some((o) => o.value === f.default_adjustment_every) && (
                <SuffixInput id="rs-default_adjustment_every" inputMode="numeric" className="w-28" value={f.default_adjustment_every} onChange={(v) => set("default_adjustment_every", v)} suffix="meses" />
              )}
            </div>
          </Field>
          <Field label="Duración" htmlFor="rs-default_duration_months">
            <div className="flex flex-wrap items-center gap-1.5">
              <ChipGroup label="Duración" value={f.default_duration_months} onChange={(v) => set("default_duration_months", v)} options={DURATION_OPTIONS} />
              <SuffixInput id="rs-default_duration_months" inputMode="numeric" className="w-28" value={f.default_duration_months} onChange={(v) => set("default_duration_months", v)} suffix="meses" invalid={err("default_duration_months")} />
            </div>
          </Field>
        </div>
        <Field
          label="Qué meses del índice se usan (índices mensuales)"
          help={
            f.default_lag_months === "1"
              ? "Para un ajuste de junio con ciclo trimestral: marzo, abril y mayo. El de mayo sale a mediados de junio, así que el primer cargo sale con el precio anterior y la diferencia se cobra después."
              : "Para un ajuste de junio con ciclo trimestral: febrero, marzo y abril. Ya están publicados al empezar junio: el aviso sale a tiempo."
          }
        >
          <ChipGroup
            label="Convención de meses"
            value={f.default_lag_months === "1" ? "1" : "2"}
            onChange={(v) => set("default_lag_months", v)}
            options={[
              { value: "2", label: "Último dato publicado" },
              { value: "1", label: "Meses del ciclo" },
            ]}
          />
        </Field>
        <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 sm:p-4 cursor-pointer">
          <Switch checked={f.auto_apply_adjustments} onCheckedChange={(v) => set("auto_apply_adjustments", v)} className="mt-0.5" aria-label="Aplicar ajustes automáticamente" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Aplicar los ajustes automáticamente</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {f.auto_apply_adjustments
                ? "Apenas sale el índice, el monto nuevo queda aplicado y los cargos salen con ese precio. Te avisamos para que se lo cuentes al inquilino."
                : "Cuando sale el índice, el ajuste queda “Listo para aplicar” hasta que alguien lo confirme en Ajustes."}
            </span>
          </span>
        </label>
      </SettingsSection>

      <SettingsSection
        icon={Landmark}
        title="Impuesto de sellos"
        description="Para calcular el sellado de cada contrato nuevo (Córdoba: 0,5 % del valor total, mitad cada parte)."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Alícuota" htmlFor="rs-stamp_tax_rate_pct" help="Sobre el valor total del contrato.">
            <SuffixInput id="rs-stamp_tax_rate_pct" value={f.stamp_tax_rate_pct} onChange={(v) => set("stamp_tax_rate_pct", v)} suffix="%" invalid={err("stamp_tax_rate_pct")} />
          </Field>
          <Field label="Exento hasta" htmlFor="rs-stamp_tax_exempt_monthly" help="Alquiler promedio mensual hasta el que no se paga (Córdoba 2026: $ 1.230.000). Vacío = sin exención." error={err("stamp_tax_exempt_monthly") ? "Revisá el monto." : null}>
            <SuffixInput id="rs-stamp_tax_exempt_monthly" prefix="$" value={f.stamp_tax_exempt_monthly} onChange={(v) => set("stamp_tax_exempt_monthly", v)} suffix="por mes" invalid={err("stamp_tax_exempt_monthly")} />
          </Field>
          <Field label="Paga el inquilino" htmlFor="rs-stamp_tax_tenant_share_pct" help="El resto, el propietario. Lo habitual: 50 %.">
            <SuffixInput id="rs-stamp_tax_tenant_share_pct" value={f.stamp_tax_tenant_share_pct} onChange={(v) => set("stamp_tax_tenant_share_pct", v)} suffix="%" invalid={err("stamp_tax_tenant_share_pct")} />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={ReceiptText}
        title="Recibos y datos para pagar"
        description="Lo que aparece en los recibos, en las rendiciones y en el link del inquilino."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Corredor responsable" htmlFor="rs-broker_name" help="Nombre del martillero o corredor que firma.">
            <Input id="rs-broker_name" className="h-10" maxLength={120} value={f.broker_name} onChange={(e) => set("broker_name", e.target.value)} placeholder="Ej.: Ana Gómez" />
          </Field>
          <Field label="Matrícula" htmlFor="rs-broker_license" help="Ley 9445 (art. 21): la matrícula del CPI va en recibos y rendiciones.">
            <Input id="rs-broker_license" className="h-10" maxLength={60} value={f.broker_license} onChange={(e) => set("broker_license", e.target.value)} placeholder="Ej.: CPI 1234" />
          </Field>
        </div>
        <Field
          label="Datos para transferir"
          htmlFor="rs-payment_instructions"
          help="Los ven los inquilinos en su link y en los avisos de pago. Poné CBU o alias, titular y banco."
        >
          <Textarea
            id="rs-payment_instructions"
            rows={3}
            maxLength={1000}
            value={f.payment_instructions}
            onChange={(e) => set("payment_instructions", e.target.value)}
            placeholder={"Alias: inmobiliaria.cobros\nCBU: 0000003100000000000000\nTitular: Inmobiliaria Sur SRL · Banco Galicia"}
          />
        </Field>
        <Field label="Leyenda al pie del recibo" htmlFor="rs-receipt_footer" help="Opcional. Por ejemplo, horarios de atención o una aclaración legal.">
          <Textarea
            id="rs-receipt_footer"
            rows={2}
            maxLength={1000}
            value={f.receipt_footer}
            onChange={(e) => set("receipt_footer", e.target.value)}
            placeholder="Ej.: Atención de lunes a viernes de 9 a 17 h."
          />
        </Field>
      </SettingsSection>

      <div
        className={cn(
          "sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-background/90 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/75 transition-shadow",
          dirty && "shadow-lg",
        )}
      >
        <p className={cn("mr-auto text-xs", dirty ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
          {dirty ? "Tenés cambios sin guardar." : "Todo guardado."}
        </p>
        {dirty && (
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => { setF(saved); setErrorField(null); }} disabled={pending}>
            <RotateCcw size={14} /> Descartar
          </Button>
        )}
        <Button type="submit" size="sm" className="gap-1.5" disabled={pending || !dirty}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar cambios
        </Button>
      </div>
    </form>
  );
}
