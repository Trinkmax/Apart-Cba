import { cache } from "react";
import { getParteDiario } from "@/lib/actions/parte-diario";
import { countPendingRequestsForOrg } from "@/lib/actions/booking-requests";

/**
 * El día leído una sola vez por request: lo usan el tablero del Resumen (compu)
 * y "Tex te cuenta" (celular), que se renderizan los dos en la misma página y
 * se esconden por CSS según el ancho. Fuera de un render (una server action,
 * la burbuja de Tex) `cache` no memoriza y cada llamada lee de nuevo.
 */
export const loadToday = cache(async (day: string) => {
  const [parte, requests] = await Promise.all([
    getParteDiario(day).catch(() => null),
    countPendingRequestsForOrg().catch(() => 0),
  ]);
  return { parte, requests };
});
