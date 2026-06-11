"use client";

import dynamic from "next/dynamic";

// Carga diferida de recharts para sacarlo del chunk inicial del detalle de
// cuenta. ssr: false porque ResponsiveContainer necesita medir en cliente.
// El placeholder replica la altura real del sparkline (64px) para evitar CLS.
const RunningBalanceSparkline = dynamic(
  () => import("./running-balance-sparkline").then((m) => m.RunningBalanceSparkline),
  { ssr: false, loading: () => <div className="h-16" /> }
);

export default RunningBalanceSparkline;
