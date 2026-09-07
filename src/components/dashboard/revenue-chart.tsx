"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { formatMoneyShort } from "@/lib/format";

// Dos series superpuestas (NO apiladas: miden cosas distintas). "Cobrado" es
// la protagonista — plata que entró en Caja — y va en esmeralda como el
// botón Ingreso; "Reservado" (lo contratado por check-in) queda en el teal
// de marca, punteado y con relleno más tenue.
const COLLECTED_COLOR = "#10b981";
const RESERVED_COLOR = "oklch(0.45 0.10 195)";
const SERIES_LABEL: Record<string, string> = {
  collected: "Cobrado",
  amount: "Reservado",
};

export function RevenueChart({
  data,
}: {
  data: Array<{ date: string; amount: number; collected?: number; currency: string }>;
}) {
  // La moneda viene de la serie (la de la org), no de un literal.
  const currency = data[0]?.currency ?? "ARS";
  const chartData = data.map((d) => ({
    label: format(parseISO(d.date), "d MMM", { locale: es }),
    amount: d.amount,
    collected: d.collected ?? 0,
    currency: d.currency,
  }));

  return (
    <ResponsiveContainer width="100%" height={180} minWidth={0}>
      <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={RESERVED_COLOR} stopOpacity={0.18} />
            <stop offset="95%" stopColor={RESERVED_COLOR} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="collectedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COLLECTED_COLOR} stopOpacity={0.35} />
            <stop offset="95%" stopColor={COLLECTED_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatMoneyShort(v, currency)}
          width={50}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(value, name) => [
            formatMoneyShort(Number(value), currency),
            SERIES_LABEL[String(name)] ?? String(name),
          ]}
          labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
        />
        <Area
          type="monotone"
          dataKey="amount"
          stroke={RESERVED_COLOR}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          fill="url(#brandGrad)"
        />
        <Area
          type="monotone"
          dataKey="collected"
          stroke={COLLECTED_COLOR}
          strokeWidth={2}
          fill="url(#collectedGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
