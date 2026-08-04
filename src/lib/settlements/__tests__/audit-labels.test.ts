import { describe, it, expect } from "vitest";
import { describeAuditChange } from "../labels";

/**
 * `describeAuditChange` es la fuente única de los rótulos del historial Y de
 * los tooltips de Deshacer/Rehacer. Si divergen, el botón prometería deshacer
 * una cosa distinta a la que el historial dice que pasó.
 */
describe("describeAuditChange", () => {
  it("el kind gana sobre el action genérico", () => {
    // Sin esto, cambiar un TC decía "Cargo editado" y mover el período
    // decía "Reserva editada".
    expect(describeAuditChange("line_update", { kind: "exchange_rate" })).toBe(
      "Tipo de cambio",
    );
    expect(describeAuditChange("row_update", { kind: "period_cycle" })).toBe(
      "Período actualizado",
    );
    expect(describeAuditChange("row_update", { kind: "reorder_units" })).toBe(
      "Unidades reordenadas",
    );
  });

  it("cae al action cuando no hay kind conocido", () => {
    expect(describeAuditChange("line_delete", null)).toBe("Cargo eliminado");
    expect(describeAuditChange("line_delete", {})).toBe("Cargo eliminado");
    expect(describeAuditChange("payment", { kind: "inventado" })).toBe(
      "Pago registrado",
    );
  });

  it("nombra deshacer y rehacer", () => {
    expect(describeAuditChange("undo", { kind: "undo" })).toBe(
      "Cambio deshecho",
    );
    expect(describeAuditChange("redo", { kind: "redo" })).toBe(
      "Cambio rehecho",
    );
    expect(describeAuditChange("regenerate", { kind: "regenerate" })).toBe(
      "Regenerada",
    );
  });

  it("nunca devuelve vacío, ni con datos corruptos", () => {
    expect(describeAuditChange("accion_desconocida", null)).toBe(
      "accion_desconocida",
    );
    // `kind` no-string (jsonb puede traer cualquier cosa) no debe romper.
    expect(
      describeAuditChange("line_add", { kind: 42 } as Record<string, unknown>),
    ).toBe("Cargo agregado");
  });
});
