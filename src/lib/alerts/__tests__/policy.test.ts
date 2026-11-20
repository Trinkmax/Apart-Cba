import { describe, expect, it } from "vitest";
import {
  issueResolution,
  issueVisibility,
  notificationDismissReason,
  notificationTier,
  type IssueForPolicy,
  type NotificationForPolicy,
} from "@/lib/alerts/policy";

const NOW = new Date("2026-11-13T15:00:00Z");
const TODAY = "2026-11-13";
const opts = { today: TODAY, now: NOW };

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

describe("notificationTier — qué pone rojo el número de la campana", () => {
  it.each([
    ["critical", "accion"],
    ["warning", "accion"],
    ["info", "novedad"],
    ["success", "novedad"],
    [null, "novedad"],
  ] as const)("%s → %s", (severity, tier) => {
    expect(notificationTier(severity)).toBe(tier);
  });
});

describe("notificationDismissReason", () => {
  const base: NotificationForPolicy = {
    type: "other",
    severity: "info",
    ref_type: null,
    dedup_key: null,
    created_at: hoursAgo(1),
  };

  it("una novedad se archiva sola a la semana", () => {
    expect(notificationDismissReason({ ...base, created_at: hoursAgo(24 * 8) }, {}, opts)).toBe(
      "novedad_vencida",
    );
    expect(notificationDismissReason({ ...base, created_at: hoursAgo(24 * 2) }, {}, opts)).toBeNull();
  });

  it("un recordatorio manual no vence solo, y uno con fecha espera a que pase", () => {
    expect(
      notificationDismissReason(
        { ...base, type: "manual", created_at: hoursAgo(24 * 40) },
        {},
        opts,
      ),
    ).toBeNull();
    const seguro = { ...base, type: "rental_expiring", created_at: hoursAgo(24 * 40) };
    expect(
      notificationDismissReason({ ...seguro, due_at: "2026-11-30T12:00:00Z" }, {}, opts),
    ).toBeNull();
    expect(
      notificationDismissReason({ ...seguro, due_at: "2026-11-01T12:00:00Z" }, {}, opts),
    ).toBe("novedad_vencida");
  });

  it("lo que pide acción NO vence por edad", () => {
    expect(
      notificationDismissReason(
        { ...base, severity: "critical", created_at: hoursAgo(24 * 30) },
        {},
        opts,
      ),
    ).toBeNull();
  });

  it("'Limpieza programada' se va cuando la limpieza se hizo o el día pasó", () => {
    const n = { ...base, type: "task_reminder", ref_type: "cleaning_task" };
    expect(
      notificationDismissReason(n, { cleaningTask: { status: "verificada", scheduledYmd: TODAY } }, opts),
    ).toBe("limpieza_cerrada");
    expect(
      notificationDismissReason(n, { cleaningTask: { status: "pendiente", scheduledYmd: "2026-11-12" } }, opts),
    ).toBe("limpieza_pasada");
    expect(
      notificationDismissReason(n, { cleaningTask: { status: "pendiente", scheduledYmd: TODAY } }, opts),
    ).toBeNull();
    expect(notificationDismissReason(n, { cleaningTask: null }, opts)).toBe("limpieza_inexistente");
  });

  it("'Nueva reserva' se va cuando el huésped ya llegó o se canceló", () => {
    const n = { ...base, type: "inbound_booking_pending", ref_type: "booking" };
    expect(
      notificationDismissReason(n, { booking: { status: "confirmada", checkInYmd: "2026-11-12" } }, opts),
    ).toBe("reserva_ya_llego");
    expect(
      notificationDismissReason(n, { booking: { status: "cancelada", checkInYmd: "2026-11-20" } }, opts),
    ).toBe("reserva_cancelada");
    expect(
      notificationDismissReason(n, { booking: { status: "confirmada", checkInYmd: "2026-11-20" } }, opts),
    ).toBeNull();
  });

  it("los avisos de cuotas se van al cobrarse o si la reserva se canceló", () => {
    const due = { ...base, type: "payment_due", severity: "warning", ref_type: "booking_payment_schedule" };
    const overdue = { ...due, type: "payment_overdue", severity: "critical" };
    expect(
      notificationDismissReason(due, { paymentSchedule: { status: "paid", bookingStatus: "confirmada" } }, opts),
    ).toBe("cuota_cerrada");
    expect(
      notificationDismissReason(overdue, { paymentSchedule: { status: "overdue", bookingStatus: "cancelada" } }, opts),
    ).toBe("reserva_cancelada");
    expect(
      notificationDismissReason(due, { paymentSchedule: { status: "overdue", bookingStatus: "check_in" } }, opts),
    ).toBe("cuota_vencida_avisada");
    // Una cuota vencida de verdad sigue avisando.
    expect(
      notificationDismissReason(overdue, { paymentSchedule: { status: "overdue", bookingStatus: "check_in" } }, opts),
    ).toBeNull();
  });

  it("los avisos de canales se van cuando se resolvió lo que pedían", () => {
    expect(
      notificationDismissReason(
        { ...base, type: "channel_request_pending", severity: "critical" },
        { channelReservation: { externalStatus: "active" } },
        opts,
      ),
    ).toBe("solicitud_resuelta");
    expect(
      notificationDismissReason(
        { ...base, type: "inbound_booking_conflict", severity: "critical" },
        { conflictStillOpen: false },
        opts,
      ),
    ).toBe("conflicto_resuelto");
    expect(
      notificationDismissReason(
        { ...base, type: "channel_cancellation_pending", severity: "warning" },
        { cancellationRequestPending: true },
        opts,
      ),
    ).toBeNull();
    expect(
      notificationDismissReason(
        { ...base, severity: "warning", dedup_key: "gmail_forwarding:abc" },
        { emailForwardingVerified: true },
        opts,
      ),
    ).toBe("reenvio_confirmado");
  });

  it("una cuota 'vencida' de una reserva cobrada entera no es una deuda", () => {
    const overdue = {
      ...base,
      type: "payment_overdue",
      severity: "critical",
      ref_type: "booking_payment_schedule",
    };
    expect(
      notificationDismissReason(
        overdue,
        { paymentSchedule: { status: "overdue", bookingStatus: "check_out", bookingPaid: true } },
        opts,
      ),
    ).toBe("reserva_pagada");
    expect(
      notificationDismissReason(
        overdue,
        { paymentSchedule: { status: "overdue", bookingStatus: "check_out", bookingPaid: false } },
        opts,
      ),
    ).toBeNull();
  });

  it("'se canceló en la OTA' informa algo que ya pasó: vence a la semana", () => {
    const n = { ...base, type: "inbound_booking_cancelled", severity: "warning" };
    expect(notificationDismissReason({ ...n, created_at: hoursAgo(24 * 8) }, {}, opts)).toBe("aviso_vencido");
    expect(notificationDismissReason({ ...n, created_at: hoursAgo(24 * 2) }, {}, opts)).toBeNull();
  });

  it("'dada por confirmada' deja de pedir verificación cuando la llegada pasó", () => {
    const n = { ...base, type: "channel_request_auto_confirmed", severity: "warning" };
    expect(
      notificationDismissReason(n, { autoConfirmedReservation: { externalStatus: "active", checkInYmd: "2026-11-10" } }, opts),
    ).toBe("verificacion_vencida");
    expect(
      notificationDismissReason(n, { autoConfirmedReservation: { externalStatus: "active", checkInYmd: "2026-11-20" } }, opts),
    ).toBeNull();
  });

  it("un pedido de la web se va cuando se respondió", () => {
    const n = { ...base, type: "other", severity: "warning", ref_type: "booking_request" };
    expect(
      notificationDismissReason(n, { bookingRequest: { status: "aprobada", checkInYmd: "2026-12-04" } }, opts),
    ).toBe("pedido_resuelto");
    expect(
      notificationDismissReason(n, { bookingRequest: { status: "pendiente", checkInYmd: "2026-12-04" } }, opts),
    ).toBeNull();
  });

  it("sin hechos no decide nada (no archiva a ciegas)", () => {
    expect(
      notificationDismissReason(
        { ...base, type: "payment_overdue", severity: "critical", ref_type: "booking_payment_schedule" },
        {},
        opts,
      ),
    ).toBeNull();
  });
});

