import { describe, expect, it } from "vitest";
import { amountToSpanishWords, integerToSpanishWords } from "@/lib/rentals/words";

describe("integerToSpanishWords — los casos que suelen salir mal en un recibo", () => {
  const cases: [number, string][] = [
    [0, "cero"],
    [1, "uno"],
    [15, "quince"],
    [16, "dieciséis"],
    [21, "veintiuno"],
    [22, "veintidós"],
    [30, "treinta"],
    [31, "treinta y uno"],
    [100, "cien"],
    [101, "ciento uno"],
    [115, "ciento quince"],
    [500, "quinientos"],
    [700, "setecientos"],
    [999, "novecientos noventa y nueve"],
    [1000, "mil"],
    [1001, "mil uno"],
    [21000, "veintiún mil"],
    [31000, "treinta y un mil"],
    [100000, "cien mil"],
    [543500, "quinientos cuarenta y tres mil quinientos"],
    [1000000, "un millón"],
    [2000000, "dos millones"],
    [21000000, "veintiún millones"],
    [1001001, "un millón mil uno"],
  ];

  it.each(cases)("%i → %s", (n, words) => {
    expect(integerToSpanishWords(n)).toBe(words);
  });
});

describe("integerToSpanishWords — reglas del castellano", () => {
  it("de 0 a 29 son palabras simples, con tilde donde corresponde", () => {
    expect(integerToSpanishWords(10)).toBe("diez");
    expect(integerToSpanishWords(20)).toBe("veinte");
    expect(integerToSpanishWords(23)).toBe("veintitrés");
    expect(integerToSpanishWords(26)).toBe("veintiséis");
    expect(integerToSpanishWords(29)).toBe("veintinueve");
  });

  it("de 31 a 99 se arman con 'y'", () => {
    expect(integerToSpanishWords(45)).toBe("cuarenta y cinco");
    expect(integerToSpanishWords(90)).toBe("noventa");
    expect(integerToSpanishWords(99)).toBe("noventa y nueve");
  });

  it("100 solo es 'cien'; con algo detrás, 'ciento'", () => {
    expect(integerToSpanishWords(111)).toBe("ciento once");
    expect(integerToSpanishWords(121)).toBe("ciento veintiuno");
    expect(integerToSpanishWords(200)).toBe("doscientos");
    expect(integerToSpanishWords(1100)).toBe("mil cien");
    expect(integerToSpanishWords(1101)).toBe("mil ciento uno");
  });

  it("1.000 es 'mil', nunca 'un mil'; los miles se apocopan delante de 'mil'", () => {
    expect(integerToSpanishWords(2000)).toBe("dos mil");
    expect(integerToSpanishWords(41000)).toBe("cuarenta y un mil");
    expect(integerToSpanishWords(101000)).toBe("ciento un mil");
    expect(integerToSpanishWords(201000)).toBe("doscientos un mil");
  });

  it("el 'uno' final no se apocopa (no hay sustantivo detrás)", () => {
    expect(integerToSpanishWords(1021)).toBe("mil veintiuno");
    expect(integerToSpanishWords(21021)).toBe("veintiún mil veintiuno");
    expect(integerToSpanishWords(1000001)).toBe("un millón uno");
    expect(integerToSpanishWords(31031)).toBe("treinta y un mil treinta y uno");
  });

  it("millones: 'un millón', plural desde dos, apócope delante de 'millones'", () => {
    expect(integerToSpanishWords(1500000)).toBe("un millón quinientos mil");
    expect(integerToSpanishWords(31000000)).toBe("treinta y un millones");
    expect(integerToSpanishWords(100000000)).toBe("cien millones");
    expect(integerToSpanishWords(1000000000)).toBe("mil millones");
    expect(integerToSpanishWords(1001000000)).toBe("mil un millones");
  });

  it("montos de alquiler reales", () => {
    expect(integerToSpanishWords(731615)).toBe("setecientos treinta y un mil seiscientos quince");
    expect(integerToSpanishWords(999999)).toBe("novecientos noventa y nueve mil novecientos noventa y nueve");
    expect(integerToSpanishWords(12000000)).toBe("doce millones");
  });

  it("toma la parte entera del valor absoluto", () => {
    expect(integerToSpanishWords(-15.7)).toBe("quince");
    expect(integerToSpanishWords(0.99)).toBe("cero");
  });
});

describe("amountToSpanishWords — importe del recibo", () => {
  it("'Son pesos quinientos cuarenta y tres mil quinientos con 00/100'", () => {
    expect(amountToSpanishWords(543500, "ARS")).toBe("pesos quinientos cuarenta y tres mil quinientos con 00/100");
  });

  it("la moneda por defecto es pesos y va adelante, sin 'de' después de millón", () => {
    expect(amountToSpanishWords(1)).toBe("pesos uno con 00/100");
    expect(amountToSpanishWords(1000000)).toBe("pesos un millón con 00/100");
    expect(amountToSpanishWords(21)).toBe("pesos veintiuno con 00/100");
  });

  it("los centavos van como NN/100", () => {
    expect(amountToSpanishWords(1234.5)).toBe("pesos mil doscientos treinta y cuatro con 50/100");
    expect(amountToSpanishWords(731615.44)).toBe("pesos setecientos treinta y un mil seiscientos quince con 44/100");
    expect(amountToSpanishWords(19.99)).toBe("pesos diecinueve con 99/100");
    expect(amountToSpanishWords(0.29)).toBe("pesos cero con 29/100");
    expect(amountToSpanishWords(100.05)).toBe("pesos cien con 05/100");
  });

  it("si los centavos redondean a 100, suman un peso (99,999 → cien con 00/100)", () => {
    expect(amountToSpanishWords(99.999)).toBe("pesos cien con 00/100");
  });

  it("dólares y euros", () => {
    expect(amountToSpanishWords(1500, "USD")).toBe("dólares estadounidenses mil quinientos con 00/100");
    expect(amountToSpanishWords(2000000.1, "USD")).toBe("dólares estadounidenses dos millones con 10/100");
    expect(amountToSpanishWords(21000, "EUR")).toBe("euros veintiún mil con 00/100");
  });

  it("una moneda desconocida se nombra por su código", () => {
    expect(amountToSpanishWords(10, "BRL")).toBe("BRL diez con 00/100");
  });

  it("un importe negativo (devolución) se escribe en valor absoluto", () => {
    expect(amountToSpanishWords(-100)).toBe("pesos cien con 00/100");
  });
});
