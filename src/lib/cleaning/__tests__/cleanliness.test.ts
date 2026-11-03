import { describe, expect, it } from "vitest";
import {
  cleanlinessHint,
  computeCleanlinessByUnit,
  computeUnitCleanliness,
  isStayContinuation,
  taskCoversCheckout,
  uncoveredCheckouts,
  type CleanlinessStay,
  type CleanlinessTask,
} from "../cleanliness";

const TODAY = "2026-11-01";
const TOMORROW = "2026-11-02";
const UNIT = "unit-1";

let seq = 0;
function stay(
  checkIn: string,
  checkOut: string,
  overrides: Partial<CleanlinessStay> = {},
): CleanlinessStay {
  seq += 1;
  return {
    id: `stay-${seq}`,
    unit_id: UNIT,
    status: "check_in",
    check_in_date: checkIn,
    check_out_date: checkOut,
    guest_id: `guest-${seq}`,
    lease_group_id: null,
    ...overrides,
  };
}

function task(date: string, overrides: Partial<CleanlinessTask> = {}): CleanlinessTask {
  seq += 1;
  return {
    id: `task-${seq}`,
    unit_id: UNIT,
    status: "pendiente",
    scheduled_date: date,
    booking_out_id: null,
    ...overrides,
  };
}

function compute(
  tasks: CleanlinessTask[],
  stays: CleanlinessStay[],
  { today = TODAY, unitStatus = "ocupado" as const }: { today?: string; unitStatus?: "ocupado" | "limpieza" | "disponible" } = {},
) {
  return computeUnitCleanliness({ unitStatus, tasks, stays, today });
}

describe("aviso del día anterior", () => {
  it("prende el día anterior a la salida, con el huésped todavía adentro", () => {
    const s = stay("2026-10-29", TOMORROW);
    expect(compute([task(TOMORROW, { booking_out_id: s.id })], [s])?.due).toBe("tomorrow");
  });

  it("no depende de que el cron haya creado la tarea", () => {
    // Una noche cargada a la tarde: la tarea recién aparece a la medianoche.
    expect(compute([], [stay(TODAY, TOMORROW)])?.due).toBe("tomorrow");
  });

  it("no avisa con dos días de anticipación", () => {
    expect(compute([], [stay("2026-10-29", "2026-11-03")])).toBeNull();
  });

  it("el día de la salida pasa a 'hoy', sin esperar que marquen el check-out", () => {
    const s = stay("2026-10-29", TODAY);
    expect(compute([task(TODAY, { booking_out_id: s.id })], [s])?.due).toBe("today");
  });

  it("con el check-out marcado ya es 'ahora'", () => {
    const s = stay("2026-10-01", TODAY, { status: "check_out" });
    expect(compute([task(TODAY, { booking_out_id: s.id })], [s])?.due).toBe("now");
  });

  it("gana lo más urgente", () => {
    const hoy = stay("2026-10-29", TODAY);
    const manana = stay(TODAY, TOMORROW);
    expect(
      compute(
        [task(TODAY, { booking_out_id: hoy.id }), task(TOMORROW, { booking_out_id: manana.id })],
        [hoy, manana],
      )?.due,
    ).toBe("today");
  });
});

describe("reservas pendientes (bug SAL525, 30/10/2026)", () => {
  it("una reserva 'pendiente' que sale avisa aunque no tenga tarea", () => {
    const s = stay("2026-10-29", TODAY, { status: "pendiente" });
    expect(compute([], [s], { unitStatus: "disponible" })?.due).toBe("today");
  });
});

describe("renovaciones y tramos: nadie se va", () => {
  it("mismo contrato: no avisa aunque haya ticket abierto", () => {
    // AMBRO: 03/10→02/11 sigue 02/11→02/12, con ticket pendiente del cron.
    const prev = stay("2026-10-03", TOMORROW, { guest_id: "g", lease_group_id: "lease" });
    const next = stay(TOMORROW, "2026-12-02", {
      guest_id: "g",
      lease_group_id: "lease",
      status: "confirmada",
    });
    expect(compute([task(TOMORROW, { booking_out_id: prev.id })], [prev, next])).toBeNull();
  });

  it("mismo huésped sin contrato: renovó con una reserva nueva", () => {
    const prev = stay("2026-10-20", TODAY, { guest_id: "g" });
    const next = stay(TODAY, "2026-11-05", { guest_id: "g" });
    expect(compute([task(TODAY, { booking_out_id: prev.id })], [prev, next])).toBeNull();
  });

  it("si el tramo siguiente se cancela, la salida vuelve a avisar", () => {
    const prev = stay("2026-10-03", TOMORROW, { guest_id: "g", lease_group_id: "lease" });
    expect(compute([], [prev])?.due).toBe("tomorrow");
  });

  it("otro huésped el mismo día es un recambio real", () => {
    const prev = stay("2026-10-29", TODAY, { guest_id: "a" });
    const next = stay(TODAY, "2026-11-05", { guest_id: "b", status: "confirmada" });
    expect(compute([task(TODAY, { booking_out_id: prev.id })], [prev, next])?.due).toBe("today");
  });

  it("sin huésped cargado (OTA) no se asume continuación", () => {
    const prev = stay("2026-10-29", TODAY, { guest_id: null });
    const next = stay(TODAY, "2026-11-05", { guest_id: null });
    expect(isStayContinuation(prev, next)).toBe(false);
  });

  it("exige que entre el mismo día: un hueco es una salida real", () => {
    const prev = stay("2026-10-20", TODAY, { guest_id: "g" });
    const next = stay(TOMORROW, "2026-11-05", { guest_id: "g" });
    expect(isStayContinuation(prev, next)).toBe(false);
    expect(compute([], [prev, next])?.due).toBe("today");
  });

  it("exige la misma unidad", () => {
    const prev = stay("2026-10-20", TODAY, { guest_id: "g" });
    const next = stay(TODAY, "2026-11-05", { guest_id: "g", unit_id: "otra" });
    expect(isStayContinuation(prev, next)).toBe(false);
  });

  it("extender la reserva apaga el aviso: la tarea se movió con ella", () => {
    const s = stay("2026-10-20", "2026-11-20");
    expect(compute([task("2026-11-20", { booking_out_id: s.id })], [s])).toBeNull();
  });
});

