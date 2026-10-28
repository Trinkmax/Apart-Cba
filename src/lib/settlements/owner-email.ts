import type { StatementModel } from "./statement-model";
import { formatMoney } from "@/lib/format";
import { settlementNetLabel } from "./labels";

/**
 * El mail que recibe el propietario con su liquidación: asunto, HTML y texto
 * plano. Puro (sin red ni base) para poder probarlo: es lo primero que lee el
 * dueño, antes de abrir el PDF.
 *
 * El período del ciclo de ajuste tiene que verse de una (1/3, 2/3, 3/3): va en
 * el asunto, en el encabezado y en el cuerpo. Con deptos en períodos distintos
 * (migración 074) el cuerpo lista el de cada uno.
 */
export function buildOwnerSettlementEmail({
  model,
  ownerName,
  net,
  link,
  branding,
}: {
  model: StatementModel;
  ownerName: string;
  /** Neto por pagar ya formateado ("$ 1.234,00"): el persistido, no el recalculado. */
  net: string;
  /** Link público de solo lectura. */
  link: string;
  branding: {
    name: string;
    legal_name?: string | null;
    primary_color?: string | null;
  };
}): { subject: string; html: string; text: string } {
  const brand = branding.primary_color || "#0F766E";
  // Neto negativo: el propietario cobró directo y debe la diferencia. El
  // rótulo lo dice; el importe va sin signo.
  const netLabel = settlementNetLabel(model.totals.net);
  const netShown = model.totals.net < 0 ? net.replace(/[-−]/, "") : net;
  // Si cobró él (077), el neto es sólo lo que falta transferir: le decimos
  // también cuánto ganó y cuánto ya tiene en la mano.
  const earnings =
    model.totals.ownerCollected > 0
      ? {
          earned: formatMoney(model.totals.ownerEarnings, model.currency),
          collected: formatMoney(model.totals.ownerCollected, model.currency),
        }
      : null;
  const firstName = ownerName.trim().split(/\s+/)[0] || ownerName;
  const badge = model.periodBadgeLabel;
  // Un solo período para todo el documento ya está en el título y el asunto:
  // la lista por depto sólo aparece cuando difieren.
  const unitPeriods = model.periodCycleLabel ? [] : model.unitPeriods;

  // La aclaración, el nombre del propietario y los de las unidades los tipea
  // el staff: se escapan antes de entrar al HTML.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const unitTable =
    unitPeriods.length > 0
      ? `<div style="margin:0 0 14px"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Período del ciclo de ajuste</div><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px">${unitPeriods
          .map(
            (p) =>
              `<tr><td style="padding:7px 0;border-bottom:1px solid #f1f5f9"><strong>${esc(p.code)}</strong>${p.name && p.name !== p.code ? ` <span style="color:#64748b">· ${esc(p.name)}</span>` : ""}</td><td style="padding:7px 0 7px 12px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;font-weight:600;color:${brand}">${esc(p.label)}</td></tr>`,
          )
          .join("")}</table></div>`
      : "";

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <div style="background:${brand};color:#fff;padding:22px 26px;border-radius:14px 14px 0 0">
    <div style="font-size:12px;letter-spacing:.1em;opacity:.85">${esc(branding.name.toUpperCase())}</div>
    <div style="font-size:21px;font-weight:700;margin-top:6px">Liquidación · ${esc(model.periodLabel)}</div>
    ${badge ? `<div style="display:inline-block;margin-top:8px;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.18);font-size:12px;font-weight:600">${esc(badge)}</div>` : ""}
  </div>
  <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px;padding:26px">
    <p style="margin:0 0 14px">Hola ${esc(firstName)}, te compartimos tu liquidación correspondiente a <strong>${esc(model.periodFullLabel)}</strong>.</p>
    ${unitTable}
    ${model.periodNote ? `<p style="margin:0 0 14px;font-size:13px;color:#64748b">${esc(model.periodNote)}</p>` : ""}
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px;text-align:center;margin:18px 0">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.1em">${esc(netLabel)}</div>
      <div style="font-size:28px;font-weight:800;color:${brand};margin-top:6px">${esc(netShown)}</div>
    </div>
    ${earnings ? `<p style="margin:-6px 0 18px;font-size:13px;color:#475569;text-align:center">Tu ganancia del mes: <strong>${esc(earnings.earned)}</strong> · Ya cobraste vos: ${esc(earnings.collected)}</p>` : ""}
    <div style="text-align:center;margin:24px 0">
      <a href="${esc(link)}" style="background:${brand};color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:600;display:inline-block">Ver liquidación online</a>
    </div>
    <p style="font-size:13px;color:#64748b;margin:14px 0 0">Adjuntamos el detalle completo en <strong>Excel</strong> y <strong>PDF</strong>. Ante cualquier consulta podés responder este correo.</p>
    <p style="font-size:12px;color:#94a3b8;margin:18px 0 0">${esc(branding.name)}${branding.legal_name ? " · " + esc(branding.legal_name) : ""}</p>
  </div>
</div>`.trim();

  const text = [
    `Liquidación ${model.periodFullLabel} — ${branding.name}`,
    ...(unitPeriods.length > 0
      ? [
          ``,
          `Período del ciclo de ajuste:`,
          ...unitPeriods.map((p) => `  ${p.code}: ${p.label}`),
        ]
      : []),
    ...(model.periodNote ? [``, model.periodNote] : []),
    ``,
    `${netLabel}: ${netShown}`,
    ...(earnings
      ? [`Tu ganancia del mes: ${earnings.earned} · Ya cobraste vos: ${earnings.collected}`]
      : []),
    `Ver online: ${link}`,
    ``,
    `Adjuntamos el detalle en Excel y PDF.`,
  ].join("\n");

  return {
    subject: `Liquidación ${model.periodFullLabel} · ${branding.name}`,
    html,
    text,
  };
}
