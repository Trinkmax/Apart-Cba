import { BOOKING_BAR_STYLE, SOURCE_ACCENT } from "@/components/units/pms/pms-constants";
import type { BookingSource, BookingStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";

/**
 * Miniatura del calendario del panel, para la tarjeta "Calendario" del carrusel.
 *
 * Es el único módulo que se ilustra con la pantalla en vez de con una foto: el
 * calendario ES la imagen del producto, y una foto de una agenda de papel diría
 * justo lo contrario de lo que vende la landing.
 *
 * Igual que `PmsPreview`, los colores salen de `BOOKING_BAR_STYLE` y la franja
 * del canal de `SOURCE_ACCENT` — son los del panel, no una copia. La leyenda que
 * va abajo de la tarjeta usa los mismos, así que funciona como referencia de
 * esta grilla.
 *
 * Todo el layout es en porcentajes (nada de píxeles fijos): la tarjeta mide
 * ~84vw en mobile y un tercio de 1240px en desktop, y la grilla tiene que
 * quedar igual de proporcionada en los dos.
 */

const DAYS = 14;
/** El día 4 de la ventana es "hoy": marca la línea naranja del panel. */
const TODAY = 4;

type Bar = {
  start: number;
  len: number;
  status: BookingStatus;
  source: BookingSource;
  guest?: string;
  /** Reserva que se está arrastrando: anillo + hueco punteado de dónde salió. */
  dragging?: boolean;
};

const ROWS: { code: string; bars: Bar[] }[] = [
  {
    code: "NC-4B",
    bars: [
      { start: 0, len: 3, status: "check_out", source: "airbnb" },
      { start: 3, len: 5, status: "check_in", source: "directo", guest: "Tomás B." },
      { start: 9, len: 4, status: "confirmada", source: "booking", guest: "Malena S." },
    ],
  },
  {
    code: "NC-9A",
    bars: [
      { start: 1, len: 4, status: "check_out", source: "booking" },
      { start: 6, len: 6, status: "confirmada", source: "airbnb", guest: "Federico L." },
    ],
  },
  {
    code: "GUE-2C",
    bars: [
      { start: 0, len: 5, status: "check_in", source: "airbnb", guest: "Ana Clara P." },
      {
        start: 7,
        len: 5,
        status: "confirmada",
        source: "directo",
        guest: "Mateo Q.",
        dragging: true,
      },
    ],
  },
  {
    code: "GUE-PH",
    bars: [
      { start: 2, len: 4, status: "pendiente", source: "airbnb" },
      { start: 8, len: 5, status: "confirmada", source: "booking", guest: "Camila F." },
    ],
  },
  {
    code: "ALB-5D",
    bars: [{ start: 0, len: DAYS, status: "check_in", source: "directo", guest: "Julián C." }],
  },
];

export function CalendarVisual() {
  return (
    <div className="absolute inset-0 bg-secondary/60">
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "12px 12px",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 -top-20 h-44 opacity-40 blur-2xl"
        style={{
          background: "radial-gradient(55% 60% at 50% 50%, var(--primary), transparent 70%)",
        }}
      />

      {/* La ventana flota sobre el fondo y termina ANTES del pie del marco: ahí
          abajo va el degradé con el título de la tarjeta, y si la grilla llegara
          hasta el borde le quedaría la última fila apagada. Adentro todo reparte
          con flex-1, así que llena el alto disponible sea cual sea el ancho de
          la tarjeta. */}
      <div className="absolute inset-x-4 bottom-14 top-5 overflow-hidden rounded-lg border border-border bg-card shadow-[0_18px_44px_-26px_rgba(20,30,20,0.55)]">
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
            <span className="text-[10px] font-semibold tracking-tight">Calendario</span>
            <span className="ml-auto text-[9px] text-muted-foreground">5 unidades</span>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Riel de unidades */}
            <div className="flex w-[52px] shrink-0 flex-col border-r border-border">
              <div className="h-4 shrink-0 border-b border-border/60" />
              {ROWS.map((r) => (
                <div
                  key={r.code}
                  className="flex min-h-0 flex-1 items-center border-b border-border/60 px-1.5"
                >
                  <span className="truncate font-mono text-[8px] font-semibold text-foreground/75">
                    {r.code}
                  </span>
                </div>
              ))}
            </div>

            {/* Grilla: las columnas se pintan con un solo background repetido,
                igual que en el panel. Nada de un div por celda. */}
            <div
              className="relative flex min-w-0 flex-1 flex-col"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--border) 0 1px, transparent 1px 100%)",
                backgroundSize: `calc(100%/${DAYS}) 100%`,
              }}
            >
              <div className="flex h-4 shrink-0 border-b border-border/60">
                {Array.from({ length: DAYS }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "flex flex-1 items-center justify-center text-[7px] tabular-nums",
                      i === TODAY ? "font-bold text-orange-600" : "text-muted-foreground/70"
                    )}
                  >
                    {11 + i}
                  </span>
                ))}
              </div>

              <span
                aria-hidden
                className="pointer-events-none absolute bottom-0 top-4 w-px bg-orange-500/60"
                style={{ left: `calc((${TODAY} + 0.5) * 100% / ${DAYS})` }}
              />

              {ROWS.map((row) => (
                <div key={row.code} className="relative min-h-0 flex-1 border-b border-border/60">
                  {row.bars.map((bar, i) => (
                    <BookingBar key={i} bar={bar} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingBar({ bar }: { bar: Bar }) {
  const style = BOOKING_BAR_STYLE[bar.status];

  return (
    <>
      <div
        className={cn(
          "absolute inset-y-[15%] flex items-stretch overflow-hidden rounded-[3px] border bg-gradient-to-r shadow-sm",
          style.gradient,
          style.border,
          bar.dragging && "ring-2 ring-primary/45"
        )}
        style={{
          left: `calc(${bar.start} * 100% / ${DAYS} + 1px)`,
          width: `calc(${bar.len} * 100% / ${DAYS} - 2px)`,
        }}
      >
        <span
          className="w-[2px] shrink-0"
          style={{ backgroundColor: SOURCE_ACCENT[bar.source] }}
        />
        {bar.guest ? (
          <span
            className={cn(
              "flex min-w-0 flex-1 items-center px-1 text-[8px] font-semibold leading-none",
              style.text
            )}
          >
            <span className="truncate">{bar.guest}</span>
          </span>
        ) : null}
      </div>

      {/* Hueco que deja la reserva arrastrada: el panel lo marca punteado para
          que se vea de dónde salió. */}
      {bar.dragging ? (
        <div
          aria-hidden
          className="absolute inset-y-[15%] rounded-[3px] border border-dashed border-primary/45 bg-primary/5"
          style={{
            left: `calc(${bar.start - 2} * 100% / ${DAYS} + 1px)`,
            width: `calc(${bar.len} * 100% / ${DAYS} - 2px)`,
          }}
        />
      ) : null}
    </>
  );
}
