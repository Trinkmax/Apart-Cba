import { jsPDF } from "jspdf";

export type RGB = [number, number, number];

export type OrgBranding = {
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  logo_url: string | null;
  primary_color: string | null;
};

export const BRAND_DEFAULT: RGB = [15, 118, 110];
export const TEXT_INK: RGB = [15, 23, 42];
export const TEXT_MUTED: RGB = [100, 116, 139];
export const HAIRLINE: RGB = [226, 232, 240];

export function hexToRgb(hex: string | null | undefined): RGB | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function resolveBrandColor(org: Pick<OrgBranding, "primary_color">): RGB {
  return hexToRgb(org.primary_color) ?? BRAND_DEFAULT;
}

export type LoadedLogo = {
  dataUrl: string;
  format: "PNG" | "JPEG";
  w: number;
  h: number;
};

export async function loadOrgLogo(
  url: string | null | undefined
): Promise<LoadedLogo | null> {
  if (!url) return null;
  if (typeof window === "undefined") return null; // server-side: skip silently
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const isJpeg = /\.jpe?g(\?|$)/i.test(url);
        const fmt = isJpeg ? "image/jpeg" : "image/png";
        resolve({
          dataUrl: canvas.toDataURL(fmt),
          format: isJpeg ? "JPEG" : "PNG",
          w: img.naturalWidth,
          h: img.naturalHeight,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function setFill(doc: jsPDF, c: RGB) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function setText(doc: jsPDF, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2]);
}
function setStroke(doc: jsPDF, c: RGB) {
  doc.setDrawColor(c[0], c[1], c[2]);
}

export type DrawOrgHeaderOptions = {
  /** Page width in mm (210 portrait, 297 landscape). */
  pageWidth: number;
  /** Header band height in mm. */
  headerHeight: number;
  /** Margin X in mm (default 14). */
  marginX?: number;
  /** Show legal_name and tax_id under the org name. Default true. */
  showFiscalInfo?: boolean;
  /** Pre-loaded logo to skip the async load. */
  logo?: LoadedLogo | null;
  /** Logo box side in mm (default 22). */
  logoSize?: number;
  /** Org name font size in pt (default 18). */
  nameFontSize?: number;
};

/**
 * Draws the brand band + logo + org name (+ optional legal_name and tax_id)
 * on the LEFT of the header. Returns brand color, the X coordinate where
 * right-side content can start (after the logo), and the loaded logo so the
 * caller doesn't have to load it again.
 */
export async function drawOrgBrandHeader(
  doc: jsPDF,
  org: OrgBranding,
  opts: DrawOrgHeaderOptions
): Promise<{ brand: RGB; titleX: number; logo: LoadedLogo | null }> {
  const marginX = opts.marginX ?? 14;
  const showFiscalInfo = opts.showFiscalInfo ?? true;
  const logoSize = opts.logoSize ?? 22;
  const nameFontSize = opts.nameFontSize ?? 18;
  const brand = resolveBrandColor(org);

  // Band
  setFill(doc, brand);
  doc.rect(0, 0, opts.pageWidth, opts.headerHeight, "F");

  // Subtle accent line below
  setFill(doc, brand);
  type GStateCtor = new (o: { opacity: number }) => unknown;
  const GState = (doc as unknown as { GState: GStateCtor }).GState;
  doc.setGState(new GState({ opacity: 0.18 }));
  doc.rect(0, opts.headerHeight, opts.pageWidth, 3, "F");
  doc.setGState(new GState({ opacity: 1 }));

  // Logo (white rounded box, contain-fit)
  let logo: LoadedLogo | null = opts.logo ?? null;
  if (!logo && org.logo_url) {
    logo = await loadOrgLogo(org.logo_url);
  }
  let textX = marginX;
  const logoBoxSize = logoSize + 4;
  const logoBoxY = Math.max(8, (opts.headerHeight - logoBoxSize) / 2);
  if (logo) {
    setFill(doc, [255, 255, 255]);
    doc.roundedRect(marginX, logoBoxY, logoBoxSize, logoBoxSize, 3, 3, "F");
    const ratio = logo.w / logo.h;
    let w = logoSize;
    let h = logoSize;
    if (ratio > 1) h = logoSize / ratio;
    else w = logoSize * ratio;
    doc.addImage(
      logo.dataUrl,
      logo.format,
      marginX + (logoBoxSize - w) / 2,
      logoBoxY + (logoBoxSize - h) / 2,
      w,
      h
    );
    textX = marginX + logoBoxSize + 6;
  }

  // Org name + (optional) fiscal info
  setText(doc, [255, 255, 255]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(nameFontSize);

  const baseY = logo ? logoBoxY + logoBoxSize / 2 + 1 : opts.headerHeight / 2 + 1;
  if (showFiscalInfo && (org.legal_name || org.tax_id)) {
    // Push name up so legal_name/tax_id fit underneath
    const nameY = baseY - 4;
    doc.text(org.name.toUpperCase(), textX, nameY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let infoY = nameY + 5;
    if (org.legal_name) {
      doc.text(org.legal_name, textX, infoY);
      infoY += 4.5;
    }
    if (org.tax_id) {
      doc.text(`CUIT/Tax ID: ${org.tax_id}`, textX, infoY);
    }
  } else {
    doc.text(org.name.toUpperCase(), textX, baseY);
  }

  // Reset to ink for caller
  setText(doc, TEXT_INK);
  return { brand, titleX: textX, logo };
}

export type DrawOrgFooterOptions = {
  pageWidth: number;
  pageHeight: number;
  marginX?: number;
  /** If provided, shown right-aligned as "Emitido por: ...". */
  issuedByName?: string | null;
  /** Extra footer lines (small, muted) appended after the legal info on the left. */
  extraLines?: string[];
  /** Internal id rendered tiny on the bottom right (e.g. movement.id). */
  internalId?: string | null;
};

export function drawOrgFooter(
  doc: jsPDF,
  org: Pick<OrgBranding, "legal_name" | "tax_id">,
  opts: DrawOrgFooterOptions
): void {
  const marginX = opts.marginX ?? 14;
  const footerY = opts.pageHeight - 28;

  setStroke(doc, HAIRLINE);
  doc.setLineWidth(0.3);
  doc.line(marginX, footerY, opts.pageWidth - marginX, footerY);

  setText(doc, TEXT_MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  const lines: string[] = [];
  if (org.legal_name) lines.push(org.legal_name);
  if (org.tax_id) lines.push(`CUIT/Tax ID: ${org.tax_id}`);
  if (opts.extraLines) lines.push(...opts.extraLines);
  if (lines.length === 0) lines.push("Documento informativo emitido digitalmente.");

  let fy = footerY + 5;
  for (const line of lines) {
    doc.text(line, marginX, fy);
    fy += 3.5;
  }

  if (opts.issuedByName) {
    doc.text(`Emitido por: ${opts.issuedByName}`, opts.pageWidth - marginX, footerY + 5, {
      align: "right",
    });
  }
  if (opts.internalId) {
    setText(doc, [148, 163, 184]);
    doc.setFontSize(7);
    doc.text(
      `Identificador interno: ${opts.internalId}`,
      opts.pageWidth - marginX,
      opts.pageHeight - 8,
      { align: "right" }
    );
  }
  setText(doc, TEXT_INK);
}
