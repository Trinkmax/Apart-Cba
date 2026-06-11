"use client";

import dynamic from "next/dynamic";

// Carga diferida de recharts (~100 KB gz) para sacarlo del chunk inicial del
// dashboard. ssr: false porque ResponsiveContainer necesita medir en cliente.
// El placeholder replica la altura real del chart (180px) para evitar CLS.
const RevenueChart = dynamic(
  () => import("./revenue-chart").then((m) => m.RevenueChart),
  { ssr: false, loading: () => <div className="h-[180px]" /> }
);

export default RevenueChart;
