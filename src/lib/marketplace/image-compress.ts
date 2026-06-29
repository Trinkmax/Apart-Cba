// Compresión de imágenes 100% en el navegador, ANTES de subirlas al server action.
//
// Las fotos de cámara llegan a varios MB y 4000px+. Las reescalamos a un JPEG de
// ~2560px de lado mayor con calidad alta: pesan una fracción, suben rápido, no
// chocan con el límite de 10 MB del action, y el "origen" que después transforma
// Supabase queda liviano. La orientación EXIF se hornea en los píxeles (y se
// descarta el metadata, así que no hay fotos "de costado").
//
// Si algo falla (formato raro, canvas bloqueado), se devuelve null y el caller
// sube el archivo original — nunca bloqueamos la subida por la compresión.

export type CompressedImage = {
  blob: Blob;
  contentType: "image/jpeg";
  width: number;
  height: number;
};

const MAX_EDGE = 2560;
const QUALITY = 0.82;

export async function compressImage(file: File): Promise<CompressedImage | null> {
  let source: ImageBitmap | HTMLImageElement | null = null;
  try {
    source = await loadImage(file);
    const ow = "naturalWidth" in source ? source.naturalWidth : source.width;
    const oh = "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!ow || !oh) return null;

    const scale = Math.min(1, MAX_EDGE / Math.max(ow, oh));
    const width = Math.max(1, Math.round(ow * scale));
    const height = Math.max(1, Math.round(oh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITY),
    );
    if (!blob || blob.size === 0) return null;

    return { blob, contentType: "image/jpeg", width, height };
  } catch {
    return null;
  } finally {
    if (source && typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      source.close();
    }
  }
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // `createImageBitmap` es lo más rápido y respeta la orientación EXIF.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Algunos navegadores no soportan la opción; caemos al <img>.
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen"));
    };
    img.src = url;
  });
}
