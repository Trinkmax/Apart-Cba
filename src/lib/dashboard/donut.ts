/**
 * La geometría de la torta de «Unidades ahora»: cada parte es un trazo sobre
 * un círculo de `pathLength = 1000`, con un hueco del color de la tarjeta
 * entre una y otra (las partes se separan por el hueco, nunca por un borde).
 */

export const DONUT_LENGTH = 1000;

export interface DonutPart {
  key: string;
  value: number;
}

export interface DonutSegment {
  key: string;
  value: number;
  /** Parte del total, de 0 a 1. */
  share: number;
  /** `stroke-dasharray` del trazo. */
  dashArray: string;
  /** `stroke-dashoffset` del trazo (arranca a las 12, en el sentido del reloj, con el círculo rotado -90°). */
  dashOffset: number;
}

/**
 * Las partes en cero no se dibujan. Con una sola parte, el anillo va entero y
 * sin hueco. Una parte chiquita (1 de 73) igual se ve: tiene un largo mínimo.
 */
export function donutSegments(parts: DonutPart[], opts: { gap: number; minVisible?: number } = { gap: 5 }): DonutSegment[] {
  const minVisible = opts.minVisible ?? 3;
  const drawn = parts.filter((p) => p.value > 0);
  const total = drawn.reduce((acc, p) => acc + p.value, 0);
  if (total === 0) return [];

  if (drawn.length === 1) {
    const only = drawn[0];
    return [{ key: only.key, value: only.value, share: 1, dashArray: `${DONUT_LENGTH} 0`, dashOffset: 0 }];
  }

  let start = 0;
  return drawn.map((p) => {
    const length = (p.value / total) * DONUT_LENGTH;
    const visible = Math.max(length - opts.gap, minVisible);
    const segment: DonutSegment = {
      key: p.key,
      value: p.value,
      share: p.value / total,
      dashArray: `${round(visible)} ${round(DONUT_LENGTH - visible)}`,
      // El trazo arranca medio hueco después del inicio de su parte.
      dashOffset: round(-(start + opts.gap / 2)),
    };
    start += length;
    return segment;
  });
}

/**
 * El hueco, en unidades de `pathLength`, para que mida `px` píxeles cuando la
 * torta se dibuja en una caja de `boxPx` (el anillo ocupa `ringShare` de la caja:
 * radio 40 en un viewBox de 100 → 0,8).
 */
export function gapForPixels(px: number, boxPx: number, ringShare = 0.8): number {
  const circumferencePx = Math.PI * boxPx * ringShare;
  return (px / circumferencePx) * DONUT_LENGTH;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
