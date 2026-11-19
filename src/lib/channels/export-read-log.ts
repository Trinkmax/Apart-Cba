import { todayYmdInTz } from "@/lib/dates";
import {
  attributeUnitRead,
  futureStays,
  readerFromUserAgent,
  READER_STALE_MS,
  typicalIntervalMin,
  type AttributableLink,
  type ExportReader,
  type ExportVia,
  type Stay,
} from "./export-reads";
import type { Channel } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

/**
 * Anota una lectura del calendario saliente (migración 083): quién leyó, por
 * qué dirección y qué se le sirvió. La parte que decide está en export-reads.ts.
 *
 * Corre DESPUÉS de responderle a la OTA (`after()` en las dos rutas) y nunca
 * lanza: el calendario se sirve igual aunque esto falle. Lo peor que puede
 * pasar es una lectura sin anotar.
 *
 * Tolera que la 083 todavía no esté aplicada: sin la tabla ni las columnas
 * nuevas igual sella `last_export_access_at`, que es lo que se hacía antes. Sin
 * eso, desplegar el código antes que la migración dejaba todas las conexiones
 * sin una sola lectura registrada y, al día siguiente, en «la OTA no lee».
 */
export interface ExportReadInput {
  via: ExportVia;
  unit: { id: string; organization_id: string };
  /** La conexión dueña de la dirección (sólo con `via: "link"`). */
  link?: { id: string; channel: Channel } | null;
  userAgent: string | null;
  httpStatus: number;
  etag: string;
  /** Todo lo que bloqueaba el calendario servido. */
  stays: Stay[];
}

const READS_FOR_INTERVAL = 9;

export async function recordExportRead(admin: AdminClient, input: ExportReadInput): Promise<void> {
  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const byAgent = readerFromUserAgent(input.userAgent);
    const orgId = input.unit.organization_id;

    // ¿A qué conexiones se les anota?
    let targets: Array<{ id: string; channel: Channel; previousReadAt: string | null }> = [];
    if (input.via === "link" && input.link) {
      const { data: row } = await admin
        .from("channel_links")
        .select("id, last_export_access_at")
        .eq("id", input.link.id)
        .maybeSingle();
      targets = [
        {
          id: input.link.id,
          channel: input.link.channel,
          previousReadAt: (row?.last_export_access_at as string | null) ?? null,
        },
      ];
    } else {
      let { data: links, error: linksErr } = await admin
        .from("channel_links")
        .select("id, channel, status, export_via, last_export_access_at")
        .eq("unit_id", input.unit.id)
        .eq("organization_id", orgId);
      if (linksErr) {
        // Sin la 083: no hay por qué dirección lee cada una; se reparte como antes.
        const fallback = await admin
          .from("channel_links")
          .select("id, channel, status, last_export_access_at")
          .eq("unit_id", input.unit.id)
          .eq("organization_id", orgId);
        links = (fallback.data ?? []).map((l) => ({ ...l, export_via: null }));
        linksErr = fallback.error;
      }
      const rows = (links ?? []) as AttributableLink[];
      const ids = new Set(attributeUnitRead(rows, byAgent, now.getTime()));
      targets = rows
        .filter((l) => ids.has(l.id))
        .map((l) => ({ id: l.id, channel: l.channel, previousReadAt: l.last_export_access_at }));
    }

    const agent = input.userAgent?.slice(0, 300) ?? null;
    const readRow = (linkId: string | null, reader: ExportReader) => ({
      organization_id: orgId,
      unit_id: input.unit.id,
      link_id: linkId,
      reader,
      via: input.via,
      http_status: input.httpStatus,
      etag: input.etag,
      user_agent: agent,
      read_at: nowIso,
    });
    // Por su dirección propia lee el canal de esa conexión, se identifique o no.
    // Por la vieja, con una sola conexión candidata también se sabe quién es.
    const readerFor = (channel: Channel): ExportReader =>
      byAgent !== "unknown" ? byAgent : input.via === "link" || targets.length === 1 ? channel : "unknown";

    const { error: insertErr } = await admin
      .from("channel_export_reads")
      .insert(
        targets.length > 0
          ? targets.map((t) => readRow(t.id, readerFor(t.channel)))
          : [readRow(null, byAgent)],
      );
    if (insertErr) {
      console.warn("[channels/export-read] no se pudo anotar la lectura", insertErr.message);
    }

    const served = {
      at: nowIso,
      etag: input.etag,
      stays: futureStays(input.stays, todayYmdInTz()),
    };

    await Promise.all(
      targets.map(async (t) => {
        const { data: recent } = await admin
          .from("channel_export_reads")
          .select("read_at")
          .eq("link_id", t.id)
          .order("read_at", { ascending: false })
          .limit(READS_FOR_INTERVAL);
        const interval = typicalIntervalMin([
          nowIso,
          ...((recent ?? []) as { read_at: string }[]).map((r) => r.read_at),
        ]);

        const patch: Record<string, unknown> = {
          last_export_access_at: nowIso,
          export_via: input.via,
          export_served: served,
        };
        if (interval !== null) patch.export_interval_min = interval;
        const { error: updErr } = await admin.from("channel_links").update(patch).eq("id", t.id);
        if (updErr) {
          // Sin las columnas de la 083 queda, al menos, la hora de la lectura.
          const { error: plainErr } = await admin
            .from("channel_links")
            .update({ last_export_access_at: nowIso })
            .eq("id", t.id);
          if (plainErr) {
            console.warn("[channels/export-read] no se pudo actualizar la conexión", plainErr.message);
            return;
          }
        }

        // Venía sin leer (o nunca había leído): el aviso ya no es verdad.
        const previous = t.previousReadAt ? Date.parse(t.previousReadAt) : NaN;
        if (Number.isNaN(previous) || now.getTime() - previous > READER_STALE_MS) {
          await admin
            .from("channel_issues")
            .update({
              status: "resolved",
              resolution: "La OTA volvió a leer tu calendario.",
              resolved_at: nowIso,
            })
            .eq("organization_id", orgId)
            .eq("dedupe_key", `export_stale:${t.id}`)
            .eq("status", "open");
        }
      }),
    );
  } catch (err) {
    console.warn("[channels/export-read] falló el registro de la lectura", (err as Error).message);
  }
}
