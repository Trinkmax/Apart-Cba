import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { addUsage, callCostUsd, monthStartIso, ZERO_USAGE } from "../usage";
import { actionNote, contextBlock, longDateEs, TEX_SYSTEM } from "../prompt";
import { encodeEvent, NdjsonReader } from "../ndjson";
import { anthropicTools, countUnions, toolsForRole } from "../registry";
import { dateRange, isYmd, money, moneyByCurrency, nightsBetween, shortDate, sumByCurrency } from "../format";
import { defineRead, defineWrite, translateDbError, type TexTool } from "../tool";

describe("costo de Haiku 5.5", () => {
  it("tarifa chica con caché", () => {
    const usd = callCostUsd({ inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 10_000, cacheWriteTokens: 0 });
    // 1000×0.10 + 10000×0.01 + 500×0.50 = 100 + 100 + 250 = 450 por millón
    expect(usd).toBeCloseTo(0.00045, 6);
  });
  it("prompts largos usan la tarifa grande", () => {
    const usd = callCostUsd({ inputTokens: 120_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(usd).toBeCloseTo(0.06, 6);
  });
  it("suma usos y arma el corte del mes", () => {
    expect(addUsage(ZERO_USAGE, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    });
    expect(monthStartIso("2026-11-14")).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("prompt", () => {
  it("el system no tiene nada que cambie por pedido (caché y thinking)", () => {
    expect(TEX_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(TEX_SYSTEM).not.toMatch(/Apart CBA/);
  });
  it("arma el contexto del turno", () => {
    const c = contextBlock({
      today: "2026-11-14",
      tomorrow: "2026-11-15",
      time: "10:42",
      timezone: "America/Argentina/Cordoba",
      orgName: "Apart CBA",
      currency: "ARS",
      personName: "Ignacio",
      roleLabel: "Administrador",
      screen: "Caja (/dashboard/caja)",
    });
    expect(c).toContain("sábado 14 de noviembre de 2026");
    expect(c).toContain("Pantalla abierta: Caja");
    expect(c.startsWith("<contexto>")).toBe(true);
  });
  it("fecha larga y nota de acción", () => {
    expect(longDateEs("2026-01-01")).toBe("jueves 1 de enero de 2026");
    expect(actionNote({ title: "Registrar un gasto", outcome: "executed", detail: "Gasto registrado." })).toContain(
      "CONFIRMÓ",
    );
  });
});

describe("NDJSON", () => {
  it("parte y junta eventos aunque lleguen cortados", () => {
    const dec = new TextDecoder();
    const raw =
      dec.decode(encodeEvent({ t: "text", d: "Hola" })) + dec.decode(encodeEvent({ t: "done", stop: "end_turn" }));
    const r = new NdjsonReader();
    const a = r.push(raw.slice(0, 7));
    const b = r.push(raw.slice(7));
    expect([...a, ...b, ...r.flush()]).toEqual([
      { t: "text", d: "Hola" },
      { t: "done", stop: "end_turn" },
    ]);
  });
  it("una línea rota no tumba el resto", () => {
    const r = new NdjsonReader();
    expect(r.push('{"t":"text","d":"a"}\n{roto\n{"t":"text","d":"b"}\n')).toEqual([
      { t: "text", d: "a" },
      { t: "text", d: "b" },
    ]);
  });
});

describe("registro de herramientas", () => {
  const read = defineRead({
    name: "ver_caja",
    label: "…",
    description: "x",
    input: z.object({ desde: z.string().optional(), n: z.number().int().default(10) }),
    resource: "cash",
    action: "view",
    run: async () => ({ ok: true, data: {} }),
  });
  const cleaning = defineRead({
    name: "ver_limpieza",
    label: "…",
    description: "x",
    input: z.object({}),
    resource: "cleaning",
    action: "view",
    run: async () => ({ ok: true, data: {} }),
  });
  const write = defineWrite({
    name: "registrar_algo",
    label: "…",
    description: "x",
    input: z.object({ monto: z.number() }),
    payload: z.object({ amount: z.number() }),
    resource: "cash",
    action: "create",
    adminLevel: true,
    propose: async (i) => ({ ok: true, payload: { amount: i.monto }, summary: { title: "t", lines: [], confirmLabel: "ok" } }),
    execute: async () => ({ ok: true, message: "ok" }),
  });
  const tools: TexTool[] = [read, cleaning, write];

  it("filtra por rol: limpieza sólo ve lo suyo", () => {
    expect(toolsForRole(tools, "admin").map((t) => t.name)).toEqual(["ver_caja", "ver_limpieza", "registrar_algo"]);
    expect(toolsForRole(tools, "limpieza").map((t) => t.name)).toEqual(["ver_limpieza"]);
    expect(toolsForRole(tools, "owner_view").map((t) => t.name)).toEqual([]);
  });

  it("los schemas son objetos, sin $schema, y los defaults son opcionales", () => {
    const [def] = anthropicTools([read]);
    expect(def.input_schema.type).toBe("object");
    expect("$schema" in def.input_schema).toBe(false);
    expect(def.input_schema.required ?? []).not.toContain("n");
    expect(def.eager_input_streaming).toBe(true);
    expect(countUnions(def.input_schema)).toBe(0);
  });

  it("cuenta uniones (nullable incluido)", () => {
    expect(countUnions({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe(1);
    expect(countUnions({ properties: { a: { type: ["string", "null"] }, b: { oneOf: [] } } })).toBe(2);
  });
});

describe("formato tolerante", () => {
  it("plata en cualquier moneda, sin tirar", () => {
    expect(money(50000)).toBe("$ 50.000");
    expect(money(1250.5, "USD")).toBe("US$ 1.250,50");
    expect(money(-300, "ARS")).toBe("−$ 300");
    expect(money(1000, "ARS_EFECTIVO")).toBe("$ 1.000");
    expect(money(Number.NaN)).toBe("—");
  });
  it("nunca mezcla monedas", () => {
    const rows = [
      { a: 100, c: "ARS" },
      { a: 50, c: "USD" },
      { a: 25.5, c: "ars" },
    ];
    const by = sumByCurrency(rows, (r) => r.a, (r) => r.c);
    expect(by).toEqual({ ARS: 125.5, USD: 50 });
    expect(moneyByCurrency(by)).toBe("$ 125,50 · US$ 50");
  });
  it("fechas cortas, rangos y noches", () => {
    expect(shortDate("2026-11-14", "2026-01-01")).toBe("sáb 14 nov");
    expect(shortDate("2027-01-02", "2026-11-14")).toBe("sáb 2 ene 2027");
    expect(dateRange("2026-11-28", "2026-12-02")).toBe("28 nov al 2 dic");
    expect(nightsBetween("2026-11-28", "2026-12-02")).toBe(4);
    expect(isYmd("2026-02-31")).toBe(false);
    expect(isYmd("2026-02-28")).toBe(true);
  });
  it("traduce los constraints de la base", () => {
    expect(translateDbError('conflicting key value violates exclusion constraint "bookings_no_overlap"')).toBe(
      "Ya hay una reserva en esa unidad para esas fechas.",
    );
  });
});
