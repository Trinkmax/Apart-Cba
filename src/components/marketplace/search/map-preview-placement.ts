/**
 * Dónde dibujar la vista previa de una unidad sobre el mapa de /buscar para
 * que se vea COMPLETA: arriba del precio si entra; si no, abajo, a la derecha
 * o a la izquierda (en ese orden); y si no entra de ningún lado, corrida hasta
 * quedar adentro del mapa aunque tape la píldora. Puro: recibe medidas en px
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
    return { side: chosen.side, left: chosen.left, top: chosen.top, anchor: anchorFor(chosen.side, chosen.left, chosen.top) };
  }

  // No entra de ningún lado: el lado con más lugar, y la tarjeta corrida hasta
  // quedar entera adentro del mapa. Si aun corrida sigue de ese lado de la
  // píldora (sin taparla), conserva el anclaje; si la tapa, se pierde.
  const best = candidates.reduce((a, b) => (b.room > a.room ? b : a));
  const left = clamp(best.left, m, W - w - m);
  const top = clamp(best.top, m, H - h - m);
  const clearOfPill =
    best.side === "top"
      ? top + h <= point.y - pillH - 4
      : best.side === "bottom"
        ? top >= point.y + 4
        : best.side === "right"
          ? left >= point.x + pillW / 2 + 4
          : left + w <= point.x - pillW / 2 - 4;
  return { side: best.side, left, top, anchor: clearOfPill ? anchorFor(best.side, left, top) : null };

  function anchorFor(side: PreviewSide, left: number, top: number): number | null {
    const along = side === "top" || side === "bottom" ? point.x - left : pillCenterY - top;
    const length = side === "top" || side === "bottom" ? w : h;
    return along >= inset && along <= length - inset ? along : null;
  }
}
