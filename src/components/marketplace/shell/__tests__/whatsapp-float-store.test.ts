import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWhatsAppTopicUrl,
  getWhatsAppTopicUrl,
  setWhatsAppTopicUrl,
  subscribeWhatsAppTopic,
} from "../whatsapp-float-store";

const FICHA = "https://wa.me/5493515639985?text=Hola%2C%20quiero%20consultar%20por%20Peredo";
const RESERVA = "https://wa.me/5493515639985?text=Te%20escribo%20por%20mi%20reserva";

afterEach(() => setWhatsAppTopicUrl(null));

describe("whatsapp-float-store", () => {
  it("arranca sin tema: el botón usa el saludo general", () => {
    expect(getWhatsAppTopicUrl()).toBeNull();
  });

  it("publica el link de la página y avisa a los suscriptos una sola vez por cambio", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWhatsAppTopic(listener);
    setWhatsAppTopicUrl(FICHA);
    setWhatsAppTopicUrl(FICHA);
    expect(getWhatsAppTopicUrl()).toBe(FICHA);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setWhatsAppTopicUrl(RESERVA);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("al irse, la página retira sólo su propio link", () => {
    setWhatsAppTopicUrl(FICHA);
    // La página nueva publicó antes de que la vieja se desmonte.
    setWhatsAppTopicUrl(RESERVA);
    clearWhatsAppTopicUrl(FICHA);
    expect(getWhatsAppTopicUrl()).toBe(RESERVA);
    clearWhatsAppTopicUrl(RESERVA);
    expect(getWhatsAppTopicUrl()).toBeNull();
  });
});