describe("la decisión de una persona manda", () => {
  it("marcar limpio el día anterior se sostiene el día de la salida", () => {
    const s = stay("2026-10-20", TOMORROW);
    const cerrada = task(TOMORROW, { booking_out_id: s.id, status: "verificada" });
    expect(compute([cerrada], [s])).toBeNull();
    expect(compute([cerrada], [s], { today: TOMORROW })).toBeNull();
  });

  it("una limpieza cancelada no se resucita", () => {
    const s = stay("2026-10-20", TODAY);
    expect(compute([task(TODAY, { booking_out_id: s.id, status: "cancelada" })], [s])).toBeNull();
  });

  it("marcado sucio a mano avisa ya, con huésped adentro o no", () => {
    expect(compute([task(TODAY)], [stay("2026-10-20", "2026-11-20")])?.due).toBe("now");
    expect(compute([task(TODAY)], [], { unitStatus: "disponible" })?.due).toBe("now");
  });

  it("marcado sucio a mano ayer sigue sucio aunque el huésped ya estuviera", () => {
    const state = compute([task("2026-10-31")], [stay("2026-10-20", "2026-11-20")]);
    expect(state?.due).toBe("now");
    expect(state?.overdueSince).toBe("2026-10-31");
  });

  it("una reserva extendida vuelve a avisar en su nueva salida", () => {
    // AT4A (Habitana): limpieza cerrada el 21/09, salida real el 25/09.
    const s = stay("2026-10-13", TOMORROW);
    const vieja = task("2026-10-25", { booking_out_id: s.id, status: "verificada" });
    expect(compute([vieja], [s])?.due).toBe("tomorrow");
  });

  it("la unidad en estado limpieza siempre está sucia", () => {
    expect(compute([], [], { unitStatus: "limpieza" })?.due).toBe("now");
  });
});

describe("tareas viejas sin cerrar", () => {
  it("quedó sin hacer y no vino nadie: sigue sucio, con la fecha", () => {
    const state = compute([task("2026-10-30")], [], { unitStatus: "disponible" });
    expect(state).toEqual({ due: "now", overdueSince: "2026-10-30" });
  });

  it("ya entró otra estadía: deja de avisar", () => {
    // SAL648: tarea del 31/10 sin cerrar, huésped nuevo 31/10→02/11.
    const nueva = stay("2026-10-31", "2026-11-05");
    expect(compute([task("2026-10-31")], [nueva], { unitStatus: "disponible" })).toBeNull();
    // Y si esa estadía sale mañana, el aviso es por su salida, no por la tarea vieja.
    const saleManana = stay("2026-10-31", TOMORROW);
    expect(compute([task("2026-10-31")], [saleManana], { unitStatus: "disponible" })).toEqual({
      due: "tomorrow",
      overdueSince: null,
    });
  });

  it("el día del recambio NO se descarta aunque entre otro huésped", () => {
    const prev = stay("2026-10-29", TODAY, { guest_id: "a" });
    const next = stay(TODAY, "2026-11-05", { guest_id: "b" });
    expect(compute([task(TODAY, { booking_out_id: prev.id })], [prev, next])?.due).toBe("today");
  });

  it("al día siguiente del recambio, la tarea sin cerrar ya no avisa", () => {
    const next = stay(TODAY, "2026-11-05", { guest_id: "b" });
    expect(compute([task(TODAY)], [next], { today: TOMORROW })).toBeNull();
  });

  it("una estadía marcada check-out no tapa una limpieza vieja", () => {
    const seFue = stay("2026-10-30", "2026-11-05", { status: "check_out" });
    expect(compute([task("2026-10-31")], [seFue])?.due).toBe("now");
  });

  it("más de 7 días no avisa: hay orgs con decenas sin cerrar", () => {
    expect(compute([task("2026-10-24")], [], { unitStatus: "disponible" })).toBeNull();
    expect(compute([task("2026-10-25")], [], { unitStatus: "disponible" })?.due).toBe("now");
  });

  it("la fecha que informa es la más vieja", () => {
    const state = compute([task("2026-10-31"), task("2026-10-29")], [], { unitStatus: "disponible" });
    expect(state?.overdueSince).toBe("2026-10-29");
  });
});

