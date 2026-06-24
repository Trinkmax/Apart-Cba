// Compresión de video 100% en el navegador con ffmpeg.wasm (single-thread, no
// requiere SharedArrayBuffer ni headers COOP/COEP). Se usa SOLO en el panel admin
// al subir un video; el sitio público nunca importa esto. El `import` de
// `@ffmpeg/ffmpeg` es dinámico para que el ~core wasm no entre en el bundle inicial.
//
// El core wasm se carga desde CDN (unpkg) la primera vez y se cachea. La salida
// queda guardada permanentemente en Supabase Storage, así que la reproducción
// nunca depende de ffmpeg ni del CDN.

// Single-thread core (sin SharedArrayBuffer). Pinéado a una versión conocida.
const FFMPEG_CORE_VERSION = "0.12.6";
const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

type FFmpegInstance = import("@ffmpeg/ffmpeg").FFmpeg;

let ffmpegPromise: Promise<FFmpegInstance> | null = null;

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return ffmpeg;
  })();
  // Si la carga falla, permitir reintentar en una próxima llamada.
  ffmpegPromise.catch(() => {
    ffmpegPromise = null;
  });
  return ffmpegPromise;
}

function extFromFile(file: File): string {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()! : "";
  if (fromName) return fromName.toLowerCase().slice(0, 5);
  if (file.type === "video/quicktime") return "mov";
  if (file.type === "video/webm") return "webm";
  return "mp4";
}

export type CompressProgress = (ratio: number) => void;

/**
 * Comprime un video a H.264/AAC mp4, limitando el lado mayor a 1080p (1920px) y
 * usando CRF 24 (calidad alta, peso razonable) con `+faststart` para streaming web.
 * Devuelve el blob comprimido. Lanza si ffmpeg no pudo cargar o procesar.
 */
export async function compressVideo(
  file: File,
  onProgress?: CompressProgress,
): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = await import("@ffmpeg/util");

  const inputName = `input.${extFromFile(file)}`;
  const outputName = "output.mp4";

  const progressHandler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) {
      onProgress?.(Math.max(0, Math.min(1, progress)));
    }
  };
  ffmpeg.on("progress", progressHandler);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
      "-i", inputName,
      // Escala dentro de una caja 1920x1920 manteniendo aspecto, sin agrandar,
      // forzando dimensiones pares (requisito de yuv420p / libx264).
      "-vf", "scale=1920:1920:force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputName,
    ]);
    const data = await ffmpeg.readFile(outputName);
    // `data` es Uint8Array. Copiamos a un ArrayBuffer fresco para el Blob.
    const bytes = data as Uint8Array;
    const blob = new Blob([bytes.slice().buffer], { type: "video/mp4" });
    if (blob.size === 0) throw new Error("La compresión devolvió un archivo vacío");
    return blob;
  } finally {
    ffmpeg.off("progress", progressHandler);
    // Limpiar el FS virtual (ignorar errores si ya no existen).
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

export type PosterResult = {
  posterBlob: Blob;
  durationMs: number;
  width: number;
  height: number;
};

/**
 * Extrae un frame del video (≈1s o la mitad si es más corto) como JPEG y obtiene
 * duración + dimensiones reales. Se corre sobre el blob YA comprimido para que las
 * dimensiones y la orientación coincidan con lo que se va a reproducir.
 */
export function extractPosterAndMeta(source: Blob): Promise<PosterResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(source);
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(msg));
    };

    const capture = () => {
      if (settled) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        fail("No se pudieron leer las dimensiones del video");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        fail("No se pudo crear el thumbnail");
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            fail("No se pudo generar el thumbnail");
            return;
          }
          settled = true;
          const durationMs = Number.isFinite(video.duration)
            ? Math.round(video.duration * 1000)
            : 0;
          cleanup();
          resolve({ posterBlob: blob, durationMs, width: w, height: h });
        },
        "image/jpeg",
        0.82,
      );
    };

    video.onloadeddata = () => {
      const target = Math.min(1, (video.duration || 2) / 2);
      video.onseeked = () => capture();
      // iOS Safari a veces no decodifica frames de un video sólo "preloaded";
      // un play() mudo y breve fuerza el decode antes de buscar el frame.
      void video.play().then(() => video.pause()).catch(() => {});
      try {
        video.currentTime = target;
      } catch {
        capture();
      }
    };
    video.onerror = () => fail("No se pudo leer el video para el thumbnail");

    // Guard de seguridad: si nada dispara en 20s, abortar.
    setTimeout(() => fail("Timeout generando el thumbnail del video"), 20_000);

    video.src = url;
  });
}
