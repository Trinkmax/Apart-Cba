import { Moon, GripVertical, Wallet } from "lucide-react";
import {
  BOOKING_BAR_STYLE,
  SOURCE_ACCENT,
} from "@/components/units/pms/pms-constants";
import type { BookingSource, BookingStatus } from "@/lib/types/database";
import { addDaysYmd, todayYmdInTz } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Vista previa del calendario del panel.
 *
 * No es un dibujo de la pantalla: importa `BOOKING_BAR_STYLE` y `SOURCE_ACCENT`
 * del propio PMS, así que los degradés por estado, la franja del canal de venta
 * y la geometría de la grilla son literalmente los del producto. Si mañana se
 * cambia el color de "confirmada", la landing cambia sola.
 *
 * Es un Server Component puro: cero JavaScript en el cliente. Las fechas son las
 * reales (la página revalida cada hora), porque una demo que muestra el mes
 * corriente convence y una que muestra "Enero" genérico no.
 */

const CELL = 34;
const ROW = 46;
const RAIL = 148;
/** 148 + 32 x 34 = 1236 px, que es el ancho del contenedor de la página. */
const DAYS = 32;
/** El día 8 de la ventana es hoy: se ve una semana de historia y tres por delante. */
const TODAY_INDEX = 8;

type Bar = {
  start: number;
  len: number;
  status: BookingStatus;
  source: BookingSource;
  guest: string;
  pax: number;
  /** Saldo pendiente, en miles de pesos. Se dibuja como el chip ámbar del panel. */
  due?: number;
  monthly?: boolean;
};

type Row = {
  code: string;
  name: string;
  occupancy: number;
  bars: Bar[];
};

const ROWS: Row[] = [
  {
    code: "NC-4B",
    name: "Rondeau 240",
    occupancy: 91,
    bars: [
      { start: 0, len: 5, status: "check_out", source: "airbnb", guest: "Camila Ferreyra", pax: 2 },
      { start: 5, len: 7, status: "check_in", source: "directo", guest: "Tomás Bustos", pax: 3 },
      { start: 13, len: 6, status: "confirmada", source: "booking", guest: "Malena Sosa", pax: 2, due: 148 },
      { start: 20, len: 6, status: "confirmada", source: "airbnb", guest: "Emma Lindqvist", pax: 2 },
      { start: 27, len: 5, status: "confirmada", source: "directo", guest: "Mateo Quiroga", pax: 2 },
    ],
  },
  {
    code: "NC-9A",
    name: "Chacabuco 1120",
    occupancy: 74,
    bars: [
      { start: 1, len: 5, status: "check_out", source: "booking", guest: "Julián Ceballos", pax: 4 },
      { start: 8, len: 8, status: "confirmada", source: "airbnb", guest: "Federico Ledesma", pax: 5 },
      { start: 18, len: 5, status: "pendiente", source: "whatsapp", guest: "Sofía Maidana", pax: 3 },
      { start: 25, len: 6, status: "confirmada", source: "booking", guest: "Rocío Aguirre", pax: 4 },
    ],
  },
  {
    code: "GUE-2C",
    name: "Belgrano 760",
    occupancy: 82,
    bars: [
      { start: 0, len: 9, status: "check_in", source: "airbnb", guest: "Rocío Aguirre", pax: 2 },
      { start: 9, len: 4, status: "confirmada", source: "directo", guest: "Mateo Quiroga", pax: 2 },
      { start: 14, len: 5, status: "cancelada", source: "booking", guest: "Nicolás Brizuela", pax: 2 },
      { start: 19, len: 7, status: "confirmada", source: "airbnb", guest: "Ana Clara Peralta", pax: 2, due: 96 },
      { start: 26, len: 6, status: "confirmada", source: "booking", guest: "Camila Ferreyra", pax: 2 },
    ],
  },
  {
    code: "GUE-PH",
    name: "Achával Rodríguez 340",
    occupancy: 68,
    bars: [
      { start: 2, len: 6, status: "check_out", source: "directo", guest: "Gonzalo Vitali", pax: 4 },
      { start: 10, len: 7, status: "confirmada", source: "booking", guest: "Camila Ferreyra", pax: 3 },
      { start: 21, len: 6, status: "pendiente", source: "airbnb", guest: "Tomás Bustos", pax: 4 },
    ],
  },
  {
    code: "ALB-5D",
    name: "Duarte Quirós 1345",
    occupancy: 100,
    bars: [
      { start: 0, len: DAYS, status: "check_in", source: "directo", guest: "Julián Ceballos", pax: 2, monthly: true },
    ],
  },
  {
    code: "VBEL-DX",
    name: "Recta Martinoli 5820",
    occupancy: 63,
    bars: [
      { start: 3, len: 7, status: "check_out", source: "airbnb", guest: "Malena Sosa", pax: 6 },
      { start: 12, len: 5, status: "confirmada", source: "whatsapp", guest: "Rocío Aguirre", pax: 5 },
      { start: 18, len: 9, status: "confirmada", source: "booking", guest: "Emma Lindqvist", pax: 6, due: 312 },
    ],
  },
];

