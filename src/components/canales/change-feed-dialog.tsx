"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { saveLinkFeed } from "@/lib/actions/channels";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { OTA_EXPORT_PATH, OTA_FEED_PLACEHOLDER } from "@/lib/channels/ota-help";
import type { Channel } from "@/lib/channels/types";

/**
 * Cambiar el calendario ENTRANTE de una conexión ya andando.
 *
 * Sin esto, un enlace que vence (Booking devuelve 200 con cero eventos, que es
 * indistinguible de "no hay reservas") dejaba a la operadora en un callejón sin
 * salida: la incidencia le pedía revisar el enlace y el único lugar para
 * pegarlo era el asistente, que sólo muestra borradores. El otro camino
 * —borrar y volver a conectar— rompe en silencio la sincronización saliente,
 * porque la URL que la OTA ya tiene guardada lleva el id del link viejo.
 *
 * El resultado de la prueba se muestra tal cual viene: cero eventos NO es un
 * éxito, es justamente el síntoma de haber pegado el enlace equivocado.
 */
export function ChangeFeedDialog({
  linkId,
  channel,
  unitCode,
  unitName,
  hasFeed = true,
  trigger,
  onSaved,
}: {
  linkId: string;
  channel: Channel;
  unitCode: string;
  unitName?: string;
  /** false = la conexión todavía no tiene calendario cargado. */
  hasFeed?: boolean;
  trigger: ReactNode;
  /** Se dispara al cerrar, sólo si el enlace nuevo trajo al menos un evento. */
  onSaved?: (events: number) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const meta = BOOKING_SOURCE_META[channel];
  const ok = events !== null && events > 0;

  function save() {
    // Atajo antes de ir al servidor: un pegado a medias (sin https://, o el
    // nombre del calendario en vez del enlace) muere en el Zod de la action y
    // ese error no está escrito para nadie.
    if (!/^https:\/\//i.test(url.trim())) {
      setEvents(null);
      setError(`El enlace tiene que empezar con https:// — copialo completo desde ${meta.label}.`);
      return;
    }
    startSaving(async () => {
      setError(null);
      try {
        const r = await saveLinkFeed({ link_id: linkId, feed_url: url.trim() });
        setEvents(r.events);
        // el tablero muestra "sin calendario cargado" / última lectura
        router.refresh();
      } catch (err) {
        setEvents(null);
        setError(err instanceof Error ? err.message : "No se pudo leer el calendario");
      }
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) return;
    const savedEvents = events ?? 0;
    setUrl("");
    setEvents(null);
    setError(null);
    if (savedEvents > 0) onSaved?.(savedEvents);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {hasFeed ? "Cambiar el enlace del calendario" : "Cargar el enlace del calendario"}
          </DialogTitle>
          <DialogDescription>
            Pegá el enlace del calendario de{" "}
            <span style={{ color: meta.color }}>{meta.label}</span> de{" "}
            <span className="font-mono">{unitCode}</span>
            {unitName ? ` · ${unitName}` : ""}. Lo probamos antes de guardarlo y te decimos cuántos
            eventos trae.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium">¿De dónde lo saco?</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {OTA_EXPORT_PATH[channel]}
            </p>
          </div>

          <div className="space-y-1.5">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={OTA_FEED_PLACEHOLDER[channel]}
              className="h-9 text-xs font-mono"
              aria-label={`Enlace del calendario de ${meta.label}`}
            />
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-400">
                <CircleAlert size={14} className="mt-0.5 shrink-0" />
                <p className="leading-relaxed">{error}</p>
              </div>
            )}
            {events !== null && events === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <p className="leading-relaxed">
                  El enlace responde pero no trae ningún evento. Si el anuncio tiene reservas o
                  fechas bloqueadas, el enlace no es el correcto. Volvé a copiarlo desde{" "}
                  {meta.label} y probá de nuevo — lo guardamos igual, así que podés pegar otro
                  encima cuando lo tengas.
                </p>
              </div>
            )}
            {ok && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                <p className="leading-relaxed">
                  Listo: el calendario trajo {events} {events === 1 ? "evento" : "eventos"} (reservas
                  y fechas bloqueadas). El enlace quedó guardado.
                </p>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Esto cambia sólo el calendario que <b>nosotros leemos</b> de {meta.label}. El calendario
            nuestro que ya cargaste en {meta.label} sigue igual: no hace falta volver a copiarlo ni
            tocar nada allá.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            {ok ? "Listo" : events === 0 ? "Cerrar" : "Cancelar"}
          </Button>
          <Button onClick={save} disabled={!url.trim() || saving} className="gap-1.5">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Probar y guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
