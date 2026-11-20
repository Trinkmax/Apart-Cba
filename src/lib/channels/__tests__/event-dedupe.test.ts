import { describe, expect, it } from "vitest";
import { isReturnToEarlierState, returnDedupeKey, type StoredEventRef } from "../event-dedupe";

const A = "hash-26-30";
const B = "hash-26-27";
const stored = (id: string, hash: string, at = "2026-11-17T01:38:06Z"): StoredEventRef => ({
  id,
  content_hash: hash,
  processed_at: at,
});

describe("isReturnToEarlierState", () => {
  // GAMA (Viaggiato): 26→30, después 26→27, y de nuevo 26→30.
  it("A → B → A: la tercera lectura es una novedad, no un repetido", () => {
    expect(isReturnToEarlierState(A, "ev-a", stored("ev-b", B))).toBe(true);
  });

  it("la misma lectura cada cinco minutos sigue siendo un repetido", () => {
    expect(isReturnToEarlierState(A, "ev-a", stored("ev-a", A))).toBe(false);
  });

  it("lo último ya tiene ese contenido (variante sobre una cancelada, o la vuelta ya guardada)", () => {
    expect(isReturnToEarlierState(A, "ev-a", stored("ev-a-sobre-cancelada", A))).toBe(false);
    expect(isReturnToEarlierState(A, "ev-a", stored("ev-a-vuelve", A))).toBe(false);
  });

  it("sin con qué comparar no inventa una novedad", () => {
    expect(isReturnToEarlierState(A, "ev-a", null)).toBe(false);
    expect(isReturnToEarlierState(null, "ev-a", stored("ev-b", B))).toBe(false);
  });
});

describe("returnDedupeKey", () => {
  it("un reintento de la misma vuelta cae en la misma clave", () => {
    const latest = stored("ev-b", B);
    expect(returnDedupeKey("ical:l:uid:aaaa", latest)).toBe(returnDedupeKey("ical:l:uid:aaaa", latest));
  });

  // A → B → A → B → A: el B del medio se reprocesa con el mismo id.
  it("ir y venir dos veces entre los mismos estados da claves distintas", () => {
    const first = returnDedupeKey("ical:l:uid:aaaa", stored("ev-b", B, "2026-11-17T01:38:06Z"));
    const second = returnDedupeKey("ical:l:uid:aaaa", stored("ev-b", B, "2026-11-19T14:02:11Z"));
    expect(first).not.toBe(second);
  });

  it("aguanta un evento sin fecha de procesado", () => {
    expect(returnDedupeKey("k", { id: "ev-b", processed_at: null })).toBe("k:vuelve:ev-b:0");
  });
});