describe("no inventa avisos", () => {
  it("unidad sin nada: limpia", () => {
    expect(compute([], [], { unitStatus: "disponible" })).toBeNull();
  });

  it("una tarea agendada para más adelante no avisa", () => {
    expect(compute([task("2026-11-10")], [], { unitStatus: "disponible" })).toBeNull();
  });

  it("una tarea terminada no avisa", () => {
    const s = stay("2026-10-20", TODAY);
    expect(compute([task(TODAY, { booking_out_id: s.id, status: "completada" })], [s])).toBeNull();
  });
});

describe("taskCoversCheckout", () => {
  it("abierta cubre cualquier fecha", () => {
    expect(taskCoversCheckout({ status: "pendiente", scheduled_date: "2026-10-01" }, TODAY)).toBe(true);
    expect(taskCoversCheckout({ status: "en_progreso", scheduled_date: "2026-10-01" }, TODAY)).toBe(true);
  });

  it("cerrada sólo si era para esa fecha o después", () => {
    expect(taskCoversCheckout({ status: "verificada", scheduled_date: TODAY }, TODAY)).toBe(true);
    expect(taskCoversCheckout({ status: "cancelada", scheduled_date: TOMORROW }, TODAY)).toBe(true);
    expect(taskCoversCheckout({ status: "verificada", scheduled_date: "2026-10-31" }, TODAY)).toBe(false);
  });
});

describe("uncoveredCheckouts", () => {
  it("devuelve la salida sin tarea", () => {
    const s = stay("2026-10-29", TOMORROW);
    expect(uncoveredCheckouts({ tasks: [], stays: [s], today: TODAY })).toEqual([s]);
  });

  it("otra tarea de ese día en la unidad la cubre", () => {
    const s = stay("2026-10-29", TODAY);
    expect(uncoveredCheckouts({ tasks: [task(TODAY)], stays: [s], today: TODAY })).toEqual([]);
  });

  it("una tarea cancelada de otra reserva no la cubre", () => {
    // Se canceló una reserva y la unidad se revendió para la misma noche.
    const s = stay("2026-10-29", TODAY);
    const ajena = task(TODAY, { status: "cancelada", booking_out_id: "otra" });
    expect(uncoveredCheckouts({ tasks: [ajena], stays: [s], today: TODAY })).toEqual([s]);
  });

  it("ignora salidas de otros días y continuaciones", () => {
    const vieja = stay("2026-10-20", "2026-10-30");
    const futura = stay(TOMORROW, "2026-11-10");
    const prev = stay("2026-10-03", TODAY, { guest_id: "g" });
    const next = stay(TODAY, TOMORROW, { guest_id: "g" });
    expect(uncoveredCheckouts({ tasks: [], stays: [vieja, futura, prev], today: TODAY })).toEqual([prev]);
    expect(uncoveredCheckouts({ tasks: [], stays: [prev, next], today: TODAY })).toEqual([next]);
  });
});

describe("computeCleanlinessByUnit", () => {
  it("sólo devuelve las sucias y no mezcla unidades", () => {
    const a = stay("2026-10-20", TOMORROW, { unit_id: "a" });
    const b = stay("2026-10-20", "2026-11-20", { unit_id: "b" });
    const out = computeCleanlinessByUnit({
      tasks: [task(TODAY, { unit_id: "c" })],
      stays: [a, b],
      today: TODAY,
      limpiezaUnitIds: ["d"],
    });
    expect(Object.keys(out).sort()).toEqual(["a", "c", "d"]);
    expect(out.a.due).toBe("tomorrow");
    expect(out.c.due).toBe("now");
    expect(out.d.due).toBe("now");
  });

  it("una tarea de una unidad no cubre la salida de otra", () => {
    const a = stay("2026-10-20", TODAY, { unit_id: "a" });
    const out = computeCleanlinessByUnit({
      tasks: [task(TODAY, { unit_id: "b", status: "verificada" })],
      stays: [a],
      today: TODAY,
      limpiezaUnitIds: [],
    });
    expect(out.a?.due).toBe("today");
  });
});

describe("cleanlinessHint", () => {
  it("dice cuándo y desde cuándo", () => {
    expect(cleanlinessHint({ due: "tomorrow", overdueSince: null })).toContain("mañana");
    expect(cleanlinessHint({ due: "today", overdueSince: null })).toContain("hoy");
    expect(cleanlinessHint({ due: "now", overdueSince: "2026-10-30" })).toContain("30/10");
    expect(cleanlinessHint({ due: "now", overdueSince: null })).toBe("Hay que limpiarlo.");
  });
});
