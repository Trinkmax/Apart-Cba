import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { BOOKING_BAR_STYLE } from "@/components/units/pms/pms-constants";
import { OtaLogo } from "@/components/marketing/ota-logo";
import { CalendarVisual } from "@/components/marketing/calendar-visual";
import { ModulesCarousel, type ModuleSlide } from "@/components/marketing/modules-carousel";
import { MODULE_PHOTOS, type ModulePhoto } from "@/lib/marketing/module-photos";
import { cn } from "@/lib/utils";

/**
 * Sección de módulos. Server Component: arma los slides; el carrusel en sí es
 * cliente porque necesita el scroll y los indicadores.
 *
 * Cada slide combina las dos cosas que hay que decir: arriba, la escena de la
 * que habla el módulo (el cobro, la limpieza, la liquidación con el dueño) y
 * abajo, una muestra de datos que prueba qué hace el sistema con eso.
 *
 * Calendario es la excepción: en vez de una foto va la grilla misma del panel
 * (`CalendarVisual`), que es la pantalla que vende el producto. La leyenda de
 * estados que lleva abajo sirve justo para leerla.
 */

const SLIDES: ModuleSlide[] = [
  {
    key: "calendario",
    title: "Calendario",
    media: <CalendarVisual />,
    body: "Arrastrás una reserva para cambiarle la fecha o pasarla de departamento. Antes de soltarla te muestra qué toca: solapamientos, la limpieza agendada y el saldo del huésped.",
    sample: <StatusLegend />,
  },
  {
    key: "canales",
    title: "Canales de venta",
    media: <Photo photo={MODULE_PHOTOS.canales} />,
    body: "Airbnb y Booking sincronizados por iCal, más las confirmaciones que reenviás por mail.",
    sample: <ChannelsSample />,
  },
  {
    key: "caja",
    title: "Caja",
    media: <Photo photo={MODULE_PHOTOS.caja} />,
    body: "Ingresos y gastos por cuenta y por moneda, cada uno atado a su reserva, su ticket o su liquidación.",
    sample: <CashSample />,
  },
  {
    key: "liquidaciones",
    title: "Liquidaciones",
    media: <Photo photo={MODULE_PHOTOS.liquidaciones} />,
    body: "El detalle mensual de cada propietario, listo para mandar en PDF, Excel o link.",
    sample: <SettlementSample />,
  },
  {
    key: "servicio",
    title: "Limpieza y mantenimiento",
    media: <Photo photo={MODULE_PHOTOS.servicio} />,
    body: "Tareas asignadas al equipo, con fotos cargadas desde el celular del que las hace.",
    sample: <TasksSample />,
  },
  {
    key: "parte",
    title: "Parte diario",
    media: <Photo photo={MODULE_PHOTOS.parte} />,
    body: "El resumen de entradas, salidas y pendientes del día, listo cada noche.",
    sample: <ReportSample />,
  },
];

export function ModulesSection() {
  return <ModulesCarousel slides={SLIDES} />;
}

function Photo({ photo }: { photo: ModulePhoto }) {
  return (
    <Image
      src={photo.url}
      alt={photo.alt}
      fill
      sizes="(max-width: 768px) 84vw, (max-width: 1024px) 50vw, 33vw"
      className="object-cover"
    />
  );
}

// ─────────────────────────── Muestras de datos ───────────────────────────

function SampleSurface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-background p-3", className)}>
      {children}
    </div>
  );
}

/** La misma leyenda que dibuja el tablero, con los colores de BOOKING_BAR_STYLE. */
function StatusLegend() {
  const statuses = ["confirmada", "check_in", "pendiente", "check_out", "cancelada"] as const;

  return (
    <SampleSurface className="flex flex-wrap gap-x-4 gap-y-2">
      {statuses.map((s) => (
        <span key={s} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="inline-block h-2 w-5 rounded-sm"
            style={{
              backgroundImage: `linear-gradient(to right, ${BOOKING_BAR_STYLE[s].hex}, ${BOOKING_BAR_STYLE[s].hex}CC)`,
            }}
          />
          {BOOKING_BAR_STYLE[s].label}
        </span>
      ))}
    </SampleSurface>
  );
}

function ChannelsSample() {
  return (
    <div className="flex flex-col gap-2">
      <SampleSurface className="flex items-center gap-2.5 px-3 py-2.5">
        <OtaLogo brand="airbnb" size={18} />
        <span className="text-[13px] font-medium">Airbnb</span>
        <span className="ml-auto text-xs text-muted-foreground">12 unidades</span>
      </SampleSurface>
      <SampleSurface className="flex items-center gap-2.5 px-3 py-2.5">
        <OtaLogo brand="booking" size={18} />
        <span className="text-[13px] font-medium">Booking.com</span>
        <span className="ml-auto text-xs text-muted-foreground">9 unidades</span>
      </SampleSurface>
    </div>
  );
}

function CashSample() {
  const accounts = [
    { name: "Caja chica", amount: "$ 486.300" },
    { name: "Cuenta bancaria", amount: "$ 7.912.450" },
  ];

  return (
    <SampleSurface>
      {accounts.map((a, i) => (
        <div
          key={a.name}
          className={cn(
            "flex items-baseline justify-between py-2",
            i > 0 && "border-t border-border"
          )}
        >
          <span className="text-xs text-muted-foreground">{a.name}</span>
          <span className="font-mono text-[13px] font-semibold tabular-nums">{a.amount}</span>
        </div>
      ))}
    </SampleSurface>
  );
}

function SettlementSample() {
  return (
    <SampleSurface>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Silvana Recalde</span>
        <span className="text-[10px] text-muted-foreground">3 unidades</span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between border-t border-border pt-2.5">
        <span className="text-xs text-muted-foreground">A pagar</span>
        <span className="font-mono text-[15px] font-semibold tabular-nums text-primary">
          $ 2.003.300
        </span>
      </div>
    </SampleSurface>
  );
}

function TasksSample() {
  return (
    <div className="flex flex-col gap-2">
      <SampleSurface className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="font-mono text-[10px] text-muted-foreground">GUE-2C</span>
        <span className="text-xs">Limpieza de salida</span>
        <Badge variant="secondary" className="ml-auto text-cyan-700">
          Hoy 11:00
        </Badge>
      </SampleSurface>
      <SampleSurface className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="font-mono text-[10px] text-muted-foreground">COF-3A</span>
        <span className="text-xs">Termotanque</span>
        <Badge variant="destructive" className="ml-auto">
          Urgente
        </Badge>
      </SampleSurface>
    </div>
  );
}

function ReportSample() {
  return (
    <SampleSurface>
      <div className="flex flex-col gap-1.5 text-xs">
        {[
          ["Check-in", "3"],
          ["Check-out", "2"],
          ["Limpiezas pendientes", "1"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </SampleSurface>
  );
}
