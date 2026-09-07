"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCommissionSettings } from "@/lib/actions/org";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import {
  COMMISSION_BASE_META,
  computeBookingEconomics,
  type CommissionBase,
} from "@/lib/finance/booking-economics";
import { cn } from "@/lib/utils";
import type { BookingSource } from "@/lib/types/database";

/**
 * Canales en el orden en que se muestran. Las plataformas primero (son las que
 * cobran comisión); los canales propios van al final y por defecto en 0.
 */
const CHANNELS: Array<{ source: BookingSource; hint: string }> = [
  {
    source: "booking",
    hint: "Booking.com te factura su comisión aparte, una vez por mes. Suele ser 15% (más si activaste visibilidad extra).",
  },
  {
    source: "airbnb",
    hint: "Airbnb te descuenta su parte antes de pagarte. 3% en la modalidad dividida; alrededor de 15% si elegiste que la pague sólo el anfitrión.",
  },
  { source: "expedia", hint: "Comisión que te descuenta Expedia por cada reserva." },
  { source: "vrbo", hint: "Comisión que te descuenta Vrbo por cada reserva." },
  { source: "directo", hint: "Reservas por tu web o por contacto directo. Normalmente 0%." },
  { source: "whatsapp", hint: "Reservas cerradas por WhatsApp. Normalmente 0%." },
  { source: "instagram", hint: "Reservas cerradas por Instagram. Normalmente 0%." },
  { source: "otro", hint: "Cualquier otro origen." },
];

const EXAMPLE_TOTAL = 100_000;
const EXAMPLE_CLEANING = 15_000;

type Initial = {
  channel_commissions: Partial<Record<BookingSource, number>>;
  commission_base: CommissionBase;
  default_commission_pct: number;
  default_currency: string;
};

