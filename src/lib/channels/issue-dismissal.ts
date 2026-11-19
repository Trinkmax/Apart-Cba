/**
 * Un aviso que una persona descartó no vuelve por el mismo motivo.
 *
 * Una reserva de canal que no se pudo cargar (choca con otra, falta saber si es
 * la misma) se reintenta cada hora (`shouldRetryUnprojected` en dispatch.ts) y
 * cada reintento abría el aviso otra vez: el índice único
 * (`uniq_channel_issues_open_dedupe`) sólo mira los abiertos. Cofico Ideal,
 * Habitana (18/11/2026): Cecilia marcó «controlada» un conflicto y a la hora
 * estaba de nuevo en rojo.
 *
 * Si cambia la situación (otras fechas, otra reserva local con la que choca),
 * cambia el texto y el aviso vuelve: eso sí es algo nuevo que mirar.
 */
export interface IssueSituation {
  booking_id: string | null;
  title: string;
  detail: string | null;
}

export function isSameSituation(dismissed: IssueSituation, next: IssueSituation): boolean {
  return (
    (dismissed.booking_id ?? null) === (next.booking_id ?? null) &&
    dismissed.title.trim() === next.title.trim() &&
    (dismissed.detail ?? "").trim() === (next.detail ?? "").trim()
  );
}
