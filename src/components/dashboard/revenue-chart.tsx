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

export function RevenueChart({ data }: { data: Array<{ date: string; amount: number; currency: string }> }) {
  const chartData = data.map((d) => ({
    label: format(parseISO(d.date), "d MMM", { locale: es }),
    amount: d.amount,
    currency: d.currency,
  }));

  return (
    <ResponsiveContainer width="100%" height={180} minWidth={0}>
      <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="oklch(0.45 0.10 195)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="oklch(0.45 0.10 195)" stopOpacity={0} />
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
          tickFormatter={(v) => formatMoneyShort(v, "ARS")}
          width={50}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(value) => [formatMoneyShort(Number(value), "ARS"), "ARS"]}
          labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
        />
        <Area
          type="monotone"
          dataKey="amount"
          stroke="oklch(0.45 0.10 195)"
          strokeWidth={2}
          fill="url(#brandGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
