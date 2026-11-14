import { cn } from "@/lib/utils";

/**
 * Tex, la cara del agente (nov-2026). Pixel-art de la familia textOS.
 *
 * Estados (`mood`):
 * - `face`: primer plano de la cara, parpadea cada tanto (el círculo de la barra).
 * - `talking`: la cara mueve la boca (mientras llega la respuesta). La tira de
 *   tres cuadros avanza con una animación CSS por pasos: sin timers ni renders.
 * - `idle`: cuerpo entero con la vincha de soporte.
 * - `thinking`: con lentes y el gráfico (mientras corre una herramienta).
 * - `happy`: con el trofeo, saluda una vez (una acción salió bien).
 * - `wave`: saludando (la bienvenida).
 *
 * Decorativo: el nombre va escrito al lado. Con «reducir movimiento» no se mueve.
 */
export type TexMood = "face" | "talking" | "idle" | "thinking" | "happy" | "wave";

const STILL: Record<Exclude<TexMood, "face" | "talking">, { src: string; w: number; h: number }> = {
  idle: { src: "/tex/tex-support.webp", w: 400, h: 360 },
  thinking: { src: "/tex/tex-analytics.webp", w: 400, h: 325 },
  happy: { src: "/tex/tex-goals.webp", w: 400, h: 326 },
  wave: { src: "/tex/tex-wave.webp", w: 400, h: 321 },
};

export function TexAvatar({
  mood = "face",
  className,
  float = false,
  pop = false,
}: {
  mood?: TexMood;
  /** El tamaño lo pone quien lo usa (`className="size-11"`). */
  className?: string;
  /** Flota apenas (quieto, en pantallas vacías). */
  float?: boolean;
  /** Entra con un saltito. */
  pop?: boolean;
}) {
  const sprite = mood === "face" || mood === "talking";
  const still = sprite ? STILL.idle : STILL[mood];
  return (
    <span
      aria-hidden
      className={cn("tex", float && "tex-float", pop && "tex-pop-in", className)}
      data-face={mood === "face" ? "" : undefined}
      data-talking={mood === "talking" ? "" : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pixel-art chico, sin optimizador (402 de Vercel) */}
      <img
        key={still.src}
        src={still.src}
        alt=""
        width={still.w}
        height={still.h}
        draggable={false}
        decoding="async"
        className={cn("tex-still absolute inset-0 size-full object-contain", mood === "happy" && "tex-wave")}
      />
      <span className="tex-face absolute inset-0" />
    </span>
  );
}
