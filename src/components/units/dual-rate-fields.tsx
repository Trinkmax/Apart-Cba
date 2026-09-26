"use client";

import { useState } from "react";
import { CalendarRange, Moon, TriangleAlert, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";
import {
  compareMonthlyToNightly,
  DAYS_PER_MONTH,
  formatPriceInput,
  parsePriceInput,
  type MonthlyVsNightly,
} from "@/lib/units/pricing";
import { cn } from "@/lib/utils";

/**
 * Tarifa doble de una unidad mixta (migración 063): precio por noche y precio
 * de un mes completo, lado a lado, y abajo la cuenta que se hace el dueño al
 * ponerlos — "¿cuánto descuento doy por quedarse un mes?".
 */

/**
 * Los colores de la vocación (UNIT_DEFAULT_MODE_META): la noche lleva el de
 * temporario (sky) y el mes el de mensual (violet), así cada tarjeta dice qué
 * estadía cobra antes de leer el título. Clases literales y no el hex de
 * constants para que Tailwind las vea y tengan su variante dark.
 */
const TONO = {
  noche: {
    linea: "bg-sky-500/80",
    fondo: "bg-sky-50/50 dark:bg-sky-400/[0.04]",
    icono: "bg-sky-500/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300",
    foco: "focus-visible:border-sky-500 focus-visible:ring-sky-500/20",
  },
  mes: {
    linea: "bg-violet-600/80 dark:bg-violet-500/80",
    fondo: "bg-violet-50/50 dark:bg-violet-400/[0.04]",
    icono: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
    foco: "focus-visible:border-violet-500 focus-visible:ring-violet-500/20",
  },
} as const;

type Tono = keyof typeof TONO;

/** Descuentos que se ofrecen como atajo para armar el precio del mes. */
const DESCUENTOS = [20, 30, 40, 50] as const;

/**
 * Por encima de este ahorro el mes es sospechosamente barato. Medido en los
 * alquileres reales de mixtas, el mes sale entre 31% y 62% menos que 30
 * noches; 75% o más suele ser un cero de menos ("1.100" por "1.100.000").
 */
const AHORRO_SOSPECHOSO_PCT = 75;

/** Precio de la tarifa doble que puede quedar a medio escribir o mal escrito. */
export type RateField = "base_price" | "monthly_price";

/** Lo que llega del form: PostgREST puede haber dejado un `numeric` como string. */
function aNumero(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tres cifras significativas: 30 noches × 78.000 con 20% menos da 1.872.000 y
 * se propone 1.870.000, que es un precio que alguien pondría.
 */
function redondearLindo(n: number): number {
  if (n <= 0) return 0;
  const paso = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 2);
  return Math.round(n / paso) * paso;
}

function mesConDescuento(thirtyNights: number, pct: number): number {
  return redondearLindo(thirtyNights * (1 - pct / 100));
}

interface DualRateFieldsProps {
  /** Moneda de los dos precios (`base_price_currency`). */
  currency: string;
  nightly: number | null | undefined;
  monthly: number | null | undefined;
  onNightlyChange: (value: number | null) => void;
  onMonthlyChange: (value: number | null) => void;
  /** Error del servidor sobre el precio por mes. */
  monthlyError?: string | null;
  /**
   * Avisa si lo que hay escrito en un precio no se puede usar (ilegible, o un
   * mes en 0). El form no guarda mientras tanto: el número que tiene es el
   * último válido, no el que se ve en pantalla.
   */
  onInvalidChange?: (field: RateField, invalid: boolean) => void;
}

export function DualRateFields({
  currency,
  nightly,
  monthly,
  onNightlyChange,
  onMonthlyChange,
  monthlyError,
  onInvalidChange,
}: DualRateFieldsProps) {
  const noche = aNumero(nightly);
  const mes = aNumero(monthly);
  const comparacion = compareMonthlyToNightly(mes, noche);
  // Un descuento elegido reemplaza lo que haya escrito en "Por mes", aunque el
  // número sea el mismo que el form ya tenía (el input sólo sigue al valor
  // cuando cambia): se remonta el input para que el texto y la marca de
  // inválido, que el form limpia al elegir, digan lo mismo.
  const [elegido, setElegido] = useState(0);
  function elegirMes(value: number) {
    setElegido((k) => k + 1);
    onMonthlyChange(value);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RateCard
          tono="noche"
          icon={Moon}
          inputId="base_price"
          title="Por noche"
          caption="Estadías cortas"
          currency={currency}
        >
          <RateInput
            id="base_price"
            tono="noche"
            value={noche}
            onValueChange={onNightlyChange}
            onInvalidChange={(invalid) => onInvalidChange?.("base_price", invalid)}
            currency={currency}
            suffix="/ noche"
          />
        </RateCard>
        <RateCard
          tono="mes"
          icon={CalendarRange}
          inputId="monthly_price"
          title="Por mes"
          caption="Un mes completo"
          currency={currency}
        >
          <RateInput
            key={elegido}
            id="monthly_price"
            tono="mes"
            value={mes}
            onValueChange={onMonthlyChange}
            onInvalidChange={(invalid) => onInvalidChange?.("monthly_price", invalid)}
            currency={currency}
            suffix="/ mes"
            error={monthlyError}
            requirePositive
          />
        </RateCard>
      </div>

      {comparacion && mes != null ? (
        <Comparador
          comparacion={comparacion}
          mes={mes}
          currency={currency}
          onPick={elegirMes}
        />
      ) : (
        <SinComparacion noche={noche} mes={mes} currency={currency} onPick={elegirMes} />
      )}
    </div>
  );
}

function RateCard({
  tono,
  icon: Icon,
  inputId,
  title,
  caption,
  currency,
  children,
}: {
  tono: Tono;
  icon: LucideIcon;
  inputId: string;
  title: string;
  caption: string;
  currency: string;
  children: React.ReactNode;
}) {
  const t = TONO[tono];
  return (
    <div className={cn("relative overflow-hidden rounded-xl border p-3.5 sm:p-4", t.fondo)}>
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", t.linea)} />
      <div className="mb-3 flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn("grid size-8 shrink-0 place-items-center rounded-lg", t.icono)}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={inputId}>
            {title}
            <span className="sr-only">, en {currency}</span>
          </Label>
          <p className="text-[11px] leading-none text-muted-foreground">{caption}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * Input de importe grande (un mes ronda 1.100.000 ARS). Guarda lo que se
 * tipea como texto —para aceptar los puntos de miles— y sube el número ya
 * parseado; vacío es null. Lo que no se entiende NO sube: el form se queda con
 * el último número válido y se entera por `onInvalidChange` para no guardar
 * (subir null borraba el precio guardado con un "Unidad actualizada").
 */
function RateInput({
  id,
  tono,
  value,
  onValueChange,
  onInvalidChange,
  currency,
  suffix,
  error,
  requirePositive = false,
}: {
  id: string;
  tono: Tono;
  value: number | null;
  onValueChange: (value: number | null) => void;
  onInvalidChange: (invalid: boolean) => void;
  currency: string;
  suffix: string;
  error?: string | null;
  /** El precio por mes no puede ser 0 (CHECK units_monthly_price_positive). */
  requirePositive?: boolean;
}) {
  const [draft, setDraft] = useState(() => formatPriceInput(value));
  // Último número que salió de este input. Si el del form es otro, cambió
  // desde afuera (un descuento sugerido, el reset tras crear) y el texto lo
  // sigue. Estado derivado en render, no en un efecto.
  const [emitido, setEmitido] = useState(value);
  if (value !== emitido) {
    setEmitido(value);
    setDraft(formatPriceInput(value));
  }

  // Mientras se tipea, un número a medio escribir ("1.100.0") no se marca en
  // rojo: el form igual no guarda (onInvalidChange ya avisó), pero el error se
  // muestra recién al salir del campo, cuando es un error y no un paso. Es
  // "tipeando" y no "con foco": si Guardar devuelve el foco al campo, el error
  // tiene que seguir a la vista.
  const [tipeando, setTipeando] = useState(false);

  const parsed = parsePriceInput(draft);
  const ilegible = !tipeando && draft.trim() !== "" && parsed === null;
  const enCero = !tipeando && requirePositive && parsed !== null && parsed <= 0;
  // Cómo se entendió lo tipeado, sólo si no salta a la vista: "45000" se
  // confirma como "ARS 45.000". En la misma forma en que se escribe (no la de
  // formatMoney, que para USD usa comas de miles): copiar el eco tiene que
  // dar el mismo número. Al salir del campo el texto toma esa forma y el eco
  // desaparece.
  const eco =
    parsed !== null && !(requirePositive && parsed <= 0) && draft.trim() !== formatPriceInput(parsed)
      ? `${currency} ${formatPriceInput(parsed)}`
      : null;
  const invalido = !!error || ilegible || enCero;
  const helpId = `${id}-help`;

  return (
    <div className="space-y-1">
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium tracking-wide text-muted-foreground"
        >
          {currency}
        </span>
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft}
          onChange={(e) => {
            // Sólo cifras y separadores: "$ 1.100.000" pegado de otro lado
            // entra igual.
            const limpio = e.target.value.replace(/[^\d.,]/g, "");
            const n = parsePriceInput(limpio);
            const noSirve =
              (limpio.trim() !== "" && n === null) || (requirePositive && n !== null && n <= 0);
            setDraft(limpio);
            setTipeando(true);
            onInvalidChange(noSirve);
            if (noSirve) return;
            setEmitido(n);
            onValueChange(n);
          }}
          onBlur={() => {
            setTipeando(false);
            if (parsed !== null && !(requirePositive && parsed <= 0)) setDraft(formatPriceInput(parsed));
          }}
          placeholder="0"
          aria-invalid={invalido}
          aria-describedby={helpId}
          className={cn(
            "h-11 pr-16 text-lg font-semibold tabular-nums tracking-tight md:text-lg",
            currency.length > 3 ? "pl-14" : "pl-12",
            TONO[tono].foco,
            invalido && "border-rose-500 focus-visible:border-rose-500 focus-visible:ring-rose-500/30",
          )}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
        >
          {suffix}
        </span>
      </div>
      <p
        id={helpId}
        className={cn(
          "min-h-4 text-[11px] leading-snug",
          invalido ? "text-rose-600 dark:text-rose-400" : "tabular-nums text-muted-foreground",
        )}
      >
        {error ??
          (ilegible
            ? "No se entiende el número. Escribilo como 1.100.000 o 1100000."
            : enCero
              ? "Tiene que ser mayor a 0. Si no lo querés cargar, dejalo vacío."
              : eco && `= ${eco}`)}
      </p>
    </div>
  );
}

/** Atajos "mes = 30 noches − X%", redondeados a un precio que alguien pondría. */
function DescuentosSugeridos({
  thirtyNights,
  mes,
  currency,
  onPick,
  label,
}: {
  thirtyNights: number;
  mes: number | null;
  currency: string;
  onPick: (value: number) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label="Precio por mes con descuento sobre 30 noches" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[11px] text-muted-foreground">{label}</span>
      {DESCUENTOS.map((pct) => {
        const sugerido = mesConDescuento(thirtyNights, pct);
        const monto = formatMoney(sugerido, currency);
        return (
          <button
            key={pct}
            type="button"
            data-descuento={pct}
            onClick={() => {
              onPick(sugerido);
              // Con "Por mes" vacío el chip vive en el recuadro vacío, que se
              // reemplaza por el comparador: el botón se desmonta y el foco
              // caía al diálogo. Vuelve al chip equivalente del comparador.
              requestAnimationFrame(() =>
                document.querySelector<HTMLElement>(`[data-descuento="${pct}"]`)?.focus(),
              );
            }}
            aria-pressed={mes === sugerido}
            title={`${monto} por mes`}
            className={cn(
              "h-8 rounded-full border px-3 text-xs font-medium tabular-nums transition-colors sm:h-7 sm:px-2.5",
              "hover:border-violet-400/60 hover:bg-violet-500/5 dark:hover:border-violet-500/50",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-violet-500/25",
              "aria-pressed:border-violet-500 aria-pressed:bg-violet-500/10 aria-pressed:text-violet-700 dark:aria-pressed:text-violet-300",
            )}
          >
            −{pct}%
            <span className="sr-only">: {monto} por mes</span>
          </button>
        );
      })}
    </div>
  );
}

/** Las dos barras: 30 noches sueltas contra el mes, en la misma escala. */
function Comparador({
  comparacion,
  mes,
  currency,
  onPick,
}: {
  comparacion: MonthlyVsNightly;
  mes: number;
  currency: string;
  onPick: (value: number) => void;
}) {
  const { thirtyNights, perNight, savingsPct } = comparacion;
  const parejo = Math.abs(savingsPct) < 1;
  const identico = mes === thirtyNights;
  const masCaro = !parejo && savingsPct < 0;
  // Un mes que cuesta algo nunca es "100% menos": el redondeo lo tope en 99.
  const pct = masCaro
    ? Math.round(-savingsPct)
    : Math.min(99, Math.round(savingsPct));
  const sospechoso = !masCaro && savingsPct >= AHORRO_SOSPECHOSO_PCT;

  // La escala es la barra más larga: si el mes sale más caro, la que se
  // acorta es la de las noches (dos barras llenas dirían "igual").
  const tope = Math.max(thirtyNights, mes);
  const anchoNoches = (thirtyNights / tope) * 100;
  const anchoMes = Math.max(2, (mes / tope) * 100);

  const treinta = formatMoney(thirtyNights, currency);
  const mensual = formatMoney(mes, currency);
  const porNoche = formatMoney(perNight, currency);
  const tarifa = formatMoney(thirtyNights / DAYS_PER_MONTH, currency);

  const resumen = parejo
    ? `Un mes cuesta ${mensual}, ${identico ? "lo mismo" : "casi lo mismo"} que 30 noches sueltas.`
    : masCaro
      ? `Un mes cuesta ${mensual}, un ${pct}% más que 30 noches sueltas (${treinta}).`
      : `Un mes cuesta ${mensual}, un ${pct}% menos que 30 noches sueltas (${treinta}): equivale a ${porNoche} por noche.`;

  const barra = "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none";

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3.5 sm:p-4">
      <p className="sr-only">{resumen}</p>

      <div aria-hidden className="space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium leading-snug">
            {parejo ? (
              `El mes sale ${identico ? "lo mismo" : "casi lo mismo"} que 30 noches sueltas`
            ) : (
              <>
                El mes sale{" "}
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    masCaro
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-violet-700 dark:text-violet-300",
                  )}
                >
                  {pct}% {masCaro ? "más" : "menos"}
                </span>{" "}
                que 30 noches sueltas
              </>
            )}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {parejo
              ? identico
                ? `${porNoche} por noche: no hay descuento por quedarse el mes.`
                : `≈ ${porNoche} por noche, casi sin descuento por quedarse el mes.`
              : `≈ ${porNoche} por noche, en vez de ${tarifa}.`}
          </p>
        </div>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted-foreground">30 noches sueltas</span>
              <span className="font-medium tabular-nums">{treinta}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn(barra, "bg-sky-500")} style={{ width: `${anchoNoches}%` }} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted-foreground">1 mes</span>
              <span className="font-medium tabular-nums">{mensual}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-muted">
              {/* Rayado: lo que se deja de cobrar por quedarse el mes. */}
              {!masCaro && !parejo && (
                <div
                  className="absolute inset-y-0 right-0 text-violet-500/35 transition-[left] duration-500 ease-out motion-reduce:transition-none"
                  style={{
                    left: `${anchoMes}%`,
                    backgroundImage:
                      "repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 4px)",
                  }}
                />
              )}
              <div
                className={cn(barra, "bg-violet-600 dark:bg-violet-500")}
                style={{ width: `${anchoMes}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {(masCaro || sospechoso) && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-100">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          {masCaro
            ? "El mes sale más caro que 30 noches sueltas. ¿Es lo que querés?"
            : "El mes sale menos de un cuarto de lo que salen 30 noches sueltas. ¿No te faltó un cero?"}
        </p>
      )}

      <DescuentosSugeridos
        thirtyNights={thirtyNights}
        mes={mes}
        currency={currency}
        onPick={onPick}
        label="Probá con"
      />
    </div>
  );
}

/**
 * Sin los dos precios no hay comparación: se explica para qué sirve el
 * precio por mes y, si ya está la noche, se ofrece armarlo con un descuento.
 */
function SinComparacion({
  noche,
  mes,
  currency,
  onPick,
}: {
  noche: number | null;
  mes: number | null;
  currency: string;
  onPick: (value: number) => void;
}) {
  const conNoche = noche != null && noche > 0;
  const thirtyNights = conNoche ? noche * DAYS_PER_MONTH : 0;
  const faltaNoche = mes != null && mes > 0 && !conNoche;

  return (
    <div className="flex gap-3 rounded-xl border border-dashed p-3.5 sm:p-4">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
      >
        <CalendarRange className="size-4" />
      </span>
      <div className="min-w-0 space-y-2">
        <div className="space-y-1">
          <p className="text-sm font-medium leading-snug">
            {faltaNoche ? "Falta el precio por noche" : "¿Cuánto sale quedarse un mes?"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {faltaNoche
              ? "Cargalo y acá ves cuánto sale el mes contra 30 noches sueltas."
              : conNoche
                ? `30 noches sueltas salen ${formatMoney(thirtyNights, currency)}. Cargá el precio por mes o probá con un descuento, y acá ves la diferencia.`
                : "Con los dos precios cargados, acá ves cuánto descuento das por quedarse un mes."}
          </p>
        </div>
        {conNoche && (
          <DescuentosSugeridos
            thirtyNights={thirtyNights}
            mes={mes}
            currency={currency}
            onPick={onPick}
            label="Mes con"
          />
        )}
        {!faltaNoche && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            El precio por mes completa la <strong className="font-medium text-foreground">Renta mensual</strong>{" "}
            cuando cargás una reserva mensual en esta unidad.
          </p>
        )}
      </div>
    </div>
  );
}
