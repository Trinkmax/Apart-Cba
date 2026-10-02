import { describe, expect, it } from "vitest";
import { buildAdjustmentEmail, escapeHtml, type AdjustmentEmailInput } from "@/lib/email/rentals-adjustments";

const base: AdjustmentEmailInput = {
  orgName: "Inmobiliaria Sur",
  brandColor: "#1d4ed8",
  logoUrl: null,
  contactPhone: "+54 9 351 555-0000",
  contactEmail: "hola@sur.com",
  tenantName: "María José Pérez",
  address: "Dean Funes 450 · 3°B",
  contractNumber: 7,
  notice: {
    method: "indice",
    index_code: "ipc",
    from_key: "2026-07-01",
    to_key: "2026-10-01",
    effectiveDate: "2026-12-01",
    oldAmount: 500000,
    newAmount: 543500,
    currency: "ARS",
    variationPct: 8.7,
  },
  nextAdjustmentDate: "2027-03-01",
};

describe("mail de ajuste", () => {
  it("asunto, saludo y montos en el texto plano", () => {
    const m = buildAdjustmentEmail(base);
    expect(m.subject).toBe("Tu alquiler se actualiza desde el 1 de diciembre de 2026");
    const text = m.text.replace(/\s/g, " ");
    expect(text).toContain("Hola María:");
    expect(text).toContain("Alquiler nuevo: $ 543.500");
    expect(text).toContain("Variación: +8,7 % (según IPC de agosto a octubre)");
    expect(text).toContain("El próximo ajuste está previsto para el 1 de marzo de 2027.");
    expect(text).toContain("C-0007 · Dean Funes 450 · 3°B");
  });

  it("usa el color de la marca y cae al default si no es un hex válido", () => {
    expect(buildAdjustmentEmail(base).html).toContain("background:#1d4ed8");
    expect(buildAdjustmentEmail({ ...base, brandColor: "red;position:fixed" }).html).toContain("background:#0F766E");
  });

  it("escapa todo lo dinámico", () => {
    const m = buildAdjustmentEmail({ ...base, orgName: "<script>x</script>", tenantName: "Ana \"la\" <b>" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).not.toContain("<b>");
    expect(escapeHtml(`a&b<'">`)).toBe("a&amp;b&lt;&#39;&quot;&gt;");
  });

  it("sólo acepta logos https", () => {
    expect(buildAdjustmentEmail({ ...base, logoUrl: "javascript:alert(1)" }).html).not.toContain("<img");
    expect(buildAdjustmentEmail({ ...base, logoUrl: "https://cdn.sur.com/logo.png" }).html).toContain('src="https://cdn.sur.com/logo.png"');
  });

  it("monto corregido a mano: no cita el índice", () => {
    const m = buildAdjustmentEmail({ ...base, notice: { ...base.notice, overridden: true, newAmount: 530000, variationPct: 6 } });
    expect(m.text).toContain("según lo acordado");
    expect(m.text).not.toContain("IPC");
  });
});
