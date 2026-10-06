import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SETTLEMENT_PAYMENT_NOTES_MAX,
  settlementPaymentInvalidMessage,
} from "../payment-input";

describe("settlementPaymentInvalidMessage", () => {
  it("una nota larga habla de la nota, no de los importes", () => {
    const msg = settlementPaymentInvalidMessage(["notes"]);
    expect(msg).toContain("nota");
    expect(msg).toContain(String(SETTLEMENT_PAYMENT_NOTES_MAX));
    expect(msg).not.toContain("importe");
  });

  it("las cuentas y los importes, con el camino completo de un split", () => {
    for (const path of [["splits", 0, "amount"], ["splits"], ["amount"], ["account_id"]]) {
      expect(settlementPaymentInvalidMessage(path)).toContain("importes");
    }
  });

  it("lo que arma la pantalla (o sin camino) pide recargar", () => {
    for (const path of [["settlement_id"], ["paid_at"], [], undefined]) {
      expect(settlementPaymentInvalidMessage(path)).toContain("Recargá");
    }
  });

  it("toma el camino tal como lo da Zod", () => {
    const schema = z.object({
      splits: z.array(z.object({ amount: z.number().positive() })),
      notes: z.string().max(SETTLEMENT_PAYMENT_NOTES_MAX).optional(),
    });
    const longNote = schema.safeParse({
      splits: [{ amount: 10 }],
      notes: "x".repeat(SETTLEMENT_PAYMENT_NOTES_MAX + 1),
    });
    expect(longNote.success).toBe(false);
    if (!longNote.success) {
      expect(settlementPaymentInvalidMessage(longNote.error.issues[0]?.path)).toContain("nota");
    }
    const zero = schema.safeParse({ splits: [{ amount: 0 }] });
    expect(zero.success).toBe(false);
    if (!zero.success) {
      expect(settlementPaymentInvalidMessage(zero.error.issues[0]?.path)).toContain("importes");
    }
  });
});
