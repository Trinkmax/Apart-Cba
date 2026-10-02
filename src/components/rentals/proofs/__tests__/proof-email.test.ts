import { describe, expect, it } from "vitest";
import { escapeHtml, proofRejectedEmail } from "../proof-email";

describe("proofRejectedEmail", () => {
  const base = {
    orgName: "Inmobiliaria Centro",
    brandColor: "#1e3a8a",
    tenantName: "Lucía Pérez",
    kind: "luz" as const,
    period: "2026-10-01",
    address: "Dean Funes 450 · 3°B",
    reason: "No se lee bien",
    portalUrl: "https://app.example/inquilino/abc",
  };

  it("dice qué comprobante, el motivo y el link para volver a subirlo", () => {
    const m = proofRejectedEmail(base);
    expect(m.subject).toBe("Tenés que volver a subir el comprobante de luz de octubre 2026");
    expect(m.html).toContain("Hola Lucía,");
    expect(m.html).toContain("No se lee bien");
    expect(m.html).toContain('href="https://app.example/inquilino/abc"');
    expect(m.html).toContain("#1e3a8a");
    expect(m.text).toContain("Subilo de nuevo desde tu link: https://app.example/inquilino/abc");
  });

  it("escapa el texto que escribe el equipo y usa el color por defecto si el de la org no es válido", () => {
    const m = proofRejectedEmail({ ...base, reason: '<script>alert("x")</script>', brandColor: "red;background:url(x)" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("#0F766E");
    expect(m.html).not.toContain("url(x)");
  });

  it("sin link pide que respondan el mail", () => {
    const m = proofRejectedEmail({ ...base, portalUrl: null, tenantName: null });
    expect(m.html).toContain("Hola,");
    expect(m.text).toContain("Respondé este mail");
  });

  it("escapeHtml cubre comillas", () => {
    expect(escapeHtml(`"a" & 'b'`)).toBe("&quot;a&quot; &amp; &#39;b&#39;");
  });
});
