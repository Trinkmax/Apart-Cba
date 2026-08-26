"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useLiveContext } from "@/lib/realtime/live-context";
import { useLiveTable } from "@/lib/realtime/use-live";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/format";

/**
 * Los avisos que el dueño pidió que se NOTEN.
 *
 * Criterio: sólo lo que puede costar plata — una reserva ajena que entró, una
 * que se canceló (libera fechas) y una solicitud del marketplace (que NO
 * bloquea disponibilidad hasta que alguien la aprueba, así que es la ventana
 * ciega más peligrosa). Nada de cuotas, tickets ni cambios de estado menores:
 * un aviso que suena por todo deja de leerse a la semana.
 *
 * Reglas: nunca avisamos del cambio propio, nunca robamos el foco, y una
 * ráfaga (un sync de iCal) colapsa en un solo aviso agregado.
 */

/** Primer aviso rápido. */
const BUFFER_MS = 1_500;
/** La ventana se extiende mientras siga entrando (una ingesta de OTA gotea). */
const IDLE_MS = 4_000;
/** Techo duro: pasado esto se muestra lo acumulado, siga o no entrando. */
const MAX_WINDOW_MS = 20_000;
/**
 * Distancia máxima entre `cancelled_at` y `updated_at` para considerar que
 * la cancelación es la de ESTE update. Ambos los pone el server en la misma
 * transacción (`tg_set_updated_at`), así que el reloj del navegador no entra
 * en la cuenta — antes, una laptop adelantada tres minutos apagaba todos los
 * avisos de cancelación.
 */
const CANCEL_MATCH_MS = 5_000;

type Kind = "nueva" | "bloqueo" | "cancelada" | "solicitud";

interface Item {
  kind: Kind;
  id: string;
  unitId: string | null;
  checkIn: string | null;
  checkOut: string | null;
  source: string | null;
}

const unitCache = new Map<string, string>();
const seen = new Set<string>();

function rememberOnce(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  // Cota de memoria para una pestaña abierta todo el día.
  if (seen.size > 500) {
    const first = seen.values().next().value;
    if (first) seen.delete(first);
  }
  return true;
}

function stay(item: Item): string {
  if (!item.checkIn) return "";
  const from = formatDate(item.checkIn, "d MMM");
  const to = item.checkOut ? formatDate(item.checkOut, "d MMM") : null;
  return to ? `${from} – ${to}` : from;
}

const SOURCE_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking",
  directa: "Directa",
  marketplace: "rentOS",
  whatsapp: "WhatsApp",
  otro: "Otro",
};

