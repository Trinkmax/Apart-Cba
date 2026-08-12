import { ArrowDown, ArrowRight, CalendarDays, Mail, ShieldAlert } from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";
import { Card } from "@/components/ui/card";
import { OtaLogo, type OtaBrand } from "@/components/marketing/ota-logo";

/**
 * Canales de venta. El dolor concreto es el doble booking, así que la sección no
 * vende "sincronización": vende qué pasa cuando dos reservas chocan.
 *
 * El flujo se dibuja horizontal en desktop y vertical en mobile, con las flechas
 * cambiando de eje. Nada de posicionamiento absoluto: es una grilla.
 */

const SOURCES: readonly {
  label: string;
  detail: string;
  brand?: OtaBrand;
}[] = [
  { label: "Airbnb", detail: "calendario iCal", brand: "airbnb" },
  { label: "Booking.com", detail: "calendario iCal", brand: "booking" },
  { label: "Mail de confirmación", detail: "lo reenviás y se carga solo" },
];

export function ChannelsFlow() {
  return (
    <div>
      <Reveal className="max-w-[46ch]">
        <h2 className="text-[30px] font-semibold leading-[1.12] tracking-tight md:text-[40px]">
          Airbnb y Booking entran solos. Si hay conflicto, te avisa.
        </h2>
        <p className="mt-5 leading-relaxed text-muted-foreground">
          Las reservas de las OTA llegan al mismo calendario que las tuyas. Cuando una choca
          con una reserva que ya tenías, rentOS abre una incidencia en vez de pisarte nada.
        </p>
      </Reveal>

      <Reveal delay={120} className="mt-12">
        <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.8fr)_auto_minmax(0,1fr)]">
          <div className="flex flex-col gap-2.5">
            {SOURCES.map((s) => (
              <Card key={s.label} className="flex-row items-center gap-3 px-4 py-3.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] ring-1 ring-border">
                  {s.brand ? (
                    <OtaLogo brand={s.brand} size={18} />
                  ) : (
                    <Mail size={16} className="text-primary" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.detail}</div>
                </div>
              </Card>
            ))}
          </div>

          <Connector />

          <Card className="border-primary/25 bg-primary/[0.07] px-5 py-6 text-center">
            <div className="font-semibold">rentOS</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Reconoce la reserva por su identificador, no por el nombre. La misma reserva que
              llega dos veces no se duplica.
            </p>
          </Card>

          <Connector />

          <div className="flex flex-col gap-2.5">
            <Card className="flex-row items-start gap-3 px-4 py-3">
              <CalendarDays size={16} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-medium">Calendario actualizado</div>
                <div className="text-xs leading-relaxed text-muted-foreground">
                  Con la unidad, las fechas y el canal de origen.
                </div>
              </div>
            </Card>
            <Card className="flex-row items-start gap-3 border-amber-500/30 bg-amber-50 px-4 py-3">
              <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <div className="text-sm font-medium text-amber-900">
                  Incidencia si se superpone
                </div>
                <div className="text-xs leading-relaxed text-amber-800/70">
                  Tu reserva queda intacta y vos decidís cuál vale.
                </div>
              </div>
            </Card>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/** Flecha del flujo: horizontal en desktop, vertical cuando la grilla se apila. */
function Connector() {
  return (
    <div className="flex items-center justify-center py-1 text-muted-foreground/50">
      <ArrowDown size={18} className="lg:hidden" />
      <ArrowRight size={18} className="hidden lg:block" />
    </div>
  );
}
