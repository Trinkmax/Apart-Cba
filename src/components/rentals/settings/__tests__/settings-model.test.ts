import { describe, expect, it } from "vitest";
import {
  fromSettingsForm,
  lateFeeEquivalent,
  lateFeeWarning,
  paymentWindowText,
  toSettingsForm,
  type RentalSettingsValues,
} from "@/components/rentals/settings/settings-model";

const DEFAULTS: RentalSettingsValues = {
  payment_window_days: 10,
  grace_days: 0,
  late_fee_type: "diario_pct",
  late_fee_value: 0.5,
  late_fee_payee: "propietario",
  admin_fee_pct: 10,
  admin_fee_vat: false,
  tenant_commission: { basis: "pct_total_contrato", value: 5, vat: false },
  owner_commission: { basis: "ninguna", value: 0, vat: false },
  default_index: "ipc",
  default_adjustment_every: 3,
  default_lag_months: 2,
  default_rounding: "hundred",
  default_duration_months: 24,
  auto_apply_adjustments: true,
  stamp_tax_rate_pct: 0.5,
  stamp_tax_exempt_monthly: 1230000,
  stamp_tax_tenant_share_pct: 50,
  vat_condition: "monotributo",
  broker_name: null,
  broker_license: null,
  payment_instructions: null,
  receipt_footer: null,
  charge_lead_days: 7,
};

describe("ayudas del punitorio", () => {
  it("equivalente mensual / diario", () => {
    expect(lateFeeEquivalent("diario_pct", 0.5)).toBe("0,5 % diario ≈ 15 % por mes");
    expect(lateFeeEquivalent("mensual_pct", 3)).toBe("3 % mensual ≈ 0,1 % por día");
    expect(lateFeeEquivalent("ninguno", 1)).toBeNull();
    expect(lateFeeEquivalent("diario_pct", 0)).toBeNull();
  });

  it("avisa cuando es demasiado alto", () => {
    expect(lateFeeWarning("diario_pct", 0.5)).toBeNull();
    expect(lateFeeWarning("diario_pct", 2)).toContain("art. 771");
    expect(lateFeeWarning("mensual_pct", 40)).not.toBeNull();
  });

  it("ventana de pago", () => {
    expect(paymentWindowText(10)).toBe("Del 1 al 10 de cada período");
    expect(paymentWindowText(1)).toBe("El primer día de cada período");
  });
});

describe("formulario de configuración", () => {
  it("ida y vuelta sin perder nada", () => {
    const form = toSettingsForm(DEFAULTS);
    expect(form.late_fee_value).toBe("0,5");
    expect(form.stamp_tax_exempt_monthly).toBe("1.230.000");
    const back = fromSettingsForm(form);
    expect(back).toEqual({ ok: true, values: DEFAULTS });
  });

  it("lee lo que tipea la gente en es-AR", () => {
    const form = { ...toSettingsForm(DEFAULTS), admin_fee_pct: "8,5", stamp_tax_exempt_monthly: "1.500.000,50", broker_name: "  Ana Gómez  " };
    const r = fromSettingsForm(form);
    expect(r.ok && r.values.admin_fee_pct).toBe(8.5);
    expect(r.ok && r.values.stamp_tax_exempt_monthly).toBe(1500000.5);
    expect(r.ok && r.values.broker_name).toBe("Ana Gómez");
  });

  it("vacío = sin exención; sin punitorios guarda 0", () => {
    const r = fromSettingsForm({ ...toSettingsForm(DEFAULTS), stamp_tax_exempt_monthly: "", late_fee_type: "ninguno", late_fee_value: "" });
    expect(r.ok && r.values.stamp_tax_exempt_monthly).toBeNull();
    expect(r.ok && r.values.late_fee_value).toBe(0);
  });

  it("devuelve el campo con error", () => {
    expect(fromSettingsForm({ ...toSettingsForm(DEFAULTS), payment_window_days: "diez" })).toMatchObject({ ok: false, field: "payment_window_days" });
    expect(fromSettingsForm({ ...toSettingsForm(DEFAULTS), late_fee_value: "" })).toMatchObject({ ok: false, field: "late_fee_value" });
    expect(
      fromSettingsForm({ ...toSettingsForm(DEFAULTS), tenant_commission: { basis: "monto_fijo", value: "abc", vat: false } }),
    ).toMatchObject({ ok: false, field: "tenant_commission" });
  });

  it("honorarios: monto fijo con miles y sin comisión", () => {
    const r = fromSettingsForm({
      ...toSettingsForm(DEFAULTS),
      tenant_commission: { basis: "monto_fijo", value: "350.000", vat: true },
      owner_commission: { basis: "ninguna", value: "99", vat: true },
    });
    expect(r.ok && r.values.tenant_commission).toEqual({ basis: "monto_fijo", value: 350000, vat: true });
    expect(r.ok && r.values.owner_commission).toEqual({ basis: "ninguna", value: 0, vat: false });
  });
});
