import {
  Cable,
  CalendarDays,
  FileText,
  MessageSquare,
  ScrollText,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BOOKING_BAR_STYLE } from "@/components/units/pms/pms-constants";
import { OtaLogo } from "@/components/marketing/ota-logo";
import { cn } from "@/lib/utils";

/**
 * Los seis módulos del panel, en una grilla de 3x2 sin celdas vacías.
 *
 * Cada tarjeta lleva una muestra chica de datos reales del producto. El
 * calendario NO se dibuja acá: ya está arriba, con el componente que replica la
 * grilla del PMS. Repetirlo en chiquito daba una versión desfigurada de algo que
 * el visitante acaba de ver bien.
 */

export function ModulesBento() {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      <Cell
        icon={CalendarDays}
        title="Calendario"
        body="Arrastrás una reserva para cambiarle la fecha o pasarla de departamento. Antes de soltarla te muestra qué toca: solapamientos, la limpieza agendada y el saldo del huésped."
        tint="from-emerald-500/[0.07]"
        delay={0}
      >
        <StatusLegend />
      </Cell>

      <Cell
        icon={Cable}
        title="Canales de venta"
        body="Airbnb y Booking sincronizados por iCal, más las confirmaciones que reenviás por mail."
        tint="from-rose-500/[0.07]"
        delay={60}
      >
        <ChannelsSample />
      </Cell>

      <Cell
        icon={Wallet}
        title="Caja"
        body="Ingresos y gastos por cuenta y por moneda, cada uno atado a su reserva, su ticket o su liquidación."
        tint="from-teal-500/[0.06]"
        delay={120}
      >
        <CashSample />
      </Cell>

      <Cell
        icon={FileText}
        title="Liquidaciones"
        body="El detalle mensual de cada propietario, en PDF, Excel o link."
        delay={180}
      >
        <SettlementSample />
      </Cell>

      <Cell
        icon={Sparkles}
        title="Limpieza y mantenimiento"
        body="Tareas asignadas, con fotos desde el celular del que las hace."
        delay={240}
      >
        <TasksSample />
      </Cell>

      <Cell
        icon={ScrollText}
        title="Parte diario"
        body="El resumen de entradas, salidas y pendientes, listo cada noche."
        delay={300}
      >
        <ReportSample />
      </Cell>
    </div>
  );
}

function Cell({
  icon: Icon,
  title,
  body,
  children,
  tint,
  delay,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
  children: React.ReactNode;
  tint?: string;
  delay: number;
}) {
  return (
    <Reveal as="article" delay={delay}>
      <Card className="group relative h-full gap-0 overflow-hidden p-5 transition-colors duration-200 hover:border-foreground/20">
        {tint && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent",
              tint
            )}
          />
        )}
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
            <Icon size={16} />
          </span>
          <h3 className="font-semibold tracking-tight">{title}</h3>
        </div>
        <p className="relative mt-2.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {/* La muestra se ancla abajo: las tarjetas de una fila comparten alto y
            el aire queda entre el texto y el dato, no colgando al final. */}
        <div className="relative mt-auto pt-6">{children}</div>
      </Card>
    </Reveal>
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
      <SampleSurface className="flex items-center gap-2.5 px-3 py-2.5">
        <MessageSquare size={18} className="shrink-0 text-primary" />
        <span className="text-[13px] font-medium">Reserva directa</span>
        <span className="ml-auto text-xs text-muted-foreground">web y WhatsApp</span>
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
