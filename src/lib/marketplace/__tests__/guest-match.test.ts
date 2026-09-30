import { describe, expect, it } from "vitest";
import { emailIlikePattern, isSameWebGuest, phoneTail, pickReusableGuest } from "../guest-match";

describe("phoneTail", () => {
  it("toma los últimos 8 dígitos sin importar el formato", () => {
    expect(phoneTail("+54 9 351 555-1234")).toBe("15551234");
    expect(phoneTail("351 555-1234")).toBe("15551234");
    expect(phoneTail("+5493515551234")).toBe("15551234");
  });

  it("con menos de 8 dígitos no alcanza para comparar", () => {
    expect(phoneTail("555-123")).toBeNull();
    expect(phoneTail("")).toBeNull();
    expect(phoneTail(null)).toBeNull();
    expect(phoneTail(undefined)).toBeNull();
  });
});

describe("isSameWebGuest", () => {
  const web = { email: "Juan.Perez@Gmail.com ", phone: "+5493515551234" };

  it("reusa sólo con el mismo email (sin mayúsculas) Y el mismo teléfono", () => {
    expect(isSameWebGuest({ email: "juan.perez@gmail.com", phone: "0351 555-1234" }, web)).toBe(true);
    expect(isSameWebGuest({ email: "JUAN.PEREZ@GMAIL.COM", phone: "+54 9 351 555 1234" }, web)).toBe(true);
  });

  it("ante la duda, ficha nueva: el formato viejo con 15 no coincide en 8 dígitos", () => {
    // 0351 15 555-1234 → …55551234 vs +54 9 351 555-1234 → …15551234.
    expect(isSameWebGuest({ email: "juan.perez@gmail.com", phone: "0351 15 555-1234" }, web)).toBe(false);
  });

  it("el email solo no alcanza: el de la web no está verificado", () => {
    expect(isSameWebGuest({ email: "juan.perez@gmail.com", phone: "+5493515559999" }, web)).toBe(false);
    expect(isSameWebGuest({ email: "juan.perez@gmail.com", phone: null }, web)).toBe(false);
    expect(isSameWebGuest({ email: "juan.perez@gmail.com", phone: "1234" }, web)).toBe(false);
  });

  it("el teléfono solo tampoco", () => {
    expect(isSameWebGuest({ email: "otro@gmail.com", phone: "351 555 1234" }, web)).toBe(false);
    expect(isSameWebGuest({ email: null, phone: "351 555 1234" }, web)).toBe(false);
  });

  it("sin email o sin teléfono en el pedido no reusa nada", () => {
    expect(isSameWebGuest({ email: "", phone: "351 555 1234" }, { email: "", phone: "351 555 1234" })).toBe(false);
    expect(isSameWebGuest({ email: "a@b.com", phone: null }, { email: "a@b.com", phone: null })).toBe(false);
  });
});

describe("pickReusableGuest", () => {
  const web = { email: "ana@mail.com", phone: "+5493515551234" };

  it("elige la primera candidata (la más vieja) que coincide en los dos datos", () => {
    const candidates = [
      { id: "g1", email: "ana@mail.com", phone: "+5493515550000" },
      { id: "g2", email: "Ana@Mail.com", phone: "351 555-1234" },
      { id: "g3", email: "ana@mail.com", phone: "3515551234" },
    ];
    expect(pickReusableGuest(candidates, web)?.id).toBe("g2");
  });

  it("sin coincidencia exacta → null (se crea una ficha nueva)", () => {
    expect(pickReusableGuest([{ id: "g1", email: "ana@mail.com", phone: null }], web)).toBeNull();
    expect(pickReusableGuest([], web)).toBeNull();
    expect(pickReusableGuest(null, web)).toBeNull();
  });

  it("descarta candidatas que el ILIKE trajo de más", () => {
    // `ana_x@mail.com` como patrón sin escapar también traería `anaXx@mail.com`.
    const candidates = [{ id: "g1", email: "anaXx@mail.com", phone: "3515551234" }];
    expect(pickReusableGuest(candidates, { email: "ana_x@mail.com", phone: "+5493515551234" })).toBeNull();
  });
});

describe("emailIlikePattern", () => {
  it("normaliza y escapa los comodines de LIKE", () => {
    expect(emailIlikePattern(" Ana_Perez@Mail.com ")).toBe("ana\\_perez@mail.com");
    expect(emailIlikePattern("a%b@c.com")).toBe("a\\%b@c.com");
    expect(emailIlikePattern("a\\b@c.com")).toBe("a\\\\b@c.com");
    expect(emailIlikePattern("simple@mail.com")).toBe("simple@mail.com");
  });
});