function parsePct(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function CommissionSettingsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [pcts, setPcts] = useState<Record<BookingSource, string>>(() => {
    const out = {} as Record<BookingSource, string>;
    for (const c of CHANNELS) {
      const v = initial.channel_commissions[c.source];
      out[c.source] = v === undefined || v === null ? "" : String(v);
    }
    return out;
  });
  const [base, setBase] = useState<CommissionBase>(initial.commission_base);
  const [adminPct, setAdminPct] = useState(String(initial.default_commission_pct));
  const [exampleSource, setExampleSource] = useState<BookingSource>("booking");

  // Ejemplo en vivo: la mejor forma de explicar una fórmula es mostrarla con
  // plata. Usa los valores que la persona está tipeando, no los guardados.
  const example = useMemo(() => {
    const channelPct = parsePct(pcts[exampleSource]);
    const commissionPct = parsePct(adminPct);
    return computeBookingEconomics({
      total: EXAMPLE_TOTAL,
      cleaningFee: EXAMPLE_CLEANING,
      channelPct: Number.isFinite(channelPct ?? 0) ? channelPct ?? 0 : 0,
      commissionPct: Number.isFinite(commissionPct ?? 0) ? commissionPct ?? 0 : 0,
      commissionBase: base,
    });
  }, [pcts, exampleSource, adminPct, base]);

  function handleSubmit() {
    const parsedAdmin = parsePct(adminPct);
    if (parsedAdmin === null || !Number.isFinite(parsedAdmin) || parsedAdmin < 0 || parsedAdmin > 100) {
      toast.error("Comisión de administración inválida", {
        description: "Tiene que ser un número entre 0 y 100.",
      });
      return;
    }
    const map: Partial<Record<BookingSource, number | null>> = {};
    for (const c of CHANNELS) {
      const v = parsePct(pcts[c.source]);
      if (v === null) {
        map[c.source] = null;
        continue;
      }
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        toast.error(`Comisión de ${BOOKING_SOURCE_META[c.source].label} inválida`, {
          description: "Tiene que ser un número entre 0 y 100, o quedar vacío.",
        });
        return;
      }
      map[c.source] = v;
    }
    startTransition(async () => {
      const r = await updateCommissionSettings({
        channel_commissions: map,
        commission_base: base,
        default_commission_pct: parsedAdmin,
      });
      if (!r.ok) {
        toast.error("No se pudieron guardar las comisiones", { description: r.error });
        return;
      }
      toast.success("Comisiones guardadas", {
        description: "Las reservas nuevas ya toman estos porcentajes.",
      });
      router.refresh();
    });
  }

  const cur = initial.default_currency;

  return (
    <div className="space-y-5">
      {/* ── Por canal ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Comisión de cada canal de venta</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            El porcentaje que se lleva la plataforma sobre lo que paga el huésped. Se
            aplica a las reservas nuevas de ese canal; en cada reserva podés
            corregirlo a mano.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {CHANNELS.map((c) => {
            const meta = BOOKING_SOURCE_META[c.source];
            const id = `channel-pct-${c.source}`;
            return (
              <div key={c.source} className="space-y-1.5">
                <Label htmlFor={id} className="flex items-center gap-2">
                  <span
                    className="inline-block size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: meta.color }}
                    aria-hidden
                  />
                  {meta.label}
                </Label>
                <div className="relative">
                  <Input
                    id={id}
                    type="text"
                    inputMode="decimal"
                    value={pcts[c.source]}
                    onChange={(e) =>
                      setPcts((p) => ({ ...p, [c.source]: e.target.value }))
                    }
                    placeholder="0"
                    className="font-mono pr-8"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{c.hint}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Administración ────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Tu comisión de administración</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lo que te quedás vos por administrar, y que se le descuenta al propietario
            en la liquidación.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <Label htmlFor="admin-pct">Porcentaje por defecto</Label>
            <div className="relative max-w-[160px]">
              <Input
                id="admin-pct"
                type="text"
                inputMode="decimal"
                value={adminPct}
                onChange={(e) => setAdminPct(e.target.value)}
                placeholder="20"
                className="font-mono pr-8"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Se propone al crear una unidad nueva. Cada unidad guarda su propio %, y
              cada propietario puede tener uno distinto (ficha de la unidad).
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">¿Sobre qué se calcula?</legend>
            {(Object.keys(COMMISSION_BASE_META) as CommissionBase[]).map((k) => {
              const meta = COMMISSION_BASE_META[k];
              const active = base === k;
              return (
                <label
                  key={k}
                  className={cn(
                    "flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    active
                      ? "border-primary/50 bg-primary/5"
                      : "hover:bg-accent/40 border-border"
                  )}
                >
                  <input
                    type="radio"
                    name="commission-base"
                    value={k}
                    checked={active}
                    onChange={() => setBase(k)}
                    className="mt-1 accent-[var(--primary)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{meta.label}</span>
                    <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
                      {meta.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        </div>
      </div>

      {/* ── Ejemplo en vivo ───────────────────────────────────────────── */}
      <div className="rounded-lg border bg-muted/30 p-4 sm:p-6 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Así se reparte una reserva</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ejemplo con un huésped que paga {formatMoney(EXAMPLE_TOTAL, cur)} (incluye{" "}
              {formatMoney(EXAMPLE_CLEANING, cur)} de limpieza).
            </p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {CHANNELS.filter((c) => ["booking", "airbnb", "directo"].includes(c.source)).map(
              (c) => (
                <button
                  key={c.source}
                  type="button"
                  onClick={() => setExampleSource(c.source)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    exampleSource === c.source
                      ? "bg-foreground text-background border-foreground"
                      : "text-muted-foreground hover:text-foreground border-border"
                  )}
                >
                  {BOOKING_SOURCE_META[c.source].label}
                </button>
              )
            )}
          </div>
        </div>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm max-w-md">
          <dt className="text-muted-foreground">Paga el huésped</dt>
          <dd className="text-right tabular-nums font-medium">{formatMoney(example.total, cur)}</dd>

          <dt className="text-muted-foreground">
            Se lleva {BOOKING_SOURCE_META[exampleSource].label} ({example.channelPct}%)
          </dt>
          <dd className="text-right tabular-nums text-rose-600 dark:text-rose-400">
            − {formatMoney(example.channelCommission, cur)}
          </dd>

          <dt className="text-muted-foreground">
            Tu comisión ({example.commissionPct}% sobre {formatMoney(example.commissionBaseAmount, cur)})
          </dt>
          <dd className="text-right tabular-nums text-violet-700 dark:text-violet-300">
            − {formatMoney(example.commission, cur)}
          </dd>

          <dt className="text-muted-foreground">Limpieza (queda en la administración)</dt>
          <dd className="text-right tabular-nums text-cyan-700 dark:text-cyan-300">
            − {formatMoney(example.cleaning, cur)}
          </dd>

          <dt className="font-semibold border-t pt-2">Le queda al propietario</dt>
          <dd className="text-right tabular-nums font-semibold border-t pt-2 text-emerald-700 dark:text-emerald-300">
            {formatMoney(example.ownerNet, cur)}
          </dd>
        </dl>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Estos mismos números aparecen en cada reserva, en Resultados y en la
          liquidación del propietario.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={handleSubmit} disabled={isPending} className="gap-1.5">
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar comisiones
        </Button>
      </div>
    </div>
  );
}
