/**
 * La óptica de la «lupa» de la barra de pestañas del celular (nov-2026): el
 * mapa de desplazamiento que la convierte en una lente convexa, como la del
 * iPhone (iOS 26). Portado de sharp-app (`src/lib/ui/lente.ts`), mismo autor y
 * mismos números: ahí está probado en iPhone y en Android de gama baja.
 *
 * La lupa muestra una copia agrandada de la barra (glass-tab-bar.tsx). Un
 * filtro SVG (`feDisplacementMap`) la dobla cerca del canto: ahí cada punto
 * muestra lo que hay MÁS AFUERA, cada vez más cuanto más cerca del borde, así
 * que lo que pasa por el canto se comprime y se curva, y el borde de la barra
 * aparece adentro de la lente como una franja curva. Los tres canales de color
 * se corren distinto (`lensChannelScales`): eso son los flecos de arco iris.
 *
 * Puro (sin DOM): el componente lo pinta en un canvas y lo pasa como data URI.
 *
 * El mapa cubre la caja de la óptica entera: la lente más `margin` de cada
 * lado (lo que el canto va a buscar afuera tiene que existir en la imagen de
 * origen). Va SIN `x/y/width/height` en el `feImage` y la caja recorta lo que
 * desborda (`overflow: hidden`): así el mapa llena la región del filtro igual
 * en Safari y en Chrome. Con subregión explícita Safari lo ubicaba al doble de
 * tamaño, y sin el recorte Chrome tomaba como región todo lo que desborda la
 * copia (la fila entera) y el canto quedaba afuera de la lente.
 */

export type LensOptions = {
  /** Lo que la óptica se extiende afuera de la lente, de cada lado (px). */
  margin: number;
  /** Ancho de la franja del canto que dobla, medido desde el borde hacia adentro (px). */
  edge: number;
  /** Cuánto va a buscar afuera el punto que está justo en el borde (px). */
  strength: number;
  /** El `scale` del canal verde en `feDisplacementMap` (px): el rango que entra en un byte. */
  scale: number;
  /** Cuánto más (rojo) y menos (azul) se corren los otros canales. */
  dispersion: number;
};

export const LENS: LensOptions = {
  margin: 18,
  edge: 24,
  strength: 22,
  scale: 56,
  dispersion: 0.125,
};

export type LensMap = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

/**
 * El mapa RGBA de una lente con forma de pastilla de `width` × `height` px
 * (rojo = corrimiento horizontal, verde = vertical; 128 = quieto). Mide
 * `width + 2·margin` × `height + 2·margin`, un píxel por px.
 */
export function lensMap(width: number, height: number, o: LensOptions = LENS): LensMap {
  const W = Math.max(1, Math.round(width + 2 * o.margin));
  const H = Math.max(1, Math.round(height + 2 * o.margin));
  const data = new Uint8ClampedArray(W * H * 4);
  const radius = Math.min(width, height) / 2;
  const wide = width >= height;
  const byte = (shift: number) => Math.round((0.5 + shift / o.scale) * 255);

  for (let j = 0; j < H; j++) {
    const y = j + 0.5 - o.margin;
    for (let i = 0; i < W; i++) {
      const x = i + 0.5 - o.margin;
      // El punto más cercano del «alma» de la pastilla (el segmento entre los
      // centros de las dos puntas redondas): de ahí sale la normal del canto.
      const cx = wide ? Math.min(Math.max(x, radius), width - radius) : width / 2;
      const cy = wide ? height / 2 : Math.min(Math.max(y, radius), height - radius);
      const dx = x - cx;
      const dy = y - cy;
      const rho = Math.hypot(dx, dy);
      const inside = radius - rho;
      let ox = 0;
      let oy = 0;
      // Afuera de la lente no se ve (la recorta su borde): queda quieto, salvo
      // un par de px para que el borde suavizado no muestre una costura.
      if (rho > 1e-6 && inside < o.edge && inside > -2) {
        const t = 1 - Math.max(0, inside) / o.edge;
        const m = o.strength * t * t;
        ox = (dx / rho) * m;
        oy = (dy / rho) * m;
      }
      const k = (j * W + i) * 4;
      data[k] = byte(ox);
      data[k + 1] = byte(oy);
      data[k + 2] = 128;
      data[k + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

/** Los `scale` de los tres `feDisplacementMap` (rojo, verde, azul). */
export function lensChannelScales(o: LensOptions = LENS): { r: number; g: number; b: number } {
  const round = (x: number) => Math.round(x * 100) / 100;
  return { r: round(o.scale * (1 + o.dispersion)), g: o.scale, b: round(o.scale * (1 - o.dispersion)) };
}

/**
 * El estirón de la lupa con la velocidad del dedo (px/ms): se alarga en el
 * sentido en que va y se afina un poco, como una gota. Con el dedo quieto, 1.
 */
export function lensStretch(velocity: number): { x: number; y: number } {
  const s = Math.min(0.1, Math.abs(velocity) * 0.06);
  return { x: 1 + s, y: 1 - s * 0.6 };
}

/**
 * Pasado el borde (primera o última pestaña) la lupa se sigue corriendo, cada
 * vez menos, hasta `limit` px: el rebote elástico de iOS.
 */
export function rubberBand(overshoot: number, limit = 10): number {
  if (overshoot <= 0) return 0;
  return limit * (1 - 1 / ((overshoot * 0.5) / limit + 1));
}
