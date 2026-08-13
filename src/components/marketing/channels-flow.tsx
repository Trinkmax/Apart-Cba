import { CalendarDays, ChevronDown, ChevronRight, Mail, ShieldAlert } from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";
import { Card } from "@/components/ui/card";
import { OtaLogo, type OtaBrand } from "@/components/marketing/ota-logo";
import { cn } from "@/lib/utils";

/**
 * Canales de venta, dibujado como diagrama de flujo real: tres orígenes que
 * convergen en rentOS y dos salidas que se bifurcan.
 *
 * La alineación de las uniones no se estima, se deriva de la grilla. El diagrama
 * de desktop usa `grid-rows-6` sin gap vertical: cada origen ocupa 2 filas (sus
 * centros caen exactos en 1/6, 3/6 y 5/6) y cada salida ocupa 3 (centros en 1/4
 * y 3/4). Las líneas se posicionan con esos mismos porcentajes, así que quedan
 * clavadas sin importar cuánto crezcan las tarjetas. El aire entre tarjetas se
 * hace con margin interno, no con gap, justamente para no correr los centros.
 *
 * En mobile la grilla no sirve: se apila en una columna con una espina vertical
 * y chevrons, que es la misma idea leída de arriba hacia abajo.
 */

const SOURCES: readonly { label: string; detail: string; brand?: OtaBrand }[] = [
  { label: "Airbnb", detail: "calendario iCal", brand: "airbnb" },
  { label: "Booking.com", detail: "calendario iCal", brand: "booking" },
  { label: "Mail de confirmación", detail: "lo reenviás y se carga solo" },
];

/** Centros verticales exactos que impone la grilla de 6 filas. */
const IN_STOPS = ["16.6667%", "50%", "83.3333%"] as const;
const OUT_STOPS = ["25%", "75%"] as const;

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

      <Reveal delay={120} className="mt-10 md:mt-14">
        <DiagramDesktop />
        <DiagramMobile />
      </Reveal>
    </div>
  );
}

// ─────────────────────────────── Desktop ───────────────────────────────

function DiagramDesktop() {
  return (
    <div className="hidden grid-cols-[minmax(0,1fr)_72px_minmax(0,0.85fr)_72px_minmax(0,1fr)] grid-rows-6 lg:grid">
      {SOURCES.map((s) => (
        <div key={s.label} className="row-span-2 flex items-center py-1.5">
          <SourceCard source={s} />
        </div>
      ))}

      <JoinConnector />

      <div className="col-start-3 row-span-6 row-start-1 flex items-center">
        <HubCard />
      </div>

      <SplitConnector />

      <div className="col-start-5 row-span-3 row-start-1 flex items-center py-1.5">
        <OutcomeCard kind="calendar" />
      </div>
      <div className="col-start-5 row-span-3 row-start-4 flex items-center py-1.5">
        <OutcomeCard kind="issue" />
      </div>
    </div>
  );
}

/** Tres entradas → tronco vertical → una salida hacia el hub. */
function JoinConnector() {
  return (
    <div className="relative col-start-2 row-span-6 row-start-1" aria-hidden>
      {IN_STOPS.map((top) => (
        <span
          key={top}
          className="absolute left-0 h-px w-1/2 bg-border"
          style={{ top }}
        />
      ))}
      <span
        className="absolute left-1/2 w-px bg-border"
        style={{ top: IN_STOPS[0], bottom: IN_STOPS[0] }}
      />
      <span className="absolute left-1/2 right-3 h-px bg-border" style={{ top: "50%" }} />
      <ChevronRight
        size={14}
        className="absolute right-0 -translate-y-1/2 text-muted-foreground/60"
        style={{ top: "50%" }}
      />
    </div>
  );
}

/** Una entrada desde el hub → tronco vertical → dos salidas. */
function SplitConnector() {
  return (
    <div className="relative col-start-4 row-span-6 row-start-1" aria-hidden>
      <span className="absolute left-0 w-1/2 h-px bg-border" style={{ top: "50%" }} />
      <span
        className="absolute left-1/2 w-px bg-border"
        style={{ top: OUT_STOPS[0], bottom: OUT_STOPS[0] }}
      />
      {OUT_STOPS.map((top) => (
        <span key={top} className="absolute left-1/2 right-3 h-px bg-border" style={{ top }} />
      ))}
      {OUT_STOPS.map((top) => (
        <ChevronRight
          key={top}
          size={14}
          className="absolute right-0 -translate-y-1/2 text-muted-foreground/60"
          style={{ top }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────── Mobile ───────────────────────────────

function DiagramMobile() {
  return (
    <div className="flex flex-col lg:hidden">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Entra por
      </p>
      <div className="flex flex-col gap-2.5">
        {SOURCES.map((s) => (
          <SourceCard key={s.label} source={s} />
        ))}
      </div>

      <Spine />
      <HubCard />
      <Spine />

      <div className="flex flex-col gap-2.5">
        <OutcomeCard kind="calendar" />
        <OutcomeCard kind="issue" />
      </div>
    </div>
  );
}

/** Espina vertical con chevron: la misma unión del desktop, girada 90°. */
function Spine() {
  return (
    <div className="flex flex-col items-center py-3" aria-hidden>
      <span className="h-6 w-px bg-border" />
      <ChevronDown size={14} className="-mt-1 text-muted-foreground/60" />
    </div>
  );
}

// ─────────────────────────────── Piezas ───────────────────────────────

function SourceCard({ source }: { source: (typeof SOURCES)[number] }) {
  return (
    <Card className="w-full flex-row items-center gap-3 px-4 py-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] ring-1 ring-border">
        {source.brand ? (
          <OtaLogo brand={source.brand} size={18} />
        ) : (
          <Mail size={16} className="text-primary" />
        )}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{source.label}</div>
        <div className="truncate text-xs text-muted-foreground">{source.detail}</div>
      </div>
    </Card>
  );
}

function HubCard() {
  return (
    <Card className="w-full border-primary/30 bg-primary/[0.06] px-5 py-6 text-center">
      <div className="font-semibold">rentOS</div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        Reconoce la reserva por su identificador, no por el nombre. La misma reserva que llega
        dos veces no se duplica.
      </p>
    </Card>
  );
}

function OutcomeCard({ kind }: { kind: "calendar" | "issue" }) {
  const isIssue = kind === "issue";
  const Icon = isIssue ? ShieldAlert : CalendarDays;

  return (
    <Card
      className={cn(
        "w-full flex-row items-start gap-3 px-4 py-3.5",
        isIssue && "border-amber-500/30 bg-amber-50"
      )}
    >
      <Icon
        size={16}
        className={cn("mt-0.5 shrink-0", isIssue ? "text-amber-600" : "text-primary")}
      />
      <div>
        <div className={cn("text-sm font-medium", isIssue && "text-amber-900")}>
          {isIssue ? "Incidencia si se superpone" : "Calendario actualizado"}
        </div>
        <div
          className={cn(
            "text-xs leading-relaxed",
            isIssue ? "text-amber-800/70" : "text-muted-foreground"
          )}
        >
          {isIssue
            ? "Tu reserva queda intacta y vos decidís cuál vale."
            : "Con la unidad, las fechas y el canal de origen."}
        </div>
      </div>
    </Card>
  );
}
