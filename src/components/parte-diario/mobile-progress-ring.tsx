interface MobileProgressRingProps {
  completed: number;
  total: number;
  size?: number;
}

/**
 * Ring de progreso del día. Stroke se anima desde 0 → pct con `transition-all`
 * + el dasharray, evitando libs externas.
 */
export function MobileProgressRing({ completed, total, size = 110 }: MobileProgressRingProps) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const allDone = total > 0 && completed === total;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          className="text-muted/40"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className={allDone ? "text-emerald-500 transition-all duration-700" : "text-cyan-500 transition-all duration-700"}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums leading-none">{pct}%</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
          {completed} / {total}
        </span>
      </div>
    </div>
  );
}
