import { describe, expect, it } from "vitest";
import { isStaleActionText } from "../stale-deploy-text";

// El mensaje tal cual lo arma Next 16 (server-action-reducer.js).
const NEXT_MESSAGE =
  'Server Action "40b72c80b76f70fae6c5ed6facfdd325225abb3472" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action';

describe("isStaleActionText", () => {
  it("reconoce el mensaje de Next ya convertido en texto (lo que muestra un toast)", () => {
    expect(isStaleActionText(NEXT_MESSAGE)).toBe(true);
  });

  it("reconoce el error sin convertir", () => {
    expect(isStaleActionText(new Error(NEXT_MESSAGE))).toBe(true);
  });

  it("no confunde un error nuestro ni uno de red", () => {
    expect(isStaleActionText("No se pudo subir la foto")).toBe(false);
    expect(isStaleActionText("Failed to fetch")).toBe(false);
    expect(isStaleActionText(new Error("La unidad no existe en el servidor"))).toBe(false);
  });

  it("lo que no es texto ni error no cuenta", () => {
    expect(isStaleActionText(undefined)).toBe(false);
    expect(isStaleActionText(null)).toBe(false);
    expect(isStaleActionText({ message: NEXT_MESSAGE })).toBe(false);
  });
});
