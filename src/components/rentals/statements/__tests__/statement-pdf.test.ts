import { describe, expect, it } from "vitest";
import { buildRentalStatementDoc } from "@/lib/pdf/rental-statement-pdf";
import { buildStatementDoc, type StatementLineInput } from "../statement-model";

const org = { name: "Inmobiliaria Centro", legal_name: "Centro SRL", tax_id: "30-71234567-8", logo_url: null, primary_color: "#0f766e" };

function model(status: "borrador" | "emitida" | "pagada" | "anulada", lines: StatementLineInput[]) {
  return buildStatementDoc({
    header: {
      id: "s1",
      number: 7,
      status,
      currency: "ARS",
      cutoff_date: "2026-10-31",
      collected_amount: 12345678.9,
      fees_amount: 1234567.89,
      vat_amount: 259259.26,
      expenses_amount: 20000,
      other_amount: 0,
      net_amount: 10831851.75,
      generated_at: "2026-10-31T15:00:00Z",
      sent_at: null,
      sent_to: null,
      paid_at: status === "pagada" ? "2026-11-03T15:00:00Z" : null,
      voided_at: status === "anulada" ? "2026-11-04T15:00:00Z" : null,
      void_reason: status === "anulada" ? "faltaba un gasto" : null,
      notes: "Se cambió el flexible del calefón.",
    },
    lines,
    owner: { full_name: "María José Fernández", email: null, phone: null, bank_name: "Banco de Córdoba", cbu: "0200000000000000000000", alias_cbu: "maria.fer" },
    properties: [{ id: "p1", label: "Dean Funes 450 · 3°B", code: "DF450" }],
    contracts: [{ id: "c1", number: 7, tenantName: "Ana Gómez" }],
  });
}

const lines: StatementLineInput[] = Array.from({ length: 40 }, (_, i) => ({
  id: `l${i}`,
  line_type: i % 4 === 3 ? "gasto" : "cobro_alquiler",
  sign: i % 4 === 3 ? -1 : 1,
  amount: 300000 + i,
  description: i % 4 === 3 ? "Gasto: arreglo de persiana − urgente" : `Alquiler Octubre 2026 · Período ${(i % 3) + 1}/3 — Dean Funes 450 · 3°B`,
  contract_id: "c1",
  property_id: "p1",
  share_pct: 100,
  sort_order: i,
}));

describe("buildRentalStatementDoc", () => {
  it("arma un PDF de varias páginas sin romperse (montos grandes, marca de agua, notas)", async () => {
    for (const status of ["borrador", "emitida", "pagada", "anulada"] as const) {
      const doc = await buildRentalStatementDoc(model(status, lines), org);
      const bytes = doc.output("arraybuffer");
      expect(bytes.byteLength).toBeGreaterThan(2000);
      expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    }
  });

  it("funciona con una rendición sin renglones", async () => {
    const doc = await buildRentalStatementDoc(model("emitida", []), org);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("una anulada sin motivo (el PDF del link público) igual dice que se anuló, y el motivo interno no aparece", async () => {
    const staff = (await buildRentalStatementDoc(model("anulada", []), org)).output();
    expect(staff).toContain("faltaba un gasto");
    const publicModel = { ...model("anulada", []), voidReason: null };
    const owner = (await buildRentalStatementDoc(publicModel, org)).output();
    expect(owner).toContain("ya no vale");
    expect(owner).not.toContain("faltaba un gasto");
  });
});
