/**
 * El día en una frase y sus filas: lo comparten el Resumen de la compu, la
 * tarjeta "Tex te cuenta" del celular y la burbuja de Tex. Puro, sin red.
 */

export type TodayCounts = {
  checkIns: number;
  checkOuts: number;
  /** Unidades sucias que además tienen llegada hoy (lo más urgente). */
  dirtyWithArrival: number;
  dirty: number;
  requests: number;
};

export type HeadlineSegment = { text: string; tone?: "in" | "out" };

/** "Hoy entran 5 y salen 3." en partes, para pintar los números. */
export function headlineSegments(c: Pick<TodayCounts, "checkIns" | "checkOuts">): HeadlineSegment[] {
  if (c.checkIns === 0 && c.checkOuts === 0) return [{ text: "Hoy no entra ni sale nadie." }];
  const out: HeadlineSegment[] = [{ text: "Hoy " }];
  if (c.checkIns > 0) {
    out.push({ text: c.checkIns === 1 ? "entra " : "entran " }, { text: String(c.checkIns), tone: "in" });
  } else {
    out.push({ text: "no entra nadie" });
  }
  if (c.checkOuts > 0) {
    out.push({ text: c.checkOuts === 1 ? " y sale " : " y salen " }, { text: String(c.checkOuts), tone: "out" });
  }
  out.push({ text: "." });
  return out;
}

export function headlineText(c: Pick<TodayCounts, "checkIns" | "checkOuts">): string {
  return headlineSegments(c)
    .map((s) => s.text)
    .join("");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lo que hay que saber además de quién entra y sale. */
export function briefLines(c: TodayCounts): string[] {
  const lines: string[] = [];
  if (c.dirtyWithArrival > 0) {
    lines.push(`${plural(c.dirtyWithArrival, "unidad sigue sucia", "unidades siguen sucias")} y tienen llegada hoy.`);
  } else if (c.dirty > 0) {
    lines.push(`${plural(c.dirty, "unidad para limpiar", "unidades para limpiar")}.`);
  }
  if (c.requests > 0) lines.push(`${plural(c.requests, "solicitud espera", "solicitudes esperan")} respuesta.`);
  return lines;
}

export function briefTone(c: TodayCounts): "calm" | "busy" | "alert" {
  if (c.dirtyWithArrival > 0 || c.requests > 0) return "alert";
  return c.checkIns + c.checkOuts > 0 ? "busy" : "calm";
}

/** "14:00:00" → "14:00". */
export function hhmm(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export type CleaningState = "lista" | "en_curso" | "asignada" | "sin_asignar";

export function cleaningState(row: {
  task_id: string | null;
  status: string | null;
  assigned_to: string | null;
}): CleaningState {
  if (row.status === "completada" || row.status === "verificada") return "lista";
  if (row.status === "en_progreso") return "en_curso";
  if (row.task_id && row.assigned_to) return "asignada";
  return "sin_asignar";
}

/**
 * La cola de limpieza en el orden en que conviene hacerla: primero las que
 * tienen gente entrando hoy, después las atrasadas, después por hora de salida;
 * las ya listas al final.
 */
export function sortCleanings<
  T extends { unit_id: string; task_id: string | null; status: string | null; assigned_to: string | null; check_out_time: string | null; overdue?: boolean },
>(rows: T[], arrivingUnitIds: ReadonlySet<string>): T[] {
  const rank = (r: T) => {
    if (cleaningState(r) === "lista") return 3;
    if (arrivingUnitIds.has(r.unit_id)) return 0;
    if (r.overdue) return 1;
    return 2;
  };
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || (hhmm(a.check_out_time) ?? "99").localeCompare(hhmm(b.check_out_time) ?? "99"),
  );
}
