import { describe, expect, it } from "vitest";
import { editDistance, suggestEmailFix } from "../email-typo";

describe("editDistance", () => {
  it("cuenta una transposición como un solo error", () => {
    expect(editDistance("gmial.com", "gmail.com")).toBe(1);
    expect(editDistance("gmai.com", "gmail.com")).toBe(1);
    expect(editDistance("gmail.com", "gmail.com")).toBe(0);
  });
});

describe("suggestEmailFix", () => {
  it("corrige los errores comunes de dominio", () => {
    expect(suggestEmailFix("juan@gmai.com")).toBe("juan@gmail.com");
    expect(suggestEmailFix("juan@gmial.com")).toBe("juan@gmail.com");
    expect(suggestEmailFix("juan@gamil.com")).toBe("juan@gmail.com");
    expect(suggestEmailFix("ana@hotmial.com")).toBe("ana@hotmail.com");
    expect(suggestEmailFix("ana@hotmai.com.ar")).toBe("ana@hotmail.com.ar");
    expect(suggestEmailFix("ana@outlok.com")).toBe("ana@outlook.com");
    expect(suggestEmailFix("ana@yaho.com")).toBe("ana@yahoo.com");
  });

  it("corrige terminaciones y dominios incompletos", () => {
    expect(suggestEmailFix("juan@gmail.con")).toBe("juan@gmail.com");
    expect(suggestEmailFix("juan@gmail.com.ar")).toBe("juan@gmail.com");
    expect(suggestEmailFix("juan@gmail.co")).toBe("juan@gmail.com");
    expect(suggestEmailFix("juan@gmail")).toBe("juan@gmail.com");
    expect(suggestEmailFix("ana@yahoo.com.ra")).toBe("ana@yahoo.com.ar");
    expect(suggestEmailFix("ana@estudio.con")).toBe("ana@estudio.com");
    expect(suggestEmailFix("juan@gmial.con")).toBe("juan@gmail.com");
  });

  it("conserva la parte local y normaliza el dominio", () => {
    expect(suggestEmailFix(" Ana.Perez@GMAI.COM ")).toBe("Ana.Perez@gmail.com");
  });

  it("no toca dominios correctos ni reales parecidos", () => {
    for (const ok of [
      "juan@gmail.com",
      "ana@hotmail.com.ar",
      "ana@outlook.com",
      "ana@yahoo.com.ar",
      "ana@mail.com",
      "ana@ymail.com",
      "ana@gmx.com",
      "ana@hotmail.es",
      "ana@estudio-perez.com.ar",
      "ana@apartcba.com",
      "ana@fibertel.com.ar",
    ]) {
      expect(suggestEmailFix(ok), ok).toBeNull();
    }
  });

  it("ignora textos que no son un email", () => {
    expect(suggestEmailFix("")).toBeNull();
    expect(suggestEmailFix(null)).toBeNull();
    expect(suggestEmailFix("juan")).toBeNull();
    expect(suggestEmailFix("juan@")).toBeNull();
    expect(suggestEmailFix("@gmail.com")).toBeNull();
  });
});
