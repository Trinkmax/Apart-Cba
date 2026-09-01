import { beforeEach, describe, expect, it } from "vitest";
import {
  appliesToLink,
  channelsHoldingAvailability,
  channelsExportedAsHolds,
  getChannelRequestPolicies,
  invalidateChannelRequestPolicyCache,
  readChannelRequestPolicies,
  ttlHoursFor,
} from "@/lib/channels/request-policy";

/**
 * La política decide si una reserva de OTA nace como SOLICITUD (sin fila en
 * `bookings`) o se proyecta como siempre. Equivocarse hacia "encendido" deja
 * reservas reales invisibles, así que todo default y todo error tiene que caer
 * del lado de apagado.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeAdmin(config: unknown, opts: { throws?: boolean } = {}): any {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  if (opts.throws) throw new Error("supabase caído");
                  return { data: config === undefined ? null : { config } };
                },
              };
            },
          };
        },
      };
    },
  };
}

const FULL = {
  requests: {
    airbnb: {
      enabled: true,
      hold_availability: false,
      ttl_hours: 26,
      ttl_hours_urgent: 3,
      urgent_days: 2,
      only_link_ids: [],
      exclude_link_ids: [],
    },
    booking: {
      enabled: true,
      hold_availability: true,
      ttl_hours: 26,
      ttl_hours_urgent: 3,
      urgent_days: 2,
      only_link_ids: [],
      exclude_link_ids: [],
    },
  },
};

describe("getChannelRequestPolicies", () => {
  beforeEach(() => invalidateChannelRequestPolicyCache());

  it("una org sin fila en channel_settings queda apagada", async () => {
    const p = await getChannelRequestPolicies(fakeAdmin(undefined), "org-sin-settings");
    expect(p.airbnb.enabled).toBe(false);
    expect(p.booking.enabled).toBe(false);
  });

  it("una org con config pero sin la clave `requests` queda apagada", async () => {
    const p = await getChannelRequestPolicies(fakeAdmin({ conflict_alerts: true }), "org-vieja");
    expect(p.airbnb.enabled).toBe(false);
  });

  it("si la lectura falla, las políticas quedan apagadas PERO se marca el fallo", async () => {
    // Distinguirlas es crítico: tratar "no pude leer" como "apagada" hace que
    // el dispatcher drene todas las solicitudes en vuelo a `bookings`.
    const r = await readChannelRequestPolicies(fakeAdmin(FULL, { throws: true }), "org-caida");
    expect(r.failed).toBe(true);
    expect(r.policies.airbnb.enabled).toBe(false);
  });

  it("una lectura exitosa NO marca fallo", async () => {
    const r = await readChannelRequestPolicies(fakeAdmin(FULL), "org-ok-flag");
    expect(r.failed).toBe(false);
    expect(r.policies.airbnb.enabled).toBe(true);
  });

  it("una org sin fila tampoco marca fallo (es una respuesta válida)", async () => {
    const r = await readChannelRequestPolicies(fakeAdmin(undefined), "org-vacia");
    expect(r.failed).toBe(false);
    expect(r.policies.airbnb.enabled).toBe(false);
  });

  it("lee la política de cada canal por separado", async () => {
    const p = await getChannelRequestPolicies(fakeAdmin(FULL), "org-ok");
    expect(p.airbnb.enabled).toBe(true);
    expect(p.airbnb.holdAvailability).toBe(false);
    expect(p.booking.holdAvailability).toBe(true);
    expect(p.airbnb.ttlHours).toBe(26);
  });

  it("valores basura no rompen: se usan los defaults", async () => {
    const p = await getChannelRequestPolicies(
      fakeAdmin({ requests: { airbnb: { enabled: true, ttl_hours: "muchas", urgent_days: -3 } } }),
      "org-basura",
    );
    expect(p.airbnb.enabled).toBe(true);
    expect(p.airbnb.ttlHours).toBe(26);
    expect(p.airbnb.urgentDays).toBe(2);
  });
});

describe("appliesToLink", () => {
  const base = {
    enabled: true,
    holdAvailability: false,
    ttlHours: 26,
    ttlHoursUrgent: 3,
    urgentDays: 2,
    onlyLinkIds: [] as string[],
    excludeLinkIds: [] as string[],
  };

  it("apagada nunca aplica", () => {
    expect(appliesToLink({ ...base, enabled: false }, "link-1")).toBe(false);
  });

  it("sin lista de canary aplica a todas", () => {
    expect(appliesToLink(base, "link-1")).toBe(true);
  });

  it("con canary, sólo a las de la lista", () => {
    const p = { ...base, onlyLinkIds: ["link-1"] };
    expect(appliesToLink(p, "link-1")).toBe(true);
    expect(appliesToLink(p, "link-2")).toBe(false);
    // Un evento sin conexión (llegó por email) no puede estar en el canary.
    expect(appliesToLink(p, null)).toBe(false);
  });

  it("la exclusión gana sobre todo", () => {
    expect(appliesToLink({ ...base, excludeLinkIds: ["link-1"] }, "link-1")).toBe(false);
  });
});

describe("ttlHoursFor", () => {
  const p = {
    enabled: true,
    holdAvailability: false,
    ttlHours: 26,
    ttlHoursUrgent: 3,
    urgentDays: 2,
    onlyLinkIds: [],
    excludeLinkIds: [],
  };

  it("llegada lejana usa el umbral largo", () => {
    expect(ttlHoursFor(p, 30)).toBe(26);
  });

  it("llegada inminente usa el corto", () => {
    expect(ttlHoursFor(p, 1)).toBe(3);
    expect(ttlHoursFor(p, 0)).toBe(3);
    // Una llegada ya pasada también es urgente.
    expect(ttlHoursFor(p, -1)).toBe(3);
  });

  it("sin fecha de llegada usa el largo (no asume urgencia)", () => {
    expect(ttlHoursFor(p, null)).toBe(26);
  });
});

describe("channelsExportedAsHolds", () => {
  const on = {
    enabled: true,
    holdAvailability: false,
    ttlHours: 26,
    ttlHoursUrgent: 3,
    urgentDays: 2,
    onlyLinkIds: [],
    excludeLinkIds: [],
  };

  it("exporta aunque hold_availability sea false", () => {
    // "No cierro MI calendario" no puede significar "dejo de bloquear a la otra
    // OTA": ahí termina en venta doble.
    expect(channelsExportedAsHolds({ airbnb: on, booking: { ...on, enabled: false } })).toEqual([
      "airbnb",
    ]);
  });

  it("no exporta nada si la política está apagada", () => {
    expect(
      channelsExportedAsHolds({
        airbnb: { ...on, enabled: false },
        booking: { ...on, enabled: false },
      }),
    ).toEqual([]);
  });
});

describe("channelsHoldingAvailability", () => {
  it("sólo devuelve canales encendidos con retención", () => {
    const on = {
      enabled: true,
      holdAvailability: true,
      ttlHours: 26,
      ttlHoursUrgent: 3,
      urgentDays: 2,
      onlyLinkIds: [],
      excludeLinkIds: [],
    };
    expect(
      channelsHoldingAvailability({ airbnb: { ...on, holdAvailability: false }, booking: on }),
    ).toEqual(["booking"]);
    // Retención declarada pero canal apagado = no retiene nada.
    expect(
      channelsHoldingAvailability({ airbnb: { ...on, enabled: false }, booking: { ...on, enabled: false } }),
    ).toEqual([]);
  });
});
