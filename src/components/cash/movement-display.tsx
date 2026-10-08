import { Fragment } from "react";
import { BedDouble, KeyRound, MapPin, User2 } from "lucide-react";
import { highlightSegments } from "@/lib/cash/search";
import { cn } from "@/lib/utils";
import type { MovementPartyKind } from "@/lib/actions/cash";

/** Etiqueta corta de categoría para las listas de Caja. */
export const CATEGORY_SHORT_LABELS: Record<string, string> = {
  booking_payment: "Reserva",
  maintenance: "Mantenimiento",
  cleaning: "Limpieza",
  owner_settlement: "Liquidación",
  transfer: "Transferencia",
  adjustment: "Ajuste",
  salary: "Sueldo",
  utilities: "Servicios",
  tax: "Impuestos",
  supplies: "Insumos",
  commission: "Comisión",
  refund: "Devolución",
  extra_charge: "Extra",
  rent_collection: "Alquiler",
  rent_owner_payout: "Rendición",
  security_deposit: "Depósito",
  agency_fee: "Honorarios",
  other: "Otro",
};

// "Cobro de reserva a84a7ab1": la descripción que escribe el sistema al
// cobrar. No le dice nada a nadie; el huésped sí.
const AUTO_BOOKING_DESCRIPTION = /^cobro de reserva(\s+[0-9a-f]{6,})?$/i;

type TitleSource = {
  category: string;
  description: string | null;
  party_name?: string | null;
  party_kind?: MovementPartyKind | null;
};

/**
 * Título de una fila de Caja. Un cobro de reserva con la descripción
 * automática pasa a decir a quién se le cobró; cualquier descripción que
 * alguien escribió a mano ("Cuota 2/6", "Seña por transferencia") se respeta.
 */
export function movementTitle(m: TitleSource): { title: string; partyInTitle: boolean } {
  const desc = m.description?.trim() ?? "";
  if (
    m.category === "booking_payment" &&
    m.party_kind === "huesped" &&
    m.party_name &&
    (desc === "" || AUTO_BOOKING_DESCRIPTION.test(desc))
  ) {
    return { title: `Cobro · ${m.party_name}`, partyInTitle: true };
  }
  return { title: desc || CATEGORY_SHORT_LABELS[m.category] || m.category, partyInTitle: false };
}

/** Texto con lo que coincidió con la búsqueda resaltado (sin importar tildes). */
export function Highlight({ text, tokens }: { text: string; tokens?: string[] }) {
  if (!tokens?.length || !text) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, tokens).map((s, i) =>
        s.match ? (
          <mark
            key={i}
            className="rounded-[3px] bg-amber-200/80 px-px text-inherit box-decoration-clone dark:bg-amber-400/25"
          >
            {s.text}
          </mark>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

const PARTY: Record<MovementPartyKind, { label: string; Icon: typeof User2 }> = {
  huesped: { label: "Huésped", Icon: BedDouble },
  propietario: { label: "Propietario", Icon: User2 },
  inquilino: { label: "Inquilino", Icon: KeyRound },
};

/** Quién está del otro lado: huésped, propietario o inquilino. */
export function PartyTag({
  name,
  kind,
  tokens,
  className,
}: {
  name: string;
  kind: MovementPartyKind | null;
  tokens?: string[];
  className?: string;
}) {
  const p = kind ? PARTY[kind] : null;
  const Icon = p?.Icon ?? User2;
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1", className)}
      title={p ? `${p.label}: ${name}` : name}
    >
      <Icon size={11} className="shrink-0 opacity-70" aria-hidden />
      <span className="sr-only">{p?.label ?? "Persona"}:</span>
      <span className="truncate">
        <Highlight text={name} tokens={tokens} />
      </span>
    </span>
  );
}

function matches(text: string | null | undefined, tokens?: string[]): boolean {
  return !!text && !!tokens?.length && highlightSegments(text, tokens).some((s) => s.match);
}

/**
 * Dónde: el depto, los deptos de una liquidación o la propiedad en alquiler.
 * `detail` es el nombre largo del depto: se muestra sólo cuando la búsqueda
 * coincidió ahí y no en el código ("terraforte" → "TERRA · TERRAFORTE"), para
 * que siempre se vea por qué apareció la fila.
 */
export function PlaceTag({
  label,
  detail,
  tokens,
  className,
  withIcon = false,
}: {
  label: string;
  detail?: string | null;
  tokens?: string[];
  className?: string;
  withIcon?: boolean;
}) {
  const extra = detail?.trim();
  const showDetail = !!extra && !matches(label, tokens) && matches(extra, tokens);
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 font-mono", className)}
      title={extra && extra !== label ? `${label} · ${extra}` : label}
    >
      {withIcon && <MapPin size={10} className="shrink-0 opacity-60" aria-hidden />}
      <span className="truncate">
        <Highlight text={label} tokens={tokens} />
        {showDetail && (
          <span className="font-sans">
            {" · "}
            <Highlight text={extra} tokens={tokens} />
          </span>
        )}
      </span>
    </span>
  );
}
