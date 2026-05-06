"use client";

import { useEffect, useState } from "react";
import { Sparkles, TrendingUp } from "lucide-react";
import { getAIUsageDaily, type DailyUsageRow } from "@/lib/actions/crm-ai-usage";
import { cn } from "@/lib/utils";

const MODEL_COLOR: Record<string, string> = {
  "claude-sonnet-4-6": "#a855f7",
  "claude-opus-4-7": "#7c3aed",
  "gpt-5": "#10b981",
  "gpt-5-mini": "#14b8a6",
};

function colorFor(model: string): string {
  return MODEL_COLOR[model] ?? "#64748b";
}

export function AIUsageChart() {
  const [data, setData] = useState<DailyUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAIUsageDaily(30).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Cargando uso IA...</div>;
  }

  if (data.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        <Sparkles className="size-8 mx-auto mb-2 opacity-30" />
        Sin uso registrado en los últimos 30 días.
      </div>
    );
  }

  // Agrupar por día
  const byDay = new Map<string, { tokens: number; cost: number }>();
  const byModel = new Map<string, { tokens: number; cost: number; calls: number }>();
  for (const r of data) {
    const dayAgg = byDay.get(r.day) ?? { tokens: 0, cost: 0 };
    dayAgg.tokens += r.total_tokens;
    dayAgg.cost += Number(r.cost_usd);
    byDay.set(r.day, dayAgg);

    const modelAgg = byModel.get(r.model) ?? { tokens: 0, cost: 0, calls: 0 };
    modelAgg.tokens += r.total_tokens;
    modelAgg.cost += Number(r.cost_usd);
    modelAgg.calls += r.call_count;
    byModel.set(r.model, modelAgg);
  }

  const sortedDays = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  const maxTokens = Math.max(...sortedDays.map(([, v]) => v.tokens), 1);
  const totalTokens = sortedDays.reduce((s, [, v]) => s + v.tokens, 0);
  const totalCost = sortedDays.reduce((s, [, v]) => s + v.cost, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Tokens (30d)" value={totalTokens.toLocaleString()} icon={TrendingUp} accent="text-emerald-500" />
        <Stat label="Costo USD (30d)" value={`$${totalCost.toFixed(4)}`} icon={TrendingUp} accent="text-blue-500" />
        <Stat label="Llamadas (30d)" value={Array.from(byModel.values()).reduce((s, v) => s + v.calls, 0).toLocaleString()} icon={Sparkles} accent="text-violet-500" />
      </div>

      {/* Barras por día */}
      <div className="space-y-1.5">
        <div className="flex items-end gap-1 h-32">
          {sortedDays.map(([day, agg]) => {
            const heightPct = (agg.tokens / maxTokens) * 100;
            return (
              <div
                key={day}
                className="flex-1 flex flex-col justify-end group relative"
                title={`${day}: ${agg.tokens.toLocaleString()} tokens · $${agg.cost.toFixed(4)}`}
              >
                <div
                  className="w-full bg-emerald-500 hover:bg-emerald-400 rounded-t transition-colors"
                  style={{ height: `${heightPct}%`, minHeight: agg.tokens > 0 ? "2px" : "0" }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{sortedDays[0]?.[0]}</span>
          <span>{sortedDays[sortedDays.length - 1]?.[0]}</span>
        </div>
      </div>

      {/* Breakdown por modelo */}
      <div>
        <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Por modelo</h4>
        <div className="space-y-1.5">
          {Array.from(byModel.entries()).sort(([, a], [, b]) => b.tokens - a.tokens).map(([model, agg]) => {
            const pct = totalTokens > 0 ? (agg.tokens / totalTokens) * 100 : 0;
            return (
              <div key={model}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="font-mono">{model}</span>
                  <span className="text-muted-foreground">
                    {agg.tokens.toLocaleString()} tokens · {agg.calls} calls · ${agg.cost.toFixed(4)}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: colorFor(model) }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label, value, icon: Icon, accent,
}: { label: string; value: string; icon: React.ComponentType<{ size?: number; className?: string }>; accent: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className={cn("opacity-70", accent)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
