"use client";

import { ResponsiveContainer, AreaChart, Area, Tooltip, YAxis } from "recharts";
import { formatMoneyShort } from "@/lib/format";

interface Point {
  date: string;
  balance: number;
}

interface Props {
  data: Point[];
  currency: string;
}

export function RunningBalanceSparkline({ data, currency }: Props) {
  if (data.length < 2) {
    return (
      <div className="flex h-16 items-center justify-center text-[11px] text-muted-foreground">
        Sin movimientos suficientes para graficar
      </div>
    );
  }
  const first = data[0].balance;
  const last = data[data.length - 1].balance;
  const trendingUp = last >= first;
  const stroke = trendingUp ? "var(--color-emerald-500, #10b981)" : "var(--color-rose-500, #f43f5e)";

  return (
    <ResponsiveContainer width="100%" height={64} minWidth={0}>
      <AreaChart data={data} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
        <Tooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "11px",
            padding: "4px 8px",
          }}
          labelStyle={{ display: "none" }}
          formatter={(value) => [formatMoneyShort(Number(value), currency), "Saldo"]}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke={stroke}
          strokeWidth={1.6}
          fill="url(#sparkGrad)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
