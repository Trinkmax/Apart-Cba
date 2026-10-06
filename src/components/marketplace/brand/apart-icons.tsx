import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Íconos propios de apart para los pasos de la reserva y las estadías por mes
 * (en vez de los de lucide, que se ven genéricos). Mismo lenguaje en todos:
 * trazo forest de 1,75 sobre un relleno papel y UN acento coral, con el arco
 * de la marca donde tiene sentido (la estadía en el calendario, el globo de la
 * confirmación, el llavero de apart).
 *
 * El trazo toma `currentColor`; el relleno y el acento se pueden cambiar con
 * las variables `--apart-icon-fill` y `--apart-icon-accent` del contenedor.
 * Decorativos: el texto de al lado dice qué son.
 */
export type ApartIcon = (props: { className?: string }) => ReactNode;

const FILL: CSSProperties = { fill: "var(--apart-icon-fill, var(--color-paper))" };
const ACCENT: CSSProperties = { fill: "var(--apart-icon-accent, var(--color-coral-500))" };
const ACCENT_STROKE: CSSProperties = { stroke: "var(--apart-icon-accent, var(--color-coral-500))" };

function Base({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={cn("size-6 shrink-0", className)}
    >
      {children}
    </svg>
  );
}

/** Pedís tus fechas: el arco de la estadía sobre el calendario. */
export const IconFechas: ApartIcon = ({ className }) => (
  <Base className={className}>
    <rect x="4.5" y="7" width="23" height="20.5" rx="3.5" style={FILL} />
    <path d="M4.5 12.6h23M10.5 4.6v4.6M21.5 4.6v4.6" />
    <path d="M10.5 24.2v-3.4a5.5 5.5 0 0 1 11 0v3.4" />
    <circle cx="21.5" cy="24.2" r="2.1" stroke="none" style={ACCENT} />
  </Base>
);

/** Te confirmamos: el globo con la forma del arco y el tilde. */
export const IconConfirma: ApartIcon = ({ className }) => (
  <Base className={className}>
    <path d="M6.5 28V14.5a9.5 9.5 0 0 1 19 0V20a4 4 0 0 1-4 4H11.5z" style={FILL} />
    <path d="M11.6 15.6l3.1 3.1 5.8-6" strokeWidth={2.1} style={ACCENT_STROKE} />
  </Base>
);

/** Señás una noche: dos monedas y la luna. */
export const IconSena: ApartIcon = ({ className }) => (
  <Base className={className}>
    <circle cx="12.5" cy="19.5" r="8.5" style={FILL} />
    <circle cx="19.5" cy="14.5" r="9" style={FILL} />
    <path d="M18 10.54A4.9 4.9 0 1 0 23.35 16.59A4.1 4.1 0 0 1 18 10.54z" stroke="none" style={ACCENT} />
  </Base>
);

/** El resto, al llegar: el llavero en arco de apart con su llave. */
export const IconLlegada: ApartIcon = ({ className }) => (
  <Base className={className}>
    <path d="M3.8 29V16.6a6 6 0 0 1 12 0V29z" style={FILL} />
    <circle cx="9.8" cy="15.9" r="1.6" />
    <circle cx="9.8" cy="24.2" r="2.2" stroke="none" style={ACCENT} />
    <path d="M11.2 14.5c1.1-3.5 3.4-5.1 6-4.9" />
    <circle cx="21.4" cy="10.4" r="4.3" style={FILL} />
    <circle cx="21.4" cy="10.4" r="1.1" />
    <path d="M24.4 13.4l4.9 4.9M26.7 15.7l-1.6 1.6M28.2 17.2l-1.5 1.5" />
  </Base>
);

/** Estadías por mes: hojas de calendario apiladas. */
export const IconPorMes: ApartIcon = ({ className }) => (
  <Base className={className}>
    <path d="M9.5 6.5h15a3 3 0 0 1 3 3v14" />
    <rect x="4.5" y="9.5" width="20" height="18" rx="3.2" style={FILL} />
    <path d="M4.5 14.6h20" />
    <path d="M9.6 19.3h.01M14.5 19.3h.01M19.4 19.3h.01M9.6 23.3h.01M14.5 23.3h.01" strokeWidth={2.3} />
    <circle cx="19.4" cy="23.3" r="2" stroke="none" style={ACCENT} />
  </Base>
);

/** Cancelaciones: el arco con la flecha de vuelta. */
export const IconCancelar: ApartIcon = ({ className }) => (
  <Base className={className}>
    <path d="M5.5 28V15.5a10.5 10.5 0 0 1 21 0V28z" style={FILL} />
    <path d="M12.4 17.4h6.4a3.6 3.6 0 0 1 0 7.2h-4.4" style={ACCENT_STROKE} strokeWidth={2.1} />
    <path d="M15.1 14.7l-2.7 2.7 2.7 2.7" style={ACCENT_STROKE} strokeWidth={2.1} />
  </Base>
);

/** Trabajo: la notebook y el mate. */
export const IconTrabajo: ApartIcon = ({ className }) => (
  <Base className={className}>
    <rect x="3.5" y="8" width="18.5" height="12.5" rx="1.8" style={FILL} />
    <path d="M1.8 23.3h21.9l-1.5 2.4H3.3z" style={FILL} />
    <path d="M10 17.6v-2.2a2.75 2.75 0 0 1 5.5 0v2.2" />
    <path d="M24.2 15.6h5.6v2.1c0 3.7-1.3 7.9-2.8 7.9s-2.8-4.2-2.8-7.9z" style={ACCENT} />
    <path d="M28 15.4l1.7-6.6" />
  </Base>
);

/** Estudio: el libro abierto con el señalador. */
export const IconEstudio: ApartIcon = ({ className }) => (
  <Base className={className}>
    <path
      d="M16 9.8C12.6 7.6 8.2 7.2 3.8 8.2v16.4c4.4-1 8.8-.6 12.2 1.6 3.4-2.2 7.8-2.6 12.2-1.6V8.2c-4.4-1-8.8-.6-12.2 1.6z"
      style={FILL}
    />
    <path d="M16 9.8v16.4" />
    <path d="M21.5 8.4v8.2l2-1.6 2 1.6V8.6" style={ACCENT} />
  </Base>
);

/** Salud: el corazón con una curita. */
export const IconSalud: ApartIcon = ({ className }) => (
  <Base className={className}>
    <path d="M16 27.6S4.4 20.7 4.4 12.9A6 6 0 0 1 16 9.8a6 6 0 0 1 11.6 3.1c0 7.8-11.6 14.7-11.6 14.7z" style={FILL} />
    <g transform="rotate(-38 16 17.4)">
      <rect x="7.6" y="14.1" width="16.8" height="6.6" rx="3.3" style={ACCENT} />
      <rect x="13.4" y="15.4" width="5.2" height="4" rx="1" stroke="none" style={FILL} />
    </g>
  </Base>
);
