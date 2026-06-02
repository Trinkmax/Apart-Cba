"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  Link as LinkIcon,
  Lightbulb,
  Plus,
  RefreshCw,
  Copy,
  Clock,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type Variant = "import" | "export" | "mapping";

/* ── building blocks ─────────────────────────────────────────────── */

/** Breadcrumb-style menu path, e.g. Calendario › Sincronizar › Exportar */
function Crumbs({ items, accentLast }: { items: string[]; accentLast?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
              accentLast && i === items.length - 1
                ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20"
                : "bg-muted text-foreground/75",
            )}
          >
            {it}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Chip that mimics a real button so the step maps 1:1 to the UI */
function BtnChip({
  children,
  tone = "solid",
}: {
  children: ReactNode;
  tone?: "solid" | "outline";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium align-middle leading-none",
        tone === "solid"
          ? "bg-primary text-primary-foreground"
          : "border bg-background text-foreground/80",
      )}
    >
      {children}
    </span>
  );
}

function Step({
  n,
  title,
  last,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && (
        <span
          aria-hidden
          className="absolute left-3.5 top-7 bottom-0 w-px bg-border"
        />
      )}
      <span className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
        <p className="text-sm font-medium leading-snug">{title}</p>
        <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      </div>
    </li>
  );
}

/* ── per-variant chrome ──────────────────────────────────────────── */

const META: Record<
  Variant,
  {
    border: string;
    bg: string;
    icon: typeof Download;
    iconColor: string;
    title: string;
    subtitle: string;
  }
> = {
  import: {
    border: "border-l-amber-500",
    bg: "bg-amber-500/[0.06]",
    icon: Download,
    iconColor: "text-amber-600 dark:text-amber-400",
    title: "Conectá tu calendario de Airbnb",
    subtitle: "Importá las reservas de cada anuncio con un link iCal — una vez por unidad",
  },
  export: {
    border: "border-l-sky-500",
    bg: "bg-sky-500/[0.06]",
    icon: Upload,
    iconColor: "text-sky-600 dark:text-sky-400",
    title: "Mostrá tus reservas directas en las OTAs",
    subtitle: "Bloqueá en Airbnb y Booking las fechas que ya tenés ocupadas y evitá doble-reserva",
  },
  mapping: {
    border: "border-l-violet-500",
    bg: "bg-violet-500/[0.06]",
    icon: LinkIcon,
    iconColor: "text-violet-600 dark:text-violet-400",
    title: "Mapeo de listings",
    subtitle: "Asociá cada unidad con su ID en la OTA para reconocer reservas que llegan por email",
  },
};

/* ── footer note row ─────────────────────────────────────────────── */

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/* ── component ───────────────────────────────────────────────────── */

interface Props {
  variant: Variant;
  /** Optional header-right slot (e.g. the “Mapear unidad” dialog button). */
  action?: ReactNode;
  /** Custom body — used by the mapping variant. */
  children?: ReactNode;
}