describe("issueVisibility — el margen antes de mostrar", () => {
  const issue = (key: string, hours: number): IssueForPolicy => ({
    issue_type: "x",
    dedupe_key: key,
    created_at: hoursAgo(hours),
  });

  it("'sin unidad' espera 30 minutos a que llegue el iCal", () => {
    expect(issueVisibility(issue("unit:airbnb:HMX", 0.2), NOW)).toBe("esperando");
    expect(issueVisibility(issue("unit:airbnb:HMX", 0.6), NOW)).toBe("visible");
  });

  it("un feed que falla se muestra recién si dura 2 horas", () => {
    expect(issueVisibility(issue("feed:link-1", 1), NOW)).toBe("esperando");
    expect(issueVisibility(issue("feed:link-1", 3), NOW)).toBe("visible");
  });

  it("'desapareció del calendario' es seguimiento, nunca 'para resolver'", () => {
    expect(issueVisibility(issue("missing:res-1", 48), NOW)).toBe("seguimiento");
  });

  it("un conflicto se muestra en el acto", () => {
    expect(issueVisibility(issue("conflict:res-1", 0), NOW)).toBe("visible");
  });
});

describe("issueResolution — se cierra sola cuando deja de ser verdad", () => {
  const issue = (key: string, hours = 1): IssueForPolicy => ({
    issue_type: "x",
    dedupe_key: key,
    created_at: hoursAgo(hours),
  });

  it("un mail que no es una reserva se archiva; uno que sí, queda", () => {
    expect(
      issueResolution(
        issue("email_unparsed:1"),
        { emailSubject: "RE: Reserva de «Depto», 12–13 nov" },
        opts,
      ),
    ).toMatch(/no era una reserva/);
    expect(
      issueResolution(
        issue("email_unparsed:2"),
        { emailSubject: "Reserva confirmada: Ana llega el 20 nov." },
        opts,
      ),
    ).toBeNull();
  });

  it("'sin unidad' se cierra cuando la reserva aparece en el calendario", () => {
    expect(issueResolution(issue("unit:airbnb:HMX"), { codeOnReservationWithUnit: true }, opts)).toMatch(
      /ya está en el calendario/,
    );
    expect(issueResolution(issue("unit:airbnb:HMX"), { codeOnReservationWithUnit: false }, opts)).toBeNull();
  });

  it("los problemas de conexión se cierran cuando la conexión vuelve", () => {
    const healthy = {
      status: "active",
      consecutiveFailures: 0,
      lastSuccessAt: hoursAgo(0.1),
      anomalousEmpty: false,
    };
    expect(issueResolution(issue("feed:l1"), { link: healthy }, opts)).toMatch(/volvió a funcionar/);
    expect(
      issueResolution(issue("feed:l1"), { link: { ...healthy, consecutiveFailures: 4 } }, opts),
    ).toBeNull();
    expect(issueResolution(issue("stale:l1"), { link: { ...healthy, status: "paused" } }, opts)).toMatch(
      /pausada/,
    );
    expect(issueResolution(issue("feed:l1"), { link: null }, opts)).toMatch(/ya no existe/);
    // «Está cargado el enlace de rentOS»: se cierra cuando la conexión lee bien.
    expect(issueResolution(issue("own_feed:l1"), { link: healthy }, opts)).toMatch(/volvió a funcionar/);
    // «La OTA dio de baja el enlace»: se cierra cuando el enlace nuevo ya se lee,
    // y se muestra en el momento (no es un fallo pasajero).
    expect(issueResolution(issue("feed_gone:l1"), { link: healthy }, opts)).toMatch(/volvió a funcionar/);
    expect(
      issueResolution(issue("feed_gone:l1"), { link: { ...healthy, consecutiveFailures: 6 } }, opts),
    ).toBeNull();
    expect(issueVisibility(issue("feed_gone:l1", 1), NOW)).toBe("visible");
    expect(
      issueResolution(issue("own_feed:l1"), { link: { ...healthy, consecutiveFailures: 44 } }, opts),
    ).toBeNull();
  });

  // «La OTA no lee tu calendario» (JARDINES, Viaggiato): que NOSOTROS leamos
  // bien el de ella no lo cierra; sólo que ella vuelva a leer el nuestro.
  it("la OTA que no leía se cierra cuando vuelve a leer, no porque la conexión esté sana", () => {
    const link = {
      status: "active",
      consecutiveFailures: 0,
      lastSuccessAt: hoursAgo(0.1),
      anomalousEmpty: false,
    };
    expect(
      issueResolution(issue("export_stale:l1"), { link: { ...link, lastExportAccessAt: hoursAgo(24 * 13) } }, opts),
    ).toBeNull();
    expect(
      issueResolution(issue("export_stale:l1"), { link: { ...link, lastExportAccessAt: null } }, opts),
    ).toBeNull();
    expect(
      issueResolution(issue("export_stale:l1"), { link: { ...link, lastExportAccessAt: hoursAgo(2) } }, opts),
    ).toMatch(/volvió a leer/);
    expect(
      issueResolution(issue("export_stale:l1"), { link: { ...link, status: "paused" } }, opts),
    ).toMatch(/pausada/);
    expect(issueResolution(issue("export_stale:l1"), { link: null }, opts)).toMatch(/ya no existe/);
  });

  it("el feed vacío se cierra si volvió a traer eventos o no queda nada que proteger", () => {
    const empty = { status: "active", consecutiveFailures: 0, lastSuccessAt: hoursAgo(0.1), anomalousEmpty: true };
    expect(
      issueResolution(issue("empty_feed:l1"), { link: empty, linkActiveFutureReservations: 0 }, opts),
    ).toMatch(/que proteger/);
    expect(
      issueResolution(issue("empty_feed:l1"), { link: empty, linkActiveFutureReservations: 2 }, opts),
    ).toBeNull();
    expect(
      issueResolution(issue("empty_feed:l1"), { link: { ...empty, anomalousEmpty: false } }, opts),
    ).toMatch(/volvió a traer/);
  });

  it("un conflicto operativo con fechas pasadas se cierra", () => {
    expect(issueResolution(issue("conflict:r1"), { stayEndYmd: "2026-11-06" }, opts)).toMatch(/ya pasaron/);
    expect(issueResolution(issue("reappeared:r1"), { stayEndYmd: TODAY }, opts)).toBeNull();
  });

  it("una reserva duplicada en el sistema NO se cierra por fecha (pesa en la liquidación)", () => {
    expect(issueResolution(issue("dup_booking:a:b"), { stayEndYmd: "2026-10-01" }, opts)).toBeNull();
  });

  it("un cierre de fechas no necesita a nadie", () => {
    expect(issueResolution(issue("reappeared:r1"), { isBlock: true, stayEndYmd: "2028-05-13" }, opts)).toMatch(
      /cierre de fechas/,
    );
  });

  it("la marca de la ventana de Booking que entró como reserva se cierra", () => {
    // BRASIL (Apart CBA, ago): 183 noches a un año vista.
    expect(
      issueResolution(
        issue("reappeared:r1"),
        { channel: "booking", stayStartYmd: "2027-08-20", stayEndYmd: "2028-02-19", reservationSeenYmd: "2026-08-19" },
        opts,
      ),
    ).toMatch(/borde del calendario de Booking/);
    // COF II (Habitana): una noche a 518 días.
    expect(
      issueResolution(
        issue("reappeared:r2"),
        { channel: "booking", stayStartYmd: "2028-03-02", stayEndYmd: "2028-03-03", reservationSeenYmd: "2026-10-01" },
        opts,
      ),
    ).toMatch(/borde del calendario de Booking/);
    // Una reserva real de Booking que volvió a aparecer sigue pidiendo revisión.
    expect(
      issueResolution(
        issue("reappeared:r3"),
        { channel: "booking", stayStartYmd: "2026-12-05", stayEndYmd: "2026-12-09", reservationSeenYmd: "2026-10-24" },
        opts,
      ),
    ).toBeNull();
    // Airbnb sí tiene estadías largas reales.
    expect(
      issueResolution(
        issue("reappeared:r4"),
        { channel: "airbnb", stayStartYmd: "2027-08-20", stayEndYmd: "2028-02-19", reservationSeenYmd: "2026-08-19" },
        opts,
      ),
    ).toBeNull();
  });

  it("una cancelación sin reserva en el sistema vence a los 3 días", () => {
    expect(issueResolution(issue("cancel_unknown:booking:123", 24 * 4), {}, opts)).toMatch(/Venció/);
    expect(issueResolution(issue("cancel_unknown:booking:123", 24), {}, opts)).toBeNull();
  });
});
