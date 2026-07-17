import { matchUnit } from "@/lib/inbound/matcher";
import { normalizePhoneE164, resolveGuest } from "./guest";
import type {
  Channel,
  ChannelReservationRow,
  ChannelIssueType,
  IngestResult,
  ReservationEvent,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

/**
 * Servicio canónico de ingestión. TODO evento externo (iCal o email) entra por
 * acá:
 *
 *   1. Se persiste durable e idempotente en channel_events (org + dedupe_key).
 *   2. Se resuelve contra channel_reservations (la reserva externa canónica).
 *   3. Se proyecta a UN único booking (o se registra una incidencia).
 *
 * Garantías:
 *   - eventos duplicados → no-op
 *   - email primero o iCal primero → convergen en el mismo booking
 *   - modificaciones conservan el UUID del booking
 *   - cancelaciones resuelven por referencias externas (nunca guest_id IS NULL)
 *   - el huésped se crea/enlaza SOLO después de proyectar la reserva
 *   - conflictos de solapamiento conservan el evento y la reserva externa,
 *     crean una incidencia crítica y NO tocan la reserva local
 */
export async function ingestEvent(
  admin: AdminClient,
  ev: ReservationEvent,
): Promise<IngestResult> {
  // ── 1. Persistencia durable + idempotencia ────────────────────────────────
  const { data: inserted, error: insertErr } = await admin
    .from("channel_events")
    .insert({
      organization_id: ev.organizationId,
      link_id: ev.linkId ?? null,
      transport: ev.transport,
      event_type: ev.eventType,
      dedupe_key: ev.dedupeKey,
      payload: minimizePayload(ev),
      content_hash: ev.contentHash ?? null,
      status: "received",
    })
    .select("id")
    .single();

  let eventId: string;
  if (insertErr) {
    if (insertErr.code !== "23505") {
      return { outcome: "error", error: insertErr.message };
    }
    // Ya lo vimos: si quedó procesado es un duplicado puro; si quedó en error
    // o recibido, lo reintentamos (retry-safe).
    const { data: existing } = await admin
      .from("channel_events")
      .select("id, status")
      .eq("organization_id", ev.organizationId)
      .eq("dedupe_key", ev.dedupeKey)
      .maybeSingle();
    if (!existing) return { outcome: "error", error: "evento duplicado no recuperable" };
    if (existing.status === "processed" || existing.status === "processing") {
      return { outcome: "duplicate" };
    }
    eventId = existing.id;
  } else {
    eventId = inserted.id;
  }

  return processStoredEvent(admin, eventId, ev);
}

/** Reprocesa un channel_event ya persistido (retries del reconciliador). */
export async function processStoredEvent(
  admin: AdminClient,
  eventId: string,
  ev: ReservationEvent,
): Promise<IngestResult> {
  // attempts++ sin RPC: el dispatcher procesa cada evento serializado, así que
  // leer-e-incrementar alcanza acá
  const { data: evRow } = await admin
    .from("channel_events")
    .select("attempts")
    .eq("id", eventId)
    .single();
  await admin
    .from("channel_events")
    .update({ status: "processing", attempts: (evRow?.attempts ?? 0) + 1 })
    .eq("id", eventId);

  let result: IngestResult;
  try {
    result =
      ev.eventType === "reservation_cancelled"
        ? await processCancellation(admin, eventId, ev)
        : await processUpsert(admin, eventId, ev);
  } catch (err) {
    result = { outcome: "error", error: (err as Error).message };
  }

  const finalStatus =
    result.outcome === "error"
      ? "error"
      : result.outcome === "needs_review" || result.outcome === "conflict"
        ? "needs_review"
        : "processed";

  await admin
    .from("channel_events")
    .update({
      status: finalStatus,
      error: result.error ?? null,
      processed_at: new Date().toISOString(),
      link_id: ev.linkId ?? undefined,
    })
    .eq("id", eventId);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert (reserva nueva o modificación)
// ─────────────────────────────────────────────────────────────────────────────

async function processUpsert(
  admin: AdminClient,
  eventId: string,
  ev: ReservationEvent,
): Promise<IngestResult> {
  // ── 2. Resolver la reserva externa canónica ───────────────────────────────
  let reservation = await findReservation(admin, ev);

  // ── 3. Resolver unidad (determinista; jamás fuzzy auto-asignado) ──────────
  let unitId = ev.unitId ?? reservation?.unit_id ?? null;
  let linkId = ev.linkId ?? reservation?.link_id ?? null;

  if (!unitId) {
    const resolved = await resolveUnitDeterministic(admin, ev);
    if (resolved.unitId) {
      unitId = resolved.unitId;
      linkId = linkId ?? resolved.linkId;
    } else {
      // Sin unidad inequívoca → incidencia con sugerencias; el evento queda
      // en needs_review y NO se toca ninguna reserva local.
      const suggestions = await suggestUnits(admin, ev);
      const issueId = await openIssue(admin, {
        organizationId: ev.organizationId,
        linkId,
        eventId,
        issueType: resolved.ambiguous ? "ambiguous_unit" : "unmapped_unit",
        severity: "warning",
        title:
          resolved.ambiguous
            ? `Reserva de ${channelLabel(ev.channel)} con unidad ambigua`
            : `Reserva de ${channelLabel(ev.channel)} sin unidad identificada`,
        detail: buildUnitIssueDetail(ev),
        suggested: { units: suggestions, listing_hint: ev.listingHint ?? null },
        dedupeKey: `unit:${ev.channel}:${ev.confirmationCode ?? ev.icalUid ?? ev.dedupeKey}`,
      });
      return { outcome: "needs_review", issueId };
    }
  }

  // ── 4. Upsert de channel_reservations ─────────────────────────────────────
  if (!reservation) {
    const { data: created, error } = await admin
      .from("channel_reservations")
      .insert({
        organization_id: ev.organizationId,
        link_id: linkId,
        unit_id: unitId,
        channel: ev.channel,
        external_status: "active",
        check_in: ev.checkIn ?? null,
        check_out: ev.checkOut ?? null,
        ical_uid: ev.icalUid ?? null,
        confirmation_code: ev.confirmationCode ?? null,
        guest: sanitizeGuest(ev),
        amounts: ev.amounts ?? {},
        last_seen_at: ev.transport === "ical" ? new Date().toISOString() : null,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        // carrera: otro procesador la creó — releer y seguir
        reservation = await findReservation(admin, ev);
        if (!reservation) return { outcome: "error", error: error.message };
      } else {
        return { outcome: "error", error: error.message };
      }
    } else {
      reservation = created as ChannelReservationRow;
    }
  }

  // merge de campos nuevos (código desde email, uid desde ical, guest, fechas)
  const patch: Record<string, unknown> = {};
  if (ev.confirmationCode && !reservation.confirmation_code)
    patch.confirmation_code = ev.confirmationCode;
  if (ev.icalUid && !reservation.ical_uid) patch.ical_uid = ev.icalUid;
  if (!reservation.link_id && linkId) patch.link_id = linkId;
  if (!reservation.unit_id && unitId) patch.unit_id = unitId;
  if (ev.checkIn && ev.checkOut) {
    if (reservation.check_in !== ev.checkIn || reservation.check_out !== ev.checkOut) {
      patch.check_in = ev.checkIn;
      patch.check_out = ev.checkOut;
    }
  }
  const mergedGuest = mergeGuest(reservation.guest, ev);
  if (mergedGuest) patch.guest = mergedGuest;
  if (ev.amounts && Object.keys(ev.amounts).length > 0) {
    patch.amounts = { ...reservation.amounts, ...ev.amounts };
  }
  if (ev.transport === "ical") {
    patch.last_seen_at = new Date().toISOString();
    patch.missing_since = null;
    patch.missing_runs = 0;
  }
  if (reservation.external_status === "cancelled" && ev.transport === "ical") {
    // reapareció en el feed después de cancelada → reactivar es riesgoso;
    // lo dejamos a revisión manual
    await openIssue(admin, {
      organizationId: ev.organizationId,
      linkId,
      eventId,
      reservationId: reservation.id,
      issueType: "cancellation_review",
      severity: "warning",
      title: `Una reserva cancelada volvió a aparecer en ${channelLabel(ev.channel)}`,
      detail: `La reserva ${reservation.confirmation_code ?? reservation.ical_uid ?? ""} (${reservation.check_in} → ${reservation.check_out}) figura otra vez en el calendario de la OTA después de haber sido cancelada. Verificá el estado real en la OTA.`,
      dedupeKey: `reappeared:${reservation.id}`,
    });
    return { outcome: "needs_review", reservationId: reservation.id };
  }

  if (Object.keys(patch).length > 0) {
    const { error: patchErr } = await admin
      .from("channel_reservations")
      .update(patch)
      .eq("id", reservation.id);
    if (patchErr && patchErr.code !== "23505") {
      return { outcome: "error", error: patchErr.message };
    }
    reservation = { ...reservation, ...patch } as ChannelReservationRow;
  }

  // ── 5. Proyección al booking (único punto que escribe bookings) ───────────
  return projectToBooking(admin, eventId, ev, reservation);
}

/**
 * Re-proyecta una channel_reservation ya resuelta (p.ej. después de que un
 * operador asignó la unidad en una incidencia ambigua).
 */
export async function reprojectReservation(
  admin: AdminClient,
  reservationId: string,
): Promise<IngestResult> {
  const { data } = await admin
    .from("channel_reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();
  if (!data) return { outcome: "error", error: "reserva externa no encontrada" };
  const reservation = data as ChannelReservationRow;
  const syntheticEv: ReservationEvent = {
    transport: "email",
    channel: reservation.channel,
    eventType: "reservation_upsert",
    organizationId: reservation.organization_id,
    linkId: reservation.link_id ?? undefined,
    unitId: reservation.unit_id ?? undefined,
    icalUid: reservation.ical_uid ?? undefined,
    confirmationCode: reservation.confirmation_code ?? undefined,
    checkIn: reservation.check_in ?? undefined,
    checkOut: reservation.check_out ?? undefined,
    isBlock: false,
    dedupeKey: `reproject:${reservationId}`,
  };
  return projectToBooking(admin, null, syntheticEv, reservation);
}

async function projectToBooking(
  admin: AdminClient,
  eventId: string | null,
  ev: ReservationEvent,
  reservation: ChannelReservationRow,
): Promise<IngestResult> {
  const orgId = ev.organizationId;

  // ¿ya está proyectada?
  if (reservation.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("id, status, check_in_date, check_out_date, guest_id, is_block, notes")
      .eq("id", reservation.booking_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (booking) {
      return updateProjectedBooking(admin, eventId, ev, reservation, booking);
    }
    // el booking fue borrado a mano — desvincular y re-proyectar
    await admin
      .from("channel_reservations")
      .update({ booking_id: null })
      .eq("id", reservation.id);
    reservation = { ...reservation, booking_id: null };
  }

  if (!reservation.unit_id || !reservation.check_in || !reservation.check_out) {
    return { outcome: "needs_review", reservationId: reservation.id };
  }

  // ¿existe un booking legacy con la misma referencia externa? (pre-v2)
  const legacyBookingId = await findLegacyBooking(admin, ev, reservation);
  if (legacyBookingId) {
    await admin
      .from("channel_reservations")
      .update({ booking_id: legacyBookingId })
      .eq("id", reservation.id);
    await addExternalRefs(admin, ev, reservation, legacyBookingId);
    reservation = { ...reservation, booking_id: legacyBookingId };
    const { data: booking } = await admin
      .from("bookings")
      .select("id, status, check_in_date, check_out_date, guest_id, is_block, notes")
      .eq("id", legacyBookingId)
      .single();
    if (booking) return updateProjectedBooking(admin, eventId, ev, reservation, booking);
  }

  // Adopción determinista: si existe EXACTAMENTE UNA reserva local vigente en la
  // misma unidad con las mismas fechas (cargada a mano, sin referencia externa),
  // es la misma reserva física — se vincula en lugar de alertar conflicto.
  // (Dos reservas distintas no pueden ocupar las mismas fechas: bookings_no_overlap.)
  const adoptable = await findAdoptableBooking(admin, ev, reservation);
  if (adoptable) {
    await admin
      .from("channel_reservations")
      .update({ booking_id: adoptable.id })
      .eq("id", reservation.id);
    if (!adoptable.external_id) {
      await admin
        .from("bookings")
        .update({ external_id: reservation.confirmation_code ?? reservation.ical_uid })
        .eq("id", adoptable.id)
        .is("external_id", null);
    }
    await addExternalRefs(admin, ev, reservation, adoptable.id);
    reservation = { ...reservation, booking_id: adoptable.id };
    await resolveIssuesByDedupe(
      admin,
      orgId,
      `conflict:${reservation.id}`,
      "Vinculada automáticamente a la reserva local existente (misma unidad y fechas exactas).",
    );
    return updateProjectedBooking(admin, eventId, ev, reservation, adoptable);
  }

  // insertar booking NUEVO — sin huésped todavía (se enlaza después, y así un
  // fallo acá no deja huéspedes huérfanos)
  const isBlock = ev.isBlock ?? false;
  const { data: inserted, error: insertErr } = await admin
    .from("bookings")
    .insert({
      organization_id: orgId,
      unit_id: reservation.unit_id,
      source: ev.channel,
      external_id: reservation.confirmation_code ?? reservation.ical_uid ?? null,
      status: "confirmada",
      mode: "temporario",
      is_block: isBlock,
      check_in_date: reservation.check_in,
      check_in_time: "14:00",
      check_out_date: reservation.check_out,
      check_out_time: "10:00",
      currency: "ARS",
      total_amount: 0,
      guests_count: 1,
      notes: isBlock
        ? `Ocupación importada de ${channelLabel(ev.channel)} (sin datos de reserva)`
        : `Importada de ${channelLabel(ev.channel)} (${ev.transport === "email" ? "email" : "calendario"})`,
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.message.includes("bookings_no_overlap")) {
      // Conflicto: conservamos evento + reserva externa, NO tocamos lo local,
      // NO debilitamos el constraint. Incidencia crítica accionable.
      const issueId = await openIssue(admin, {
        organizationId: orgId,
        linkId: reservation.link_id,
        eventId,
        reservationId: reservation.id,
        issueType: "conflict",
        severity: "critical",
        title: `Conflicto de disponibilidad con ${channelLabel(ev.channel)}`,
        detail: `${channelLabel(ev.channel)} vendió ${reservation.check_in} → ${reservation.check_out} pero esas fechas ya están ocupadas localmente en la unidad. La reserva local se mantiene; resolvé el conflicto (reubicar o cancelar en la OTA).`,
        dedupeKey: `conflict:${reservation.id}`,
      });
      await notify(admin, {
        organization_id: orgId,
        type: "inbound_booking_conflict",
        severity: "critical",
        title: `Conflicto de fechas con ${channelLabel(ev.channel)}`,
        body: `Una reserva externa (${reservation.confirmation_code ?? reservation.ical_uid ?? "sin ref"}) se superpone con una reserva local. Revisá Canales de venta.`,
        action_url: "/dashboard/canales",
        dedup_key: `channel_conflict:${reservation.id}`,
      });
      return { outcome: "conflict", reservationId: reservation.id, issueId };
    }
    return { outcome: "error", error: insertErr.message };
  }

  const bookingId = inserted.id as string;
  await admin
    .from("channel_reservations")
    .update({ booking_id: bookingId })
    .eq("id", reservation.id);
  await addExternalRefs(admin, ev, reservation, bookingId);

  // huésped: SOLO después de que la proyección existe
  await linkGuestIfPossible(admin, orgId, bookingId, reservation, null);

  if (!isBlock) {
    await notify(admin, {
      organization_id: orgId,
      type: "inbound_booking_pending",
      severity: "info",
      title: `Nueva reserva de ${channelLabel(ev.channel)}`,
      body: `${reservation.guest?.name ?? "Huésped"} · ${reservation.check_in} → ${reservation.check_out}`,
      ref_type: "booking",
      ref_id: bookingId,
      action_url: `/dashboard/reservas/${bookingId}`,
      dedup_key: `channel_new:${reservation.id}`,
    });
  }

  await touchLinkActivity(admin, reservation.link_id);
  return { outcome: "created", bookingId, reservationId: reservation.id };
}

async function updateProjectedBooking(
  admin: AdminClient,
  eventId: string | null,
  ev: ReservationEvent,
  reservation: ChannelReservationRow,
  booking: {
    id: string;
    status: string;
    check_in_date: string;
    check_out_date: string;
    guest_id: string | null;
    is_block: boolean;
    notes: string | null;
  },
): Promise<IngestResult> {
  const orgId = ev.organizationId;
  const patch: Record<string, unknown> = {};
  let outcome: IngestResult["outcome"] = "duplicate";

  // modificación de fechas — conserva el UUID del booking
  const datesChanged =
    reservation.check_in &&
    reservation.check_out &&
    (booking.check_in_date !== reservation.check_in ||
      booking.check_out_date !== reservation.check_out);

  if (datesChanged) {
    if (booking.status === "confirmada" || booking.status === "pendiente") {
      patch.check_in_date = reservation.check_in;
      patch.check_out_date = reservation.check_out;
      outcome = "updated";
    } else if (booking.status === "cancelada") {
      // la OTA re-activó una reserva que localmente está cancelada → revisar
      const issueId = await openIssue(admin, {
        organizationId: orgId,
        linkId: reservation.link_id,
        eventId,
        reservationId: reservation.id,
        bookingId: booking.id,
        issueType: "cancellation_review",
        severity: "warning",
        title: `${channelLabel(ev.channel)} modificó una reserva cancelada`,
        detail: `La reserva externa cambió a ${reservation.check_in} → ${reservation.check_out} pero localmente figura cancelada. Verificá el estado en la OTA.`,
        dedupeKey: `modified_cancelled:${reservation.id}`,
      });
      return { outcome: "needs_review", issueId, bookingId: booking.id };
    } else {
      // check_in / check_out en curso: no movemos fechas automáticamente
      const issueId = await openIssue(admin, {
        organizationId: orgId,
        linkId: reservation.link_id,
        eventId,
        reservationId: reservation.id,
        bookingId: booking.id,
        issueType: "conflict",
        severity: "warning",
        title: `Modificación de ${channelLabel(ev.channel)} sobre una estadía en curso`,
        detail: `La OTA informa ${reservation.check_in} → ${reservation.check_out} pero la reserva local está ${booking.status === "check_in" ? "con huésped en casa" : "finalizada"}. Ajustá manualmente si corresponde.`,
        dedupeKey: `modify_inhouse:${reservation.id}`,
      });
      return { outcome: "needs_review", issueId, bookingId: booking.id };
    }
  }

  // ascenso: ocupación → reserva real (llegó el email con datos)
  if (booking.is_block && ev.isBlock === false) {
    patch.is_block = false;
    patch.notes = `Importada de ${channelLabel(ev.channel)} (email + calendario)`;
    outcome = "updated";
  }

  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await admin
      .from("bookings")
      .update(patch)
      .eq("id", booking.id)
      .eq("organization_id", orgId);
    if (updErr) {
      if (updErr.message.includes("bookings_no_overlap")) {
        const issueId = await openIssue(admin, {
          organizationId: orgId,
          linkId: reservation.link_id,
          eventId,
          reservationId: reservation.id,
          bookingId: booking.id,
          issueType: "conflict",
          severity: "critical",
          title: `Conflicto al aplicar cambio de fechas de ${channelLabel(ev.channel)}`,
          detail: `La OTA movió la reserva a ${reservation.check_in} → ${reservation.check_out} pero esas fechas chocan con otra reserva local. La reserva local queda como estaba; resolvé manualmente.`,
          dedupeKey: `conflict_update:${reservation.id}`,
        });
        return { outcome: "conflict", issueId, bookingId: booking.id };
      }
      return { outcome: "error", error: updErr.message };
    }
  }

  // enriquecimiento de huésped (email después de iCal) — vía UPDATE, el trigger
  // de stats cubre este caso
  const guestLinked = await linkGuestIfPossible(
    admin,
    orgId,
    booking.id,
    reservation,
    booking.guest_id,
  );
  if (guestLinked) outcome = outcome === "duplicate" ? "updated" : outcome;

  await addExternalRefs(admin, ev, reservation, booking.id);
  await touchLinkActivity(admin, reservation.link_id);
  return { outcome, bookingId: booking.id, reservationId: reservation.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancelación (email con referencia exacta → inmediata)
// ─────────────────────────────────────────────────────────────────────────────

async function processCancellation(
  admin: AdminClient,
  eventId: string,
  ev: ReservationEvent,
): Promise<IngestResult> {
  const orgId = ev.organizationId;
  const ref = ev.confirmationCode ?? ev.icalUid;
  if (!ref) return { outcome: "needs_review" };

  // 1) reserva canónica
  const reservation = await findReservation(admin, ev);

  // 2) referencia externa registrada
  let bookingId = reservation?.booking_id ?? null;
  if (!bookingId) {
    const { data: refRow } = await admin
      .from("booking_external_refs")
      .select("booking_id")
      .eq("organization_id", orgId)
      .eq("channel", ev.channel)
      .eq("ref_value", normalizeRef(ev.channel, ref))
      .limit(1)
      .maybeSingle();
    bookingId = refRow?.booking_id ?? null;
  }

  // 3) legacy: bookings.external_id directo
  if (!bookingId) {
    const { data: legacy } = await admin
      .from("bookings")
      .select("id")
      .eq("organization_id", orgId)
      .eq("source", ev.channel)
      .eq("external_id", normalizeRef(ev.channel, ref))
      .limit(1)
      .maybeSingle();
    bookingId = legacy?.id ?? null;
  }

  if (!bookingId && !reservation) {
    const issueId = await openIssue(admin, {
      organizationId: orgId,
      eventId,
      issueType: "cancellation_review",
      severity: "warning",
      title: `Cancelación de ${channelLabel(ev.channel)} sin reserva local`,
      detail: `Llegó una cancelación para la referencia ${ref} pero no existe una reserva local con esa referencia. Verificá si la reserva fue cargada con otro código.`,
      dedupeKey: `cancel_unknown:${ev.channel}:${ref}`,
    });
    return { outcome: "needs_review", issueId };
  }

  if (bookingId) {
    const { data: booking } = await admin
      .from("bookings")
      .select("id, status, check_in_date, check_out_date")
      .eq("id", bookingId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (booking) {
      if (booking.status === "cancelada") {
        // idempotente
      } else if (booking.status === "check_in" || booking.status === "check_out") {
        const issueId = await openIssue(admin, {
          organizationId: orgId,
          eventId,
          reservationId: reservation?.id,
          bookingId,
          issueType: "cancellation_review",
          severity: "critical",
          title: `Cancelación de ${channelLabel(ev.channel)} sobre una estadía en curso`,
          detail: `La OTA canceló la reserva ${ref} pero localmente el huésped ya hizo check-in. No se canceló automáticamente; revisá el caso.`,
          dedupeKey: `cancel_inhouse:${bookingId}`,
        });
        return { outcome: "needs_review", issueId, bookingId };
      } else {
        const { error: cancelErr } = await admin
          .from("bookings")
          .update({
            status: "cancelada",
            cancelled_at: new Date().toISOString(),
            cancelled_reason: `Cancelación recibida de ${channelLabel(ev.channel)} (referencia ${ref})`,
          })
          .eq("id", bookingId)
          .eq("organization_id", orgId);
        if (cancelErr) return { outcome: "error", error: cancelErr.message };
        await notify(admin, {
          organization_id: orgId,
          type: "inbound_booking_cancelled",
          severity: "warning",
          title: `Cancelación en ${channelLabel(ev.channel)}`,
          body: `La reserva ${ref} (${booking.check_in_date} → ${booking.check_out_date}) fue cancelada en la OTA.`,
          ref_type: "booking",
          ref_id: bookingId,
          action_url: `/dashboard/reservas/${bookingId}`,
          dedup_key: `channel_cancel:${bookingId}`,
        });
      }
    }
  }

  if (reservation) {
    await admin
      .from("channel_reservations")
      .update({ external_status: "cancelled", missing_since: null, missing_runs: 0 })
      .eq("id", reservation.id);
  } else if (bookingId) {
    // crea la reserva canónica retroactivamente para trazabilidad
    await admin.from("channel_reservations").insert({
      organization_id: orgId,
      channel: ev.channel,
      booking_id: bookingId,
      external_status: "cancelled",
      confirmation_code: ev.confirmationCode ?? null,
      ical_uid: ev.icalUid ?? null,
    });
  }

  return { outcome: "cancelled", bookingId: bookingId ?? undefined, reservationId: reservation?.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de resolución
// ─────────────────────────────────────────────────────────────────────────────

async function findReservation(
  admin: AdminClient,
  ev: ReservationEvent,
): Promise<ChannelReservationRow | null> {
  let byCode: ChannelReservationRow | null = null;
  let byUid: ChannelReservationRow | null = null;

  if (ev.confirmationCode) {
    const { data } = await admin
      .from("channel_reservations")
      .select("*")
      .eq("organization_id", ev.organizationId)
      .eq("channel", ev.channel)
      .eq("confirmation_code", normalizeRef(ev.channel, ev.confirmationCode))
      .maybeSingle();
    byCode = (data as ChannelReservationRow | null) ?? null;
  }
  if (ev.linkId && ev.icalUid) {
    const { data } = await admin
      .from("channel_reservations")
      .select("*")
      .eq("link_id", ev.linkId)
      .eq("ical_uid", ev.icalUid)
      .maybeSingle();
    byUid = (data as ChannelReservationRow | null) ?? null;
  }

  if (byCode && byUid && byCode.id !== byUid.id) {
    // La misma reserva física vista por dos transportes → fusionar en una.
    return mergeReservations(admin, byCode, byUid);
  }
  if (byCode) return byCode;
  if (byUid) return byUid;

  // Email sin código previo pero con unidad+fechas exactas que matchean UNA
  // reserva iCal existente → es la misma (merge por coincidencia exacta única).
  if (ev.transport === "email" && ev.checkIn && ev.checkOut) {
    const { data: candidates } = await admin
      .from("channel_reservations")
      .select("*")
      .eq("organization_id", ev.organizationId)
      .eq("channel", ev.channel)
      .eq("external_status", "active")
      .eq("check_in", ev.checkIn)
      .eq("check_out", ev.checkOut);
    const list = (candidates ?? []) as ChannelReservationRow[];
    const exact = ev.unitId ? list.filter((r) => r.unit_id === ev.unitId) : list;
    if (exact.length === 1) return exact[0];
  }
  return null;
}

/** Funde dos filas de channel_reservations que representan la misma reserva. */
async function mergeReservations(
  admin: AdminClient,
  a: ChannelReservationRow,
  b: ChannelReservationRow,
): Promise<ChannelReservationRow> {
  // primaria: la que ya tiene booking; si ambas o ninguna, la más antigua
  let primary = a;
  let secondary = b;
  if (!a.booking_id && b.booking_id) {
    primary = b;
    secondary = a;
  } else if (a.booking_id === null && b.booking_id === null && b.created_at < a.created_at) {
    primary = b;
    secondary = a;
  }

  if (primary.booking_id && secondary.booking_id && primary.booking_id !== secondary.booking_id) {
    // dos bookings locales para la misma reserva externa — no borramos nada:
    // incidencia crítica para resolución manual
    await openIssue(admin, {
      organizationId: primary.organization_id,
      reservationId: primary.id,
      bookingId: primary.booking_id,
      issueType: "conflict",
      severity: "critical",
      title: "Reserva externa duplicada en dos reservas locales",
      detail: `La misma reserva de la OTA quedó vinculada a dos reservas locales distintas. Uní o cancelá una de las dos manualmente.`,
      dedupeKey: `dup_booking:${primary.id}:${secondary.id}`,
    });
    return primary;
  }

  const patch: Record<string, unknown> = {
    confirmation_code: primary.confirmation_code ?? secondary.confirmation_code,
    ical_uid: primary.ical_uid ?? secondary.ical_uid,
    link_id: primary.link_id ?? secondary.link_id,
    unit_id: primary.unit_id ?? secondary.unit_id,
    booking_id: primary.booking_id ?? secondary.booking_id,
    guest: { ...secondary.guest, ...primary.guest },
    amounts: { ...secondary.amounts, ...primary.amounts },
    last_seen_at: maxIso(primary.last_seen_at, secondary.last_seen_at),
  };

  // la secundaria se elimina (su historia queda en channel_events); primero
  // limpiamos sus claves únicas para no chocar con la primaria
  await admin
    .from("channel_reservations")
    .update({ confirmation_code: null, ical_uid: null, booking_id: null })
    .eq("id", secondary.id);
  const { data: merged } = await admin
    .from("channel_reservations")
    .update(patch)
    .eq("id", primary.id)
    .select("*")
    .single();
  await admin.from("channel_issues").update({ reservation_id: primary.id }).eq("reservation_id", secondary.id);
  await admin.from("channel_reservations").delete().eq("id", secondary.id);

  return (merged as ChannelReservationRow) ?? { ...primary, ...patch } as ChannelReservationRow;
}

/**
 * Resolución determinista de unidad para eventos de email:
 *   1. referencia externa ya conocida (booking_external_refs)
 *   2. listing id → channel_links.external_listing_id (o ota_listings legacy)
 *   3. única coincidencia exacta org+canal+fechas entre reservas externas
 *   4. única conexión activa del canal en la org
 * Si nada es inequívoco → ambiguous/unmapped (el fuzzy SOLO sugiere).
 */
async function resolveUnitDeterministic(
  admin: AdminClient,
  ev: ReservationEvent,
): Promise<{ unitId: string | null; linkId: string | null; ambiguous: boolean }> {
  const orgId = ev.organizationId;

  // 1) referencia externa conocida
  if (ev.confirmationCode) {
    const { data: refRow } = await admin
      .from("booking_external_refs")
      .select("booking_id, link_id, booking:bookings(unit_id)")
      .eq("organization_id", orgId)
      .eq("channel", ev.channel)
      .eq("ref_value", normalizeRef(ev.channel, ev.confirmationCode))
      .limit(1)
      .maybeSingle();
    const unitId = (refRow?.booking as { unit_id?: string } | null)?.unit_id ?? null;
    if (unitId) return { unitId, linkId: refRow?.link_id ?? null, ambiguous: false };
  }

  // 2) listing id → mapping determinista
  if (ev.listingId) {
    const { data: links } = await admin
      .from("channel_links")
      .select("id, unit_id")
      .eq("organization_id", orgId)
      .eq("channel", ev.channel)
      .eq("external_listing_id", ev.listingId)
      .limit(2);
    if (links && links.length === 1) {
      return { unitId: links[0].unit_id, linkId: links[0].id, ambiguous: false };
    }
    const { data: legacy } = await admin
      .from("ota_listings")
      .select("unit_id")
      .eq("organization_id", orgId)
      .eq("provider", ev.channel)
      .eq("external_listing_id", ev.listingId)
      .eq("active", true)
      .limit(2);
    if (legacy && legacy.length === 1) {
      return { unitId: legacy[0].unit_id, linkId: null, ambiguous: false };
    }
  }

  // 3) única coincidencia exacta por fechas entre reservas externas del canal
  if (ev.checkIn && ev.checkOut) {
    const { data: sameDates } = await admin
      .from("channel_reservations")
      .select("unit_id, link_id")
      .eq("organization_id", orgId)
      .eq("channel", ev.channel)
      .eq("external_status", "active")
      .eq("check_in", ev.checkIn)
      .eq("check_out", ev.checkOut)
      .not("unit_id", "is", null);
    const units = new Set((sameDates ?? []).map((r) => r.unit_id as string));
    if (units.size === 1) {
      const row = (sameDates ?? [])[0];
      return { unitId: row.unit_id as string, linkId: (row.link_id as string) ?? null, ambiguous: false };
    }
    if (units.size > 1) return { unitId: null, linkId: null, ambiguous: true };
  }

  // 4) única conexión del canal en la org
  const { data: orgLinks } = await admin
    .from("channel_links")
    .select("id, unit_id")
    .eq("organization_id", orgId)
    .eq("channel", ev.channel)
    .in("status", ["active", "draft", "paused"])
    .limit(2);
  if (orgLinks && orgLinks.length === 1) {
    return { unitId: orgLinks[0].unit_id, linkId: orgLinks[0].id, ambiguous: false };
  }

  return { unitId: null, linkId: null, ambiguous: false };
}

/** Fuzzy matching SOLO como sugerencia para resolución manual. */
async function suggestUnits(
  admin: AdminClient,
  ev: ReservationEvent,
): Promise<Array<{ unit_id: string; unit_code: string }>> {
  if (!ev.listingHint) return [];
  try {
    const match = await matchUnit(admin, ev.organizationId, ev.listingHint);
    if (!match) return [];
    return [{ unit_id: match.unitId, unit_code: match.unitCode }];
  } catch {
    return [];
  }
}

interface AdoptableBooking {
  id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  guest_id: string | null;
  is_block: boolean;
  notes: string | null;
  external_id: string | null;
}

/**
 * Única reserva local vigente con la MISMA unidad y fechas exactas, todavía no
 * vinculada a otra reserva externa. Si hay cero o más de una, no se adopta.
 */
async function findAdoptableBooking(
  admin: AdminClient,
  ev: ReservationEvent,
  reservation: ChannelReservationRow,
): Promise<AdoptableBooking | null> {
  if (!reservation.unit_id || !reservation.check_in || !reservation.check_out) return null;
  const { data: candidates } = await admin
    .from("bookings")
    .select("id, status, check_in_date, check_out_date, guest_id, is_block, notes, external_id")
    .eq("organization_id", ev.organizationId)
    .eq("unit_id", reservation.unit_id)
    .eq("check_in_date", reservation.check_in)
    .eq("check_out_date", reservation.check_out)
    .eq("is_block", false)
    .in("status", ["pendiente", "confirmada", "check_in"]);
  const list = (candidates ?? []) as AdoptableBooking[];
  if (list.length !== 1) return null;
  const candidate = list[0];
  const { data: alreadyLinked } = await admin
    .from("channel_reservations")
    .select("id")
    .eq("booking_id", candidate.id)
    .neq("id", reservation.id)
    .limit(1)
    .maybeSingle();
  if (alreadyLinked) return null;
  return candidate;
}

async function findLegacyBooking(
  admin: AdminClient,
  ev: ReservationEvent,
  reservation: ChannelReservationRow,
): Promise<string | null> {
  const refs = [reservation.confirmation_code, reservation.ical_uid].filter(Boolean) as string[];
  for (const ref of refs) {
    const { data } = await admin
      .from("bookings")
      .select("id")
      .eq("organization_id", ev.organizationId)
      .eq("source", ev.channel)
      .eq("external_id", ref)
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }
  return null;
}

async function addExternalRefs(
  admin: AdminClient,
  ev: ReservationEvent,
  reservation: ChannelReservationRow,
  bookingId: string,
): Promise<void> {
  const rows: Array<{ ref_type: string; ref_value: string }> = [];
  if (reservation.confirmation_code) {
    rows.push({
      ref_type: ev.channel === "booking" ? "reservation_number" : "confirmation_code",
      ref_value: reservation.confirmation_code,
    });
  }
  if (reservation.ical_uid) {
    rows.push({ ref_type: "ical_uid", ref_value: reservation.ical_uid });
  }
  for (const r of rows) {
    const { error } = await admin.from("booking_external_refs").insert({
      organization_id: ev.organizationId,
      booking_id: bookingId,
      channel: ev.channel,
      link_id: reservation.link_id,
      ...r,
    });
    if (error && error.code !== "23505") {
      console.error("[channels/ingest] ref insert falló", error.message);
    }
  }
}

/**
 * Enlaza/crea el huésped para un booking YA proyectado. Devuelve true si
 * cambió algo. Nunca crea huéspedes para nombres genéricos ni para bloqueos.
 */
async function linkGuestIfPossible(
  admin: AdminClient,
  orgId: string,
  bookingId: string,
  reservation: ChannelReservationRow,
  currentGuestId: string | null,
): Promise<boolean> {
  if (currentGuestId) return false; // no pisamos asignaciones existentes
  const g = reservation.guest ?? {};
  if (!g.name && !g.email && !g.phone && !g.phone_raw) return false;
  try {
    const resolved = await resolveGuest(admin, orgId, {
      name: g.name,
      email: g.email,
      phone: g.phone ?? g.phone_raw,
    });
    if (!resolved.guestId) return false;
    const { error } = await admin
      .from("bookings")
      .update({ guest_id: resolved.guestId })
      .eq("id", bookingId)
      .eq("organization_id", orgId)
      .is("guest_id", null);
    return !error;
  } catch (err) {
    console.error("[channels/ingest] guest link falló", (err as Error).message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Incidencias y notificaciones
// ─────────────────────────────────────────────────────────────────────────────

export async function openIssue(
  admin: AdminClient,
  input: {
    organizationId: string;
    linkId?: string | null;
    eventId?: string | null;
    reservationId?: string | null;
    bookingId?: string | null;
    issueType: ChannelIssueType;
    severity: "info" | "warning" | "critical";
    title: string;
    detail?: string;
    suggested?: Record<string, unknown>;
    dedupeKey?: string;
  },
): Promise<string | undefined> {
  const { data, error } = await admin
    .from("channel_issues")
    .insert({
      organization_id: input.organizationId,
      link_id: input.linkId ?? null,
      event_id: input.eventId ?? null,
      reservation_id: input.reservationId ?? null,
      booking_id: input.bookingId ?? null,
      issue_type: input.issueType,
      severity: input.severity,
      title: input.title,
      detail: input.detail ?? null,
      suggested: input.suggested ?? {},
      dedupe_key: input.dedupeKey ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return undefined; // ya hay una abierta igual
    console.error("[channels/issues] insert falló", error.message);
    return undefined;
  }
  return data?.id;
}

export async function resolveIssuesByDedupe(
  admin: AdminClient,
  orgId: string,
  dedupeKey: string,
  resolution: string,
): Promise<void> {
  await admin
    .from("channel_issues")
    .update({ status: "resolved", resolution, resolved_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("dedupe_key", dedupeKey)
    .eq("status", "open");
}

async function notify(
  admin: AdminClient,
  n: {
    organization_id: string;
    type: string;
    severity: "info" | "warning" | "critical";
    title: string;
    body?: string;
    ref_type?: string;
    ref_id?: string;
    action_url?: string;
    dedup_key?: string;
  },
): Promise<void> {
  const { error } = await admin.from("notifications").insert({ ...n, target_role: "admin" });
  if (error && error.code !== "23505") {
    console.error("[channels/notify]", error.message);
  }
}

async function touchLinkActivity(admin: AdminClient, linkId: string | null): Promise<void> {
  if (!linkId) return;
  await admin
    .from("channel_links")
    .update({ last_reservation_at: new Date().toISOString() })
    .eq("id", linkId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

export function channelLabel(c: Channel): string {
  return c === "airbnb" ? "Airbnb" : "Booking";
}

function buildUnitIssueDetail(ev: ReservationEvent): string {
  const ref = ev.confirmationCode ?? ev.icalUid ?? "sin referencia";
  const dates = ev.checkIn && ev.checkOut ? ` para ${ev.checkIn} → ${ev.checkOut}` : "";
  const hint = ev.listingHint ? ` El anuncio dice: "${ev.listingHint.slice(0, 80)}".` : "";
  return `Llegó una reserva de ${channelLabel(ev.channel)} (${ref})${dates} pero no se pudo determinar a qué departamento corresponde.${hint} Asigná la unidad para proyectarla al calendario.`;
}

export function normalizeRef(channel: Channel, ref: string): string {
  const r = ref.trim();
  return channel === "airbnb" ? r.toUpperCase() : r;
}

function sanitizeGuest(ev: ReservationEvent): Record<string, string> {
  const g = ev.guest ?? {};
  const out: Record<string, string> = {};
  if (g.name?.trim()) out.name = g.name.trim().slice(0, 120);
  if (g.email?.trim()) out.email = g.email.trim().toLowerCase().slice(0, 200);
  if (g.phone?.trim()) {
    out.phone_raw = g.phone.trim().slice(0, 40);
    const e164 = normalizePhoneE164(g.phone);
    if (e164) out.phone = e164;
  }
  return out;
}

function mergeGuest(
  current: ChannelReservationRow["guest"],
  ev: ReservationEvent,
): Record<string, string> | null {
  const incoming = sanitizeGuest(ev);
  if (Object.keys(incoming).length === 0) return null;
  const merged = { ...current };
  let changed = false;
  for (const [k, v] of Object.entries(incoming)) {
    if (!(merged as Record<string, string>)[k]) {
      (merged as Record<string, string>)[k] = v;
      changed = true;
    }
  }
  return changed ? (merged as Record<string, string>) : null;
}

function minimizePayload(ev: ReservationEvent): Record<string, unknown> {
  // payload minimizado y sin PII innecesaria: no guardamos el raw body
  return {
    transport: ev.transport,
    channel: ev.channel,
    event_type: ev.eventType,
    link_id: ev.linkId ?? null,
    unit_id: ev.unitId ?? null,
    ical_uid: ev.icalUid ?? null,
    confirmation_code: ev.confirmationCode ?? null,
    check_in: ev.checkIn ?? null,
    check_out: ev.checkOut ?? null,
    is_block: ev.isBlock ?? false,
    listing_id: ev.listingId ?? null,
    listing_hint: ev.listingHint?.slice(0, 120) ?? null,
    guest_name: ev.guest?.name?.slice(0, 120) ?? null,
    guest_email: ev.guest?.email?.trim().toLowerCase().slice(0, 200) ?? null,
    guest_phone: ev.guest?.phone?.trim().slice(0, 40) ?? null,
    amounts: ev.amounts ?? null,
  };
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