export function SyncGuide({ variant, action, children }: Props) {
  const [open, setOpen] = useState(true);
  const m = META[variant];
  const Icon = m.icon;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-xl border border-l-4 transition-colors",
          m.border,
          m.bg,
        )}
      >
        {/* header */}
        <div className="flex items-center gap-2 p-3 sm:p-4">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-3 text-left">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg bg-background/70 shadow-sm",
                m.iconColor,
              )}
            >
              <Icon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{m.title}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {m.subtitle}
              </p>
            </div>
          </CollapsibleTrigger>
          {action}
          <CollapsibleTrigger className="group grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground">
            <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            <span className="sr-only">Mostrar / ocultar guía</span>
          </CollapsibleTrigger>
        </div>

        {/* body */}
        <CollapsibleContent>
          <div className="border-t border-border/50 px-4 pt-4 pb-4">
            {variant === "import" && <ImportBody />}
            {variant === "export" && <ExportBody />}
            {variant === "mapping" && children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* ── import steps ────────────────────────────────────────────────── */

function ImportBody() {
  return (
    <>
      <ol className="space-y-0">
        <Step n={1} title="Abrí el anuncio en Airbnb">
          <p>
            Entrá a <Crumbs items={["Calendario"]} /> y, en la lista de la
            izquierda, hacé clic en el anuncio que querés conectar — no la vista
            general de todos.
          </p>
        </Step>
        <Step n={2} title="Exportá el calendario">
          <p>En el panel de la derecha bajá hasta:</p>
          <Crumbs
            items={["Sincronizar calendarios", "Exportar calendario"]}
            accentLast
          />
        </Step>
        <Step n={3} title="Copiá el link iCal">
          <p>Es una URL que termina en .ics. Copiala completa:</p>
          <code className="block w-fit max-w-full truncate rounded-md bg-background px-2 py-1 font-mono text-[11px] text-foreground/80 ring-1 ring-inset ring-border">
            https://www.airbnb.com/calendar/ical/…​.ics
          </code>
        </Step>
        <Step n={4} title="Pegalo en Conectar feed">
          <p>
            Acá arriba tocá{" "}
            <BtnChip>
              <Plus className="size-3" />
              Conectar feed
            </BtnChip>
            , elegí la <b className="font-medium text-foreground/80">unidad</b>,
            la plataforma <b className="font-medium text-foreground/80">Airbnb</b>{" "}
            y pegá el link.
          </p>
        </Step>
        <Step n={5} title="Sincronizá y listo" last>
          <p>
            De ahí en más entra solo (1 vez por día, 03:00). Para traer las
            reservas ya cargadas, tocá ahora{" "}
            <BtnChip tone="outline">
              <RefreshCw className="size-3" />
              Sincronizar todos
            </BtnChip>
            .
          </p>
        </Step>
      </ol>

      <div className="mt-4 space-y-2.5 rounded-lg bg-background/50 p-3">
        <Note icon={<Lightbulb className="size-3.5 text-amber-500" />}>
          <b className="font-medium text-foreground/80">Cada anuncio = un link.</b>{" "}
          Repetí estos pasos por cada unidad que tengas publicada.
        </Note>
        <Note
          icon={
            <span className="grid size-3.5 place-items-center rounded-full bg-blue-600 text-[8px] font-bold text-white">
              B
            </span>
          }
        >
          ¿Usás <b className="font-medium text-foreground/80">Booking</b>? El
          camino es{" "}
          <Crumbs
            items={[
              "Extranet",
              "Tarifas y disponibilidad",
              "Sincronizar calendarios",
              "Exportar calendario",
            ]}
          />
        </Note>
      </div>
    </>
  );
}

/* ── export steps ────────────────────────────────────────────────── */

function ExportBody() {
  return (
    <>
      <ol className="space-y-0">
        <Step n={1} title="Copiá el link de la unidad">
          <p>
            En la lista de abajo, tocá{" "}
            <BtnChip tone="outline">
              <Copy className="size-3" />
              Copiar
            </BtnChip>{" "}
            en la unidad que quieras exportar.
          </p>
        </Step>
        <Step n={2} title="Importalo en Airbnb">
          <p>Pegá ese link en Airbnb, dentro del anuncio:</p>
          <Crumbs
            items={[
              "Calendario",
              "Elegí el anuncio",
              "Sincronizar calendarios",
              "Importar calendario",
            ]}
            accentLast
          />
          <p>
            Poné un nombre para reconocerlo (ej.{" "}
            <span className="font-medium text-foreground/80">«rentOS»</span>).
          </p>
        </Step>
        <Step n={3} title="Esperá la actualización">
          <p>
            Cada plataforma refresca cada{" "}
            <b className="font-medium text-foreground/80">~2 a 12 hs</b>, no es
            instantáneo. Cargá las reservas directas con anticipación para evitar
            doble-reserva.
          </p>
        </Step>
        <Step n={4} title="Privacidad cuidada" last>
          <p>
            El link solo expone las{" "}
            <b className="font-medium text-foreground/80">fechas ocupadas</b>: sin
            nombres de huéspedes ni montos.
          </p>
        </Step>
      </ol>

      <div className="mt-4 space-y-2.5 rounded-lg bg-background/50 p-3">
        <Note icon={<Clock className="size-3.5 text-sky-500" />}>
          La sincronización no es en tiempo real. Para fechas muy próximas,
          confirmá la disponibilidad a mano.
        </Note>
        <Note
          icon={
            <span className="grid size-3.5 place-items-center rounded-full bg-blue-600 text-[8px] font-bold text-white">
              B
            </span>
          }
        >
          En <b className="font-medium text-foreground/80">Booking</b>:{" "}
          <Crumbs
            items={[
              "Extranet",
              "Tarifas y disponibilidad",
              "Sincronizar calendarios",
              "Importar calendario",
            ]}
          />
        </Note>
      </div>
    </>
  );
}