export function LiveBookingAlerts() {
  const ctx = useLiveContext();
  const router = useRouter();
  const buffer = useRef<Item[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstAt = useRef(0);
  /** Lo que entró con la pestaña de fondo: se resume al volver. */
  const missed = useRef<Item[]>([]);

  const canSee = ctx ? can(ctx.role, "bookings", "view") : false;

  const resolveUnits = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => id && !unitCache.has(id));
    if (missing.length === 0) return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("units")
        .select("id, code, name")
        .in("id", missing);
      (data as { id: string; code: string | null; name: string | null }[] | null)?.forEach(
        (u) => unitCache.set(u.id, u.code || u.name || "Unidad")
      );
    } catch {
      /* si no se puede resolver, el aviso sale sin el nombre de la unidad */
    }
  }, []);

  const show = useCallback(
    async (items: Item[]) => {
      if (items.length === 0) return;
      await resolveUnits(items.map((i) => i.unitId).filter(Boolean) as string[]);

      const byKind = new Map<Kind, Item[]>();
      items.forEach((i) => {
        const list = byKind.get(i.kind) ?? [];
        list.push(i);
        byKind.set(i.kind, list);
      });

      const total = items.length;
      byKind.forEach((list, kind) => {
        // Ráfaga (import de iCal, ingesta de OTA): un solo aviso agregado.
        // El umbral mira el TOTAL del lote, no el de cada tipo: un feed que
        // trae 3 reservas y 2 bloqueos es una ráfaga, aunque ningún tipo
        // llegue a tres por su cuenta.
        if (list.length > 2 || (total > 3 && list.length > 1)) {
          const copy: Record<Kind, string> = {
            nueva: `${list.length} reservas nuevas`,
            bloqueo: `${list.length} bloqueos nuevos`,
            cancelada: `${list.length} reservas canceladas`,
            solicitud: `${list.length} solicitudes nuevas`,
          };
          toast(copy[kind], {
            description: "Entraron mientras estabas en esta pantalla.",
            action:
              kind === "solicitud"
                ? {
                    label: "Ver",
                    onClick: () => router.push("/dashboard/reservas-pendientes"),
                  }
                : { label: "Ver", onClick: () => router.push("/dashboard/reservas") },
          });
          return;
        }

        list.forEach((item) => {
          const unit = item.unitId ? unitCache.get(item.unitId) : null;
          const when = stay(item);
          const via = item.source ? SOURCE_LABEL[item.source] ?? item.source : null;
          const parts = [unit, when, kind === "nueva" ? via : null].filter(Boolean);
          const description = parts.join(" · ") || undefined;

          const title: Record<Kind, string> = {
            nueva: "Nueva reserva",
            bloqueo: "Nuevo bloqueo",
            cancelada: "Reserva cancelada",
            solicitud: "Nueva solicitud",
          };

          toast(title[kind], {
            description,
            action: {
              label: "Ver",
              onClick: () =>
                router.push(
                  kind === "solicitud"
                    ? `/dashboard/reservas-pendientes/${item.id}`
                    : `/dashboard/reservas/${item.id}`
                ),
            },
          });
        });
      });
    },
    [resolveUnits, router]
  );

  const push = useCallback(
    (item: Item) => {
      // Con la pestaña de fondo no encolamos avisos: apilar diez toasts para
      // cuando el operador vuelve es ruido. Se resume en uno solo.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        missed.current.push(item);
        return;
      }
      buffer.current.push(item);
      if (buffer.current.length === 1) firstAt.current = Date.now();
      // Ventana extensible con techo: una ingesta de OTA no entra en 1,5 s de
      // corrido —gotea cada 2-4 s— y con una ventana fija salían seis toasts
      // sueltos en vez de uno que dijera "6 reservas nuevas".
      if (timer.current) clearTimeout(timer.current);
      const elapsed = Date.now() - firstAt.current;
      const wait = Math.max(
        200,
        Math.min(
          buffer.current.length === 1 ? BUFFER_MS : IDLE_MS,
          MAX_WINDOW_MS - elapsed
        )
      );
      timer.current = setTimeout(() => {
        timer.current = null;
        const batch = buffer.current;
        buffer.current = [];
        void show(batch);
      }, wait);
    },
    [show]
  );

  // Resumen al volver al foreground.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const batch = missed.current;
      missed.current = [];
      if (batch.length === 0) return;
      if (batch.length <= 2) {
        void show(batch);
        return;
      }
      const nuevas = batch.filter((b) => b.kind === "nueva").length;
      const canceladas = batch.filter((b) => b.kind === "cancelada").length;
      const solicitudes = batch.filter((b) => b.kind === "solicitud").length;
      const parts = [
        nuevas ? `${nuevas} ${nuevas === 1 ? "reserva nueva" : "reservas nuevas"}` : null,
        canceladas ? `${canceladas} ${canceladas === 1 ? "cancelada" : "canceladas"}` : null,
        solicitudes
          ? `${solicitudes} ${solicitudes === 1 ? "solicitud" : "solicitudes"}`
          : null,
      ].filter(Boolean);
      toast("Mientras no estabas", { description: parts.join(" · ") });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [show]);

  useLiveTable({
    table: "bookings",
    enabled: canSee,
    onChange: (change) => {
      const row = change.new as Record<string, unknown> | null;
      if (!row || !change.id) return;

      if (change.eventType === "INSERT") {
        // El que la cargó ya sabe que existe.
        if (row.created_by && row.created_by === ctx?.userId) return;
        if (!rememberOnce(`ins:${change.id}`)) return;
        push({
          kind: row.is_block ? "bloqueo" : "nueva",
          id: change.id,
          unitId: (row.unit_id as string | null) ?? null,
          checkIn: (row.check_in_date as string | null) ?? null,
          checkOut: (row.check_out_date as string | null) ?? null,
          source: (row.source as string | null) ?? null,
        });
        return;
      }

      if (change.eventType === "UPDATE" && row.status === "cancelada") {
        // `old` sólo trae la PK (REPLICA IDENTITY DEFAULT), así que la
        // transición se deduce comparando dos sellos del MISMO payload, los
        // dos escritos por el server: si `cancelled_at` y `updated_at` son
        // prácticamente el mismo instante, esta fila se canceló en este
        // update; si no, es una edición posterior de algo ya cancelado.
        const at = row.cancelled_at as string | null;
        const upd = row.updated_at as string | null;
        if (!at || !upd) return;
        const delta = Math.abs(new Date(upd).getTime() - new Date(at).getTime());
        if (Number.isNaN(delta) || delta > CANCEL_MATCH_MS) return;
        if (row.cancelled_by && row.cancelled_by === ctx?.userId) return;
        if (!rememberOnce(`can:${change.id}:${at}`)) return;
        push({
          kind: "cancelada",
          id: change.id,
          unitId: (row.unit_id as string | null) ?? null,
          checkIn: (row.check_in_date as string | null) ?? null,
          checkOut: (row.check_out_date as string | null) ?? null,
          source: (row.source as string | null) ?? null,
        });
      }
    },
  });

  useLiveTable({
    table: "booking_requests",
    enabled: canSee,
    onChange: (change) => {
      if (change.eventType !== "INSERT" || !change.id) return;
      const row = change.new as Record<string, unknown> | null;
      if (!row) return;
      if (!rememberOnce(`req:${change.id}`)) return;
      push({
        kind: "solicitud",
        id: change.id,
        unitId: (row.unit_id as string | null) ?? null,
        checkIn: (row.check_in_date as string | null) ?? null,
        checkOut: (row.check_out_date as string | null) ?? null,
        source: "marketplace",
      });
    },
  });

  return null;
}
