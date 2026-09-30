/**
 * Dónde dibujar la vista previa de una unidad sobre el mapa de /buscar para
 * que se vea COMPLETA: arriba del precio si entra; si no, abajo, a la derecha
 * o a la izquierda (en ese orden); y si no entra de ningún lado, corrida hasta
 * quedar adentro del mapa, sin tapar la píldora si hay forma (`fits: false`
 * avisa que conviene probar una tarjeta más chica). Puro: recibe medidas en px
 * del contenedor del mapa y devuelve la posición de la tarjeta y su punto de anclaje.
 */

export type PreviewSide = "top" | "bottom" | "left" | "right";

export interface PreviewPlacement {
  /** Esquina superior izquierda de la tarjeta, en px del contenedor. */
  left: number;
  top: number;
  /** De qué lado del precio quedó la tarjeta. */
  side: PreviewSide;
  /**
   * Punto del borde que mira al precio, alineado con él (px desde la izquierda
   * en top/bottom, desde arriba en left/right): de ahí "crece" la entrada. null
   * cuando la tarjeta tuvo que correrse y ya no queda enfrentada al precio.
   */
  anchor: number | null;
  /** true: entró de un lado del precio con todo el aire; false: tuvo que correrse. */
  fits: boolean;
}

export interface PlacePreviewInput {
  /** El punto de la unidad (la base de la píldora), en px del contenedor. */
  point: { x: number; y: number };
  card: { width: number; height: number };
  container: { width: number; height: number };
  /** La píldora del precio: centrada en x y apoyada ARRIBA del punto. */
  pill?: { width: number; height: number };
  /** Aire entre la píldora y la tarjeta. */
  gap?: number;
  /** Aire mínimo contra los bordes del mapa. */
  margin?: number;
  /** El anclaje no se acerca a menos de esto de una esquina redondeada. */
  anchorInset?: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export function placePreview(input: PlacePreviewInput): PreviewPlacement {
  const { point, card, container } = input;
  const pillW = input.pill?.width ?? 88;
  const pillH = input.pill?.height ?? 34;
  const gap = input.gap ?? 12;
  const m = input.margin ?? 12;
  const inset = input.anchorInset ?? 22;
  const { width: w, height: h } = card;
  const { width: W, height: H } = container;

  const pillCenterY = point.y - pillH / 2;
  const hLeft = clamp(point.x - w / 2, m, W - w - m);
  const vTop = clamp(pillCenterY - h / 2, m, H - h - m);
  const fitsAcross = w <= W - 2 * m;
  const fitsDown = h <= H - 2 * m;

  const candidates: Array<{ side: PreviewSide; left: number; top: number; fits: boolean; room: number }> = [
    {
      side: "top",
      left: hLeft,
      top: point.y - pillH - gap - h,
      fits: fitsAcross && point.y - pillH - gap - h >= m,
      room: point.y - pillH - gap - m,
    },
    {
      side: "bottom",
      left: hLeft,
      top: point.y + gap,
      fits: fitsAcross && point.y + gap + h <= H - m,
      room: H - m - (point.y + gap),
    },
    {
      side: "right",
      left: point.x + pillW / 2 + gap,
      top: vTop,
      fits: fitsDown && point.x + pillW / 2 + gap + w <= W - m,
      room: W - m - (point.x + pillW / 2 + gap),
    },
    {
      side: "left",
      left: point.x - pillW / 2 - gap - w,
      top: vTop,
      fits: fitsDown && point.x - pillW / 2 - gap - w >= m,
      room: point.x - pillW / 2 - gap - m,
    },
  ];

  const chosen = candidates.find((c) => c.fits);
  if (chosen) {
    return {
      side: chosen.side,
      left: chosen.left,
      top: chosen.top,
      anchor: anchorFor(chosen.side, chosen.left, chosen.top),
      fits: true,
    };
  }

  // No entra de ningún lado: cada lado corrido hasta quedar entero adentro del
  // mapa. Gana el que menos tapa la píldora (ninguno, con suerte) y, a igual
  // tapado, el que tiene más lugar. Tapándola no hay anclaje.
  const pill = { l: point.x - pillW / 2 - 4, r: point.x + pillW / 2 + 4, t: point.y - pillH - 4, b: point.y + 4 };
  const shifted = candidates.map((c) => {
    const left = clamp(c.left, m, W - w - m);
    const top = clamp(c.top, m, H - h - m);
    const covered =
      Math.max(0, Math.min(left + w, pill.r) - Math.max(left, pill.l)) *
      Math.max(0, Math.min(top + h, pill.b) - Math.max(top, pill.t));
    return { side: c.side, room: c.room, left, top, covered };
  });
  const best = shifted.reduce((a, b) => (b.covered < a.covered || (b.covered === a.covered && b.room > a.room) ? b : a));
  return {
    side: best.side,
    left: best.left,
    top: best.top,
    anchor: best.covered === 0 ? anchorFor(best.side, best.left, best.top) : null,
    fits: false,
  };

  function anchorFor(side: PreviewSide, left: number, top: number): number | null {
    const along = side === "top" || side === "bottom" ? point.x - left : pillCenterY - top;
    const length = side === "top" || side === "bottom" ? w : h;
    return along >= inset && along <= length - inset ? along : null;
  }
}
