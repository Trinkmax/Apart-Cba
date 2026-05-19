/**
 * Procesa una imagen en el navegador ANTES de subirla al server action.
 *
 * Por qué existe:
 *  - Las fotos de cámara de celular llegan en HEIC (iPhone) o JPEG full-res de
 *    varios MB. El HEIC no lo renderiza ningún browser salvo Safari, así que
 *    una foto subida "bien" se veía rota en el dashboard (Chrome) y Android.
 *  - El límite de body de Server Actions cortaba las fotos grandes antes de
 *    llegar al server.
 *
 * Qué hace: redimensiona al borde mayor <= MAX_EDGE y re-encoda a JPEG. El
 * resultado siempre es un `image/jpeg` chico (~150-500KB) que se ve en todos
 * lados y entra holgado en el límite de body.
 *
 * Robustez: si el browser no puede decodificar el archivo (p.ej. un HEIC en
 * Android que iOS no convirtió), devolvemos el archivo original SIN tocar —
 * nunca bloqueamos el upload. El server sigue aceptándolo como fallback.
 */

const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.82;
// Por debajo de esto no vale la pena recomprimir (ya es chico y web-safe).
const SKIP_IF_SMALLER_THAN = 400 * 1024;

function canDecodeInBrowser(file: File): boolean {
  const t = file.type.toLowerCase();
  // HEIC/HEIF sólo decodifica en Safari/iOS. En el resto, intentar el canvas
  // falla → mejor devolver el original y dejar que el server lo guarde tal cual.
  if (t.includes("heic") || t.includes("heif")) return false;
  return t.startsWith("image/");
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap es el camino rápido y libera memoria explícitamente.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // cae al <img> de abajo
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode-failed"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dimsOf(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if ("naturalWidth" in src) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

/**
 * Convierte/achica una imagen a JPEG. Devuelve un `File` nuevo `image/jpeg`,
 * o el original si no se pudo procesar.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (typeof window === "undefined") return file;
  if (!canDecodeInBrowser(file)) return file;
  // Un JPEG/PNG/WebP ya chico no necesita pasada (ahorra CPU en el celu).
  if (file.type === "image/jpeg" && file.size < SKIP_IF_SMALLER_THAN) return file;

  let bitmap: ImageBitmap | HTMLImageElement | null = null;
  try {
    bitmap = await loadBitmap(file);
    const { w, h } = dimsOf(bitmap);
    if (!w || !h) return file;

    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // Fondo blanco: un PNG con transparencia exportado a JPEG queda negro si no.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(bitmap, 0, 0, tw, th);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) return file;
    // Si por alguna razón quedó más pesado que el original, usamos el original.
    if (blob.size >= file.size && file.type === "image/jpeg") return file;

    const base = file.name.replace(/\.[^./\\]+$/, "") || "foto";
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    if (bitmap && "close" in bitmap) bitmap.close();
  }
}
