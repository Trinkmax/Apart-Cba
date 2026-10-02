import { describe, expect, it } from "vitest";
import {
  buildProofGrid,
  cellStateOf,
  fileKindOf,
  formatFileSize,
  joinSpanishList,
  lastMonths,
  missingKindsOf,
  monthShort,
  parseMonthParam,
  proofRequestMessage,
  sortKinds,
} from "../proof-helpers";
import type { ProofItem } from "../proof-types";

function proof(kind: ProofItem["kind"], period: string, status: ProofItem["status"]): ProofItem {
  return {
    id: `${kind}-${period}`,
    kind,
    period,
    status,
    amount: null,
    proofCurrency: null,
    dueDate: null,
    hasFile: status !== "pendiente",
    fileMime: null,
    fileName: null,
    fileSize: null,
    uploadedAt: null,
    uploadedVia: null,
    reviewedAt: null,
    reviewerName: null,
    rejectionReason: null,
    notes: null,
    contractId: "c1",
    contractNumber: 7,
    contractStatus: "vigente",
    propertyId: "p1",
    propertyCode: "DF450",
    address: "Dean Funes 450 · 3°B",
    tenantName: "Lucía Pérez",
    tenantWhatsapp: "5493511234567",
    tenantEmail: null,
    currency: "ARS",
    portalUrl: null,
  };
}

describe("lastMonths / parseMonthParam / monthShort", () => {
  it("devuelve los meses anteriores y el actual, del más viejo al más nuevo, cruzando el año", () => {
    expect(lastMonths("2026-02-17", 3)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });
  it("sólo acepta YYYY-MM con mes real", () => {
    expect(parseMonthParam("2026-10")).toBe("2026-10-01");
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam("2026-1")).toBeNull();
    expect(parseMonthParam(undefined)).toBeNull();
  });
  it("abrevia el mes en castellano", () => {
    expect(monthShort("2026-10-01")).toBe("oct");
    expect(monthShort("2026-01-01", true)).toBe("ene 26");
  });
});

describe("cellStateOf", () => {
  it("una fila pendiente siempre es 'falta' (alguien la pidió)", () => {
    expect(cellStateOf({ status: "pendiente" }, false, true)).toBe("falta");
  });
  it("sin fila: se pide → falta; no se pide → no_pedido; fuera del contrato → fuera", () => {
    expect(cellStateOf(null, true, true)).toBe("falta");
    expect(cellStateOf(null, false, true)).toBe("no_pedido");
    expect(cellStateOf(null, false, false)).toBe("fuera");
  });
  it("con fila revisada muestra su estado", () => {
    expect(cellStateOf({ status: "validado" }, true, true)).toBe("validado");
    expect(cellStateOf({ status: "no_corresponde" }, true, true)).toBe("no_corresponde");
  });
});

describe("buildProofGrid", () => {
  const months = ["2026-08-01", "2026-09-01", "2026-10-01"];
  it("arma una fila por tipo pedido o guardado, en el orden fijo (expensas primero)", () => {
    const rows = buildProofGrid({
      months,
      expectedByMonth: { "2026-08-01": [], "2026-09-01": ["luz", "expensas"], "2026-10-01": ["expensas"] },
      inRangeByMonth: { "2026-08-01": false, "2026-09-01": true, "2026-10-01": true },
      proofs: [proof("expensas", "2026-09-01", "validado"), proof("gas", "2026-10-01", "en_revision")],
    });
    expect(rows.map((r) => r.kind)).toEqual(["expensas", "luz", "gas"]);
    const expensas = rows[0].cells.map((c) => c.state);
    expect(expensas).toEqual(["fuera", "validado", "falta"]);
    const luz = rows[1].cells.map((c) => c.state);
    expect(luz).toEqual(["fuera", "falta", "no_pedido"]);
    expect(rows[2].cells[2].proof?.id).toBe("gas-2026-10-01");
  });
  it("ignora filas de meses fuera de la ventana al decidir los tipos", () => {
    const rows = buildProofGrid({
      months,
      expectedByMonth: {},
      inRangeByMonth: {},
      proofs: [proof("agua", "2025-01-01", "validado")],
    });
    expect(rows).toEqual([]);
  });
});

describe("missingKindsOf", () => {
  it("descuenta lo validado, en revisión y 'no corresponde'; deja pendientes y rechazados con su motivo", () => {
    const out = missingKindsOf(
      ["expensas", "luz", "gas", "agua"],
      [
        { id: "a", kind: "expensas", status: "validado", rejection_reason: null },
        { id: "b", kind: "luz", status: "rechazado", rejection_reason: "No se lee bien" },
        { id: "c", kind: "gas", status: "en_revision", rejection_reason: null },
      ],
    );
    expect(out).toEqual([
      { kind: "luz", proofId: "b", status: "rechazado", rejectionReason: "No se lee bien" },
      { kind: "agua", proofId: null, status: null, rejectionReason: null },
    ]);
  });
  it("una fila pendiente de un tipo que ya no se pide sigue faltando", () => {
    const out = missingKindsOf([], [{ id: "x", kind: "internet", status: "pendiente", rejection_reason: null }]);
    expect(out).toEqual([{ kind: "internet", proofId: "x", status: "pendiente", rejectionReason: null }]);
  });
});

describe("textos", () => {
  it("une listas como se habla", () => {
    expect(joinSpanishList(["expensas"])).toBe("expensas");
    expect(joinSpanishList(["expensas", "luz"])).toBe("expensas y luz");
    expect(joinSpanishList(["expensas", "luz", "gas"])).toBe("expensas, luz y gas");
    expect(sortKinds(["gas", "expensas", "luz", "gas"])).toEqual(["expensas", "luz", "gas"]);
  });
  it("arma el pedido por WhatsApp con el link del portal y sin emojis", () => {
    const text = proofRequestMessage({
      tenantName: "Lucía Pérez",
      orgName: "Inmobiliaria Centro",
      kinds: ["expensas", "municipal"],
      month: "2026-10-01",
      address: "Dean Funes 450 · 3°B",
      portalUrl: "https://app.example/inquilino/abc",
    });
    expect(text).toContain("Hola Lucía!");
    expect(text).toContain("los comprobantes de expensas y tasa municipal de octubre 2026 de Dean Funes 450 · 3°B");
    expect(text).toContain("https://app.example/inquilino/abc");
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });
  it("sin link pide que lo manden por el chat", () => {
    const text = proofRequestMessage({ tenantName: null, orgName: "X", kinds: ["luz"], month: "2026-01-01", address: "A 1", portalUrl: null });
    expect(text.startsWith("Hola!")).toBe(true);
    expect(text).toContain("el comprobante de luz de enero 2026");
    expect(text).toContain("por acá");
  });
  it("clasifica archivos y formatea tamaños", () => {
    expect(fileKindOf("application/pdf")).toBe("pdf");
    expect(fileKindOf("image/heic")).toBe("heic");
    expect(fileKindOf("image/jpeg")).toBe("image");
    expect(fileKindOf(null)).toBe("other");
    expect(formatFileSize(512)).toBe("1 KB");
    expect(formatFileSize(1536 * 1024)).toBe("1,5 MB");
    expect(formatFileSize(null)).toBe("");
  });
});