const TOTAL_BARS = ROWS.reduce((acc, r) => acc + r.bars.length, 0);

const WEEKDAYS = ["D", "L", "M", "M", "J", "V", "S"] as const;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

function buildDays() {
  const start = addDaysYmd(todayYmdInTz(), -TODAY_INDEX);
  return Array.from({ length: DAYS }, (_, i) => {
    const ymd = addDaysYmd(start, i);
    const [y, m, d] = ymd.split("-").map(Number);
    // Mediodía UTC para que el día de la semana no se corra por el huso.
    const weekday = new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay();
    return { day: d!, month: MONTHS[m! - 1]!, weekday, isWeekend: weekday === 0 || weekday === 6 };
  });
}

export function PmsPreview() {
  const days = buildDays();
  const boardWidth = RAIL + DAYS * CELL;
  const first = days[0]!;
  const last = days[DAYS - 1]!;
  const monthLabel =
    first.month === last.month
      ? `${first.day} al ${last.day} de ${first.month}`
      : `${first.day} de ${first.month} al ${last.day} de ${last.month}`;

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-[0_30px_90px_-40px_rgba(20,30,20,0.35)]">
      {/* Barra de herramientas, recortada a lo esencial */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold tracking-tight">Calendario</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {ROWS.length} unidades · {TOTAL_BARS} reservas en pantalla
          </span>
        </div>
        <span className="ml-auto hidden text-[11px] tabular-nums text-muted-foreground sm:block">
          {monthLabel}
        </span>
      </div>

      {/* Contenedor con scroll propio: la grilla nunca empuja el ancho de la página */}
      <div className="overflow-x-auto no-scrollbar">
        <div style={{ width: boardWidth }} className="min-w-full">
          {/* Encabezado de días */}
          <div className="flex border-b border-border bg-background">
            <div style={{ width: RAIL }} className="shrink-0 border-r border-border" />
            {days.map((d, i) => (
              <div
                key={i}
                style={{ width: CELL }}
                className={cn(
                  "shrink-0 flex flex-col items-center justify-center gap-0.5 border-r border-border/60 py-1.5",
                  d.isWeekend && "bg-amber-500/[0.04]"
                )}
              >
                <span className="text-[9px] uppercase text-muted-foreground">{WEEKDAYS[d.weekday]}</span>
                {i === TODAY_INDEX ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-[10px] font-bold text-white shadow-[0_2px_8px_-1px_rgba(249,115,22,0.6)] ring-2 ring-orange-500/25">
                    {d.day}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium tabular-nums text-foreground/80">{d.day}</span>
                )}
              </div>
            ))}
          </div>

          {/* Filas */}
          {ROWS.map((row, rowIdx) => (
            <div
              key={row.code}
              style={{ height: ROW }}
              className={cn(
                "relative flex border-b border-border/70",
                rowIdx % 2 === 1 && "bg-muted/25"
              )}
            >
              <div
                style={{ width: RAIL }}
                className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-border bg-card px-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px] font-semibold">
                    {row.code}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">{row.name}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[9px] font-semibold tabular-nums text-muted-foreground">
                    {row.occupancy}%
                  </span>
                  <div className="h-1 w-8 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        row.occupancy >= 70 ? "bg-emerald-500" : "bg-amber-500"
                      )}
                      style={{ width: `${row.occupancy}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Grilla de celdas: una sola capa pintada con background-image,
                  igual que el panel. Nada de un div por celda. */}
              <div
                className="relative flex-1"
                style={{
                  backgroundImage: `linear-gradient(90deg, transparent 0 ${CELL - 1}px, var(--border) ${CELL - 1}px ${CELL}px)`,
                  backgroundSize: `${CELL}px 100%`,
                }}
              >
                {row.bars.map((bar, i) => (
                  <BookingBar key={i} bar={bar} index={rowIdx * 4 + i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Leyenda: la misma del panel, es lo que hace legible la grilla de un vistazo */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-[10px] text-muted-foreground">
        {(["confirmada", "check_in", "pendiente", "check_out"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-5 rounded-sm"
              style={{
                backgroundImage: `linear-gradient(to right, ${BOOKING_BAR_STYLE[s].hex}, ${BOOKING_BAR_STYLE[s].hex}CC)`,
              }}
            />
            {BOOKING_BAR_STYLE[s].label}
          </span>
        ))}
        <span className="ml-auto hidden items-center gap-3 md:flex">
          {(["airbnb", "booking", "directo"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-[3px] rounded-full"
                style={{ backgroundColor: SOURCE_ACCENT[s] }}
              />
              {s === "directo" ? "Directo" : s === "airbnb" ? "Airbnb" : "Booking"}
            </span>
          ))}
        </span>
      </div>
    </Card>
  );
}

function BookingBar({ bar, index }: { bar: Bar; index: number }) {
  const style = BOOKING_BAR_STYLE[bar.status];
  const source = SOURCE_ACCENT[bar.source];

  return (
    <div
      className={cn(
        "absolute flex items-stretch overflow-hidden rounded-md border bg-gradient-to-r shadow-sm",
        "animate-fade-up opacity-0",
        "transition-transform duration-150 hover:-translate-y-px hover:shadow-md",
        style.gradient,
        style.border,
        bar.status === "cancelada" && "opacity-55"
      )}
      style={{
        top: ROW * 0.15,
        height: ROW * 0.7,
        left: bar.start * CELL + 2,
        width: bar.len * CELL - 4,
        animationDelay: `${240 + index * 45}ms`,
      }}
    >
      {/* Contrato mensual: rayado vertical POR ENCIMA del degradé, no en lugar de
          él. Si se pinta como background-image, pisa el gradiente de Tailwind y
          la barra queda hueca. */}
      {bar.monthly && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent 0 17px, rgba(255,255,255,0.28) 17px 19px)",
          }}
        />
      )}
      <div
        className="relative z-10 w-[3px] shrink-0"
        style={{ backgroundColor: source, boxShadow: `0 0 6px ${source}` }}
      />
      <div
        className={cn("relative z-10 flex min-w-0 flex-1 items-center gap-1.5 px-2", style.text)}
      >
        <GripVertical size={10} className="hidden shrink-0 opacity-40 sm:block" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1 truncate text-[11px] font-semibold">
            {bar.monthly && (
              <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-violet-900/70 text-[8px] font-bold tracking-tighter text-violet-100 ring-1 ring-violet-400/40">
                M
              </span>
            )}
            {bar.guest}
          </div>
          {bar.len > 3 && (
            <div className="flex items-center gap-1.5 truncate text-[9px] opacity-90">
              <span className="flex items-center gap-0.5">
                <Moon size={8} /> {bar.len}n
              </span>
              <span>·</span>
              <span>{bar.pax}p</span>
            </div>
          )}
        </div>
        {bar.due && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-amber-400 px-1 py-px text-[9px] font-bold tabular-nums text-amber-950 shadow-sm ring-1 ring-amber-200/40">
            <Wallet size={9} strokeWidth={2.5} />
            {bar.due}k
          </span>
        )}
      </div>
    </div>
  );
}
