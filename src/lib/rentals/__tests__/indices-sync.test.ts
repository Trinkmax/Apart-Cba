import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` no está instalado (Next lo resuelve en el build): sin el mock el import revienta.
vi.mock("server-only", () => ({}));

import {
  dailyFetchRange,
  expectedIpcPeriod,
  mergeIpcSources,
  parseBcraDetalle,
  parseDatosGobSeries,
  parseIndecIpcCsv,
  syncEconomicIndices,
} from "@/lib/rentals/indices-sync";
import { addDays } from "@/lib/rentals/ymd";

/*
 * Fixtures recortados de respuestas REALES (curl del 2026-10-02). Si una
 * fuente cambia de formato, esto tiene que fallar acá y no en el cron.
 */

// apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&limit=1000&format=json
const DATOS_GOB_IPC = {
  data: [
    ["2016-12-01", 100.0],
    ["2017-01-01", 101.5859],
    ["2026-06-01", 11826.4103],
    ["2026-07-01", 12076.3937],
    ["2026-08-01", 12276.766],
  ],
  count: 117,
  meta: [{ frequency: "month", start_date: "2016-12-01", end_date: "2026-08-01" }],
  params: { ids: "148.3_INIVELNAL_DICI_M_26", limit: "1000", format: "json" },
};

// ?ids=148.3_INIVELNAL_DICI_M_26,158.1_REPTE_0_0_5&start_date=2016-09-01&limit=6
// El IPC (columna 1) arranca en dic-2016: los meses anteriores vienen en null.
const DATOS_GOB_WITH_NULLS = {
  data: [
    ["2016-09-01", null, 19666.45],
    ["2016-10-01", null, 20069.28],
    ["2016-11-01", null, 20422.65],
    ["2016-12-01", 100.0, 20690.14],
    ["2017-01-01", 101.5859, 21048.21],
    ["2017-02-01", 103.6859, 21483.03],
  ],
  count: 6,
};

// ?ids=148.3_NOEXISTE_M_26 → HTTP 400
const DATOS_GOB_ERROR = {
  errors: [{ error: "Serie inexistente: 148.3_NOEXISTE_M_26" }],
  failed_series: ["148.3_NOEXISTE_M_26"],
};

// api.bcra.gob.ar/estadisticas/v4.0/Monetarias/40?desde=2026-09-20&hasta=2026-11-11&limit=1000&offset=0
// ICL: 4 de las 27 filas, que el BCRA manda en orden DESCENDENTE.
const BCRA_ICL = {
  status: 200,
  metadata: { resultset: { count: 27, offset: 0, limit: 1000 } },
  results: [
    {
      idVariable: 40,
      detalle: [
        { fecha: "2026-10-16", valor: 36.88 },
        { fecha: "2026-10-15", valor: 36.86 },
        { fecha: "2026-10-14", valor: 36.83 },
        { fecha: "2026-09-20", valor: 36.3 },
      ],
    },
  ],
};

// Mismo rango con limit=10&offset=20: `count` sigue siendo el total del rango.
const BCRA_ICL_PAGE_3 = {
  status: 200,
  metadata: { resultset: { count: 27, offset: 20, limit: 10 } },
  results: [
    {
      idVariable: 40,
      detalle: [
        { fecha: "2026-09-26", valor: 36.43 },
        { fecha: "2026-09-25", valor: 36.41 },
        { fecha: "2026-09-20", valor: 36.3 },
      ],
    },
  ],
};

// .../Monetarias/30?desde=2026-09-28&hasta=2026-11-11 (CER, 11 decimales)
const BCRA_CER = {
  status: 200,
  metadata: { resultset: { count: 18, offset: 0, limit: 1000 } },
  results: [
    {
      idVariable: 30,
      detalle: [
        { fecha: "2026-10-15", valor: 854.45861540882 },
        { fecha: "2026-10-14", valor: 853.97862664495 },
      ],
    },
  ],
};

// .../Monetarias/40?desde=2019-01-01&hasta=2019-02-01 (antes de que exista el ICL)
const BCRA_EMPTY = {
  status: 200,
  metadata: { resultset: { count: 0, offset: 0, limit: 1000 } },
  results: [{ idVariable: 40, detalle: [] }],
};

// .../Monetarias/40?desde=2026-11-11&hasta=2026-09-20 → HTTP 400
const BCRA_ERROR = {
  status: 400,
  errorMessages: ["Parámetro erróneo: La fecha desde no puede mayor a la actual."],
};

// www.indec.gob.ar/ftp/cuadros/economia/serie_ipc_divisiones.csv (ISO-8859-1, CRLF, `;`).
const INDEC_LINES = [
  "Codigo;Descripcion;Clasificador;Periodo;Indice_IPC;v_m_IPC;v_i_a_IPC;Region",
  "0;NIVEL GENERAL;Nivel general y divisiones COICOP;201612;100;NA;NA;GBA",
  "0;NIVEL GENERAL;Nivel general y divisiones COICOP;201612;100;NA;NA;Nacional",
  "0;NIVEL GENERAL;Nivel general y divisiones COICOP;201701;101,5859;1,6;NA;Nacional",
  "01;Alimentos y bebidas no alcohólicas;Nivel general y divisiones COICOP;202608;13121,2544;1,7;34,9;Nacional",
  "Núcleo;;Categorias;202608;12445,7973;1,8;31,9;Nacional",
  "0;NIVEL GENERAL;Nivel general y divisiones COICOP;202608;12276,812;1,6;33,7;GBA",
  "0;NIVEL GENERAL;Nivel general y divisiones COICOP;202608;12276,766;1,7;33,5;Nacional",
  // Adaptada: hoy el archivo trae "NA" sólo en las variaciones, no en Indice_IPC,
  // pero es como el INDEC marca un dato faltante.
  "0;NIVEL GENERAL;Nivel general y divisiones COICOP;202609;NA;NA;NA;Nacional",
  "",
];
const CRLF = "\r\n";

/** Bytes ISO-8859-1 del texto (todos los caracteres del CSV entran en un byte). */
function latin1Bytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

describe("parseDatosGobSeries", () => {
  it("lee la serie de niveles y la deja ascendente", () => {
    expect(parseDatosGobSeries(DATOS_GOB_IPC)).toEqual([
      { date: "2016-12-01", value: 100 },
      { date: "2017-01-01", value: 101.5859 },
      { date: "2026-06-01", value: 11826.4103 },
      { date: "2026-07-01", value: 12076.3937 },
      { date: "2026-08-01", value: 12276.766 },
    ]);
  });

  it("saltea los null y lee sólo la primera serie pedida", () => {
    expect(parseDatosGobSeries(DATOS_GOB_WITH_NULLS)).toEqual([
      { date: "2016-12-01", value: 100 },
      { date: "2017-01-01", value: 101.5859 },
      { date: "2017-02-01", value: 103.6859 },
    ]);
  });

  it("lanza con el mensaje de la API cuando la serie no existe", () => {
    expect(() => parseDatosGobSeries(DATOS_GOB_ERROR)).toThrow(
      "Serie inexistente: 148.3_NOEXISTE_M_26",
    );
  });

  it("lanza ante una forma desconocida y descarta filas inválidas", () => {
    expect(() => parseDatosGobSeries(null)).toThrow(/formato inesperado/);
    expect(() => parseDatosGobSeries({ rows: [] })).toThrow(/data/);
    // Variante defensiva (no real): fechas imposibles, ceros, negativos y basura.
    const messy = {
      data: [
        ["2026-13-01", 5],
        ["2026-02-30", 5],
        ["2026-01-01", 0],
        ["2026-02-01", -3],
        "x",
        ["2026-03-01", "abc"],
        ["2026-05-01", 8],
        ["2026-04-01", 7],
      ],
    };
    expect(parseDatosGobSeries(messy)).toEqual([
      { date: "2026-04-01", value: 7 },
      { date: "2026-05-01", value: 8 },
    ]);
  });
});

describe("parseBcraDetalle", () => {
  it("normaliza el orden DESCENDENTE del BCRA a ascendente y devuelve el total", () => {
    const { points, count } = parseBcraDetalle(BCRA_ICL);
    expect(points.map((p) => p.date)).toEqual(["2026-09-20", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(points.at(-1)).toEqual({ date: "2026-10-16", value: 36.88 });
    expect(count).toBe(27);
  });

  it("en una página intermedia `count` sigue siendo el total del rango", () => {
    const { points, count } = parseBcraDetalle(BCRA_ICL_PAGE_3);
    expect(count).toBe(27);
    expect(points.map((p) => p.date)).toEqual(["2026-09-20", "2026-09-25", "2026-09-26"]);
  });

  it("conserva todos los decimales del CER", () => {
    expect(parseBcraDetalle(BCRA_CER).points).toEqual([
      { date: "2026-10-14", value: 853.97862664495 },
      { date: "2026-10-15", value: 854.45861540882 },
    ]);
  });

  it("un rango sin datos no es un error", () => {
    expect(parseBcraDetalle(BCRA_EMPTY)).toEqual({ points: [], count: 0 });
  });

  it("lanza con el mensaje del BCRA", () => {
    expect(() => parseBcraDetalle(BCRA_ERROR)).toThrow("La fecha desde no puede mayor a la actual");
    expect(() => parseBcraDetalle({ status: 200 })).toThrow(/results/);
  });
});

describe("parseIndecIpcCsv", () => {
  const bytes = latin1Bytes(INDEC_LINES.join(CRLF));
  const expected = [
    { date: "2016-12-01", value: 100 },
    { date: "2017-01-01", value: 101.5859 },
    { date: "2026-08-01", value: 12276.766 },
  ];

  it("nivel general nacional, coma decimal y sin los NA (decodificado como latin1)", () => {
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("alcohólicas");
    expect(text).toContain("Núcleo");
    expect(parseIndecIpcCsv(text)).toEqual(expected);
  });

  it("los filtros no dependen de los acentos: decodificado como UTF-8 da lo mismo", () => {
    const mangled = new TextDecoder("utf-8").decode(bytes);
    expect(mangled).toContain(String.fromCharCode(0xfffd));
    expect(parseIndecIpcCsv(mangled)).toEqual(expected);
  });

  it("tolera BOM, comillas y tildes en el encabezado (variante defensiva)", () => {
    const bom = String.fromCharCode(0xfeff);
    const csv = [
      `${bom}"Código";"Descripción";"Clasificador";"Período";"Indice_IPC";"v_m_IPC";"v_i_a_IPC";"Región"`,
      `"0";"NIVEL GENERAL";"Nivel general y divisiones COICOP";"202607";"12076,3937";"2,1";"33,8";"Nacional"`,
    ].join("\n");
    expect(parseIndecIpcCsv(csv)).toEqual([{ date: "2026-07-01", value: 12076.3937 }]);
  });

  it("lanza si el archivo no trae las columnas que usa", () => {
    expect(() => parseIndecIpcCsv(`a;b;c${CRLF}1;2;3`)).toThrow(/faltan columnas/);
  });
});

describe("expectedIpcPeriod", () => {
  it("el IPC del mes M se espera desde el 10 de M+1", () => {
    expect(expectedIpcPeriod("2026-10-02")).toBe("2026-08-01");
    expect(expectedIpcPeriod("2026-10-09")).toBe("2026-08-01");
    expect(expectedIpcPeriod("2026-10-10")).toBe("2026-09-01");
    expect(expectedIpcPeriod("2026-01-05")).toBe("2025-11-01");
    expect(expectedIpcPeriod("2026-01-15")).toBe("2025-12-01");
  });
});

describe("mergeIpcSources", () => {
  it("manda datos.gob.ar; del CSV del INDEC entran sólo los meses que le faltan", () => {
    // Valores reales: el CSV tiene abril 2019 en 213,0517, que no cierra con su
    // propia variación de 3,4 %; datos.gob.ar trae 212,9596414, que sí.
    const datosGob = [
      { date: "2019-03-01", value: 205.9571 },
      { date: "2019-04-01", value: 212.9596414 },
      { date: "2019-05-01", value: 219.5691 },
    ];
    const indec = [
      { date: "2019-06-01", value: 225.537 },
      { date: "2019-04-01", value: 213.0517 },
      { date: "2019-05-01", value: 219.5691 },
    ];
    expect(mergeIpcSources(datosGob, indec)).toEqual([
      { date: "2019-03-01", value: 205.9571, source: "datos_gob" },
      { date: "2019-04-01", value: 212.9596414, source: "datos_gob" },
      { date: "2019-05-01", value: 219.5691, source: "datos_gob" },
      { date: "2019-06-01", value: 225.537, source: "indec" },
    ]);
  });

  it("si datos.gob.ar no trajo nada, todo sale del INDEC", () => {
    expect(mergeIpcSources([], [{ date: "2026-08-01", value: 12276.766 }])).toEqual([
      { date: "2026-08-01", value: 12276.766, source: "indec" },
    ]);
  });
});

describe("dailyFetchRange", () => {
  const today = "2026-10-02";

  it("incremental: desde 45 días antes del último guardado hasta hoy + 40", () => {
    expect(dailyFetchRange("icl", "2026-10-16", today)).toEqual({
      desde: "2026-09-01",
      hasta: "2026-11-11",
    });
  });

  it("serie vacía o backfill: desde el inicio útil de cada serie", () => {
    expect(dailyFetchRange("icl", null, today).desde).toBe("2020-07-01");
    expect(dailyFetchRange("cer", null, today).desde).toBe("2016-01-01");
    expect(dailyFetchRange("uva", "2026-10-15", today, true).desde).toBe("2016-03-31");
  });

  it("nunca antes del inicio ni después de hoy (el BCRA rechaza un `desde` futuro)", () => {
    expect(dailyFetchRange("icl", "2020-07-20", today).desde).toBe("2020-07-01");
    expect(dailyFetchRange("icl", "2026-12-31", today).desde).toBe(today);
  });
});

describe("syncEconomicIndices (red y base falsas)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Upsert = { rows: Record<string, unknown>[]; onConflict?: string };

  /** Cliente admin falso: sólo lo que usa la sync (último período + upsert). */
  function fakeAdmin(latest: Record<string, string>) {
    const upserts: Upsert[] = [];
    const client = {
      from(table: string) {
        if (table !== "economic_indices") throw new Error(`tabla inesperada: ${table}`);
        let code = "";
        const query = {
          select: () => query,
          eq: (_column: string, value: string) => {
            code = value;
            return query;
          },
          order: () => query,
          limit: async () => ({ data: latest[code] ? [{ period: latest[code] }] : [], error: null }),
          upsert: async (rows: Record<string, unknown>[], opts?: { onConflict?: string }) => {
            upserts.push({ rows, onConflict: opts?.onConflict });
            return { error: null };
          },
        };
        return query;
      },
    };
    return { admin: client as unknown as Parameters<typeof syncEconomicIndices>[0], upserts };
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  /** Reemplaza `fetch` global (el timeout de 15 s lo envuelve igual) y anota cada URL. */
  function stubFetch(route: (url: URL) => Response) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        calls.push(url.href);
        return route(url);
      }),
    );
    return calls;
  }

  const RIPTE = {
    data: [
      ["2026-05-01", 1849727.96],
      ["2026-06-01", 1915878.76],
      ["2026-07-01", 1946028.12],
    ],
    count: 385,
  };

  // Sintético: 1200 días de CER que el BCRA falso pagina de a 1000, DESC como el real.
  const CER_DESC = Array.from({ length: 1200 }, (_, i) => ({
    fecha: addDays("2016-01-01", i),
    valor: 5 + i / 100,
  })).reverse();

  function route(url: URL): Response {
    if (url.host === "apis.datos.gob.ar") {
      return json(url.searchParams.get("ids")?.startsWith("148.3") ? DATOS_GOB_IPC : RIPTE);
    }
    if (url.pathname.endsWith("/Monetarias/40")) throw new TypeError("fetch failed");
    if (url.pathname.endsWith("/Monetarias/31")) return new Response("Bad Gateway", { status: 502 });
    if (url.pathname.endsWith("/Monetarias/30")) {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      return json({
        status: 200,
        metadata: { resultset: { count: CER_DESC.length, offset, limit } },
        results: [{ idVariable: 30, detalle: CER_DESC.slice(offset, offset + limit) }],
      });
    }
    throw new Error(`URL inesperada: ${url.href}`);
  }

  it("una fuente caída no frena a las otras y nunca lanza", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubFetch(route);
    const { admin, upserts } = fakeAdmin({ icl: "2026-10-10" });

    const results = await syncEconomicIndices(admin, { today: "2026-10-02" });
    const byCode = Object.fromEntries(results.map((r) => [r.code, r]));

    expect(results.map((r) => r.code)).toEqual(["ipc", "ripte", "icl", "cer", "uva"]);
    expect(byCode.ipc).toEqual({ code: "ipc", fetched: 5, upserted: 5, latest: "2026-08-01", source: "datos_gob" });
    expect(byCode.ripte).toMatchObject({ fetched: 3, upserted: 3, latest: "2026-07-01", source: "datos_gob" });
    expect(byCode.cer).toMatchObject({ fetched: 1200, upserted: 1200, latest: addDays("2016-01-01", 1199), source: "bcra" });
    expect(byCode.cer.error).toBeUndefined();
    // Falla de red: queda el último dato que ya estaba guardado.
    expect(byCode.icl).toMatchObject({ fetched: 0, upserted: 0, latest: "2026-10-10" });
    expect(byCode.icl.error).toMatch(/BCRA: fetch failed/);
    expect(byCode.uva.error).toMatch(/BCRA respondió 502/);
    expect(warn).toHaveBeenCalledTimes(2);

    // ICL incremental (último − 45 días) y CER completo (no había nada guardado).
    expect(calls).toContain(
      "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/40?desde=2026-08-26&hasta=2026-11-11&limit=1000&offset=0",
    );
    expect(calls.filter((u) => u.includes("/Monetarias/30?desde=2016-01-01&hasta=2026-11-11"))).toHaveLength(2);
    // Con el IPC al día no hace falta bajar el CSV del INDEC.
    expect(calls.some((u) => u.includes("indec.gob.ar"))).toBe(false);

    // Lotes de 500, todos con las mismas claves (PostgREST manda NULL en la que falte).
    const cer = upserts.filter((u) => u.rows[0]?.index_code === "cer");
    expect(cer.map((u) => u.rows.length)).toEqual([500, 500, 200]);
    for (const u of upserts) {
      expect(u.onConflict).toBe("index_code,period");
      for (const row of u.rows) {
        expect(Object.keys(row).sort()).toEqual(["fetched_at", "index_code", "period", "source", "value"]);
      }
    }
  });

  // Sintético sobre filas reales: septiembre 2026 todavía no salió.
  const CSV_WITH_SEPTEMBER = [
    ...INDEC_LINES.slice(0, -2),
    "0;NIVEL GENERAL;Nivel general y divisiones COICOP;202609;12500,1234;1,8;33;Nacional",
    "",
  ].join(CRLF);

  function ipcRows(upserts: Upsert[]): string[] {
    return upserts
      .filter((u) => u.rows[0]?.index_code === "ipc")
      .flatMap((u) => u.rows.map((r) => `${r.period} ${r.source} ${r.value}`));
  }

  it("IPC atrasado en datos.gob.ar: del CSV del INDEC entra sólo el mes que falta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubFetch((url) => {
      if (url.host === "www.indec.gob.ar") return new Response(latin1Bytes(CSV_WITH_SEPTEMBER));
      if (url.host === "apis.datos.gob.ar") return json(DATOS_GOB_IPC);
      return json(BCRA_EMPTY);
    });
    const { admin, upserts } = fakeAdmin({ ipc: "2026-08-01" });

    // Desde el día 10 se espera el IPC de septiembre; datos.gob.ar llega a agosto.
    const [ipc] = await syncEconomicIndices(admin, { today: "2026-10-20" });

    expect(ipc).toEqual({ code: "ipc", fetched: 6, upserted: 6, latest: "2026-09-01", source: "datos_gob+indec" });
    expect(ipcRows(upserts)).toEqual([
      "2016-12-01 datos_gob 100",
      "2017-01-01 datos_gob 101.5859",
      "2026-06-01 datos_gob 11826.4103",
      "2026-07-01 datos_gob 12076.3937",
      "2026-08-01 datos_gob 12276.766",
      "2026-09-01 indec 12500.1234",
    ]);
    expect(calls.filter((u) => u.includes("indec.gob.ar"))).toHaveLength(1);
  });

  it("datos.gob.ar caído: todo el IPC sale del CSV del INDEC", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch((url) => {
      if (url.host === "www.indec.gob.ar") return new Response(latin1Bytes(CSV_WITH_SEPTEMBER));
      if (url.host === "apis.datos.gob.ar") return json(DATOS_GOB_ERROR, 400);
      return json(BCRA_EMPTY);
    });
    const { admin, upserts } = fakeAdmin({});

    const [ipc] = await syncEconomicIndices(admin, { today: "2026-10-20" });

    expect(ipc).toEqual({ code: "ipc", fetched: 4, upserted: 4, latest: "2026-09-01", source: "indec" });
    expect(ipcRows(upserts).every((r) => r.includes(" indec "))).toBe(true);
  });
});
