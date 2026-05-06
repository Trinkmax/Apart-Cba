"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DateNavProps {
  date: string;
  todayInTz: string;
  tomorrowInTz: string;
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function DateNav({ date, todayInTz, tomorrowInTz }: DateNavProps) {
  const router = useRouter();
  const navigate = (newDate: string) => {
    router.push(`/dashboard/parte-diario?date=${newDate}`);
  };

  const isToday = date === todayInTz;
  const isTomorrow = date === tomorrowInTz;
  const relativeLabel = isToday
    ? "Hoy"
    : isTomorrow
      ? "Mañana"
      : date < todayInTz
        ? "Histórico"
        : "Próximos días";

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Día anterior"
        onClick={() => navigate(shiftYmd(date, -1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="px-2 min-w-[90px] text-center">
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground leading-none">
          {relativeLabel}
        </div>
        <div className="text-xs font-semibold tabular-nums leading-tight mt-0.5">{date}</div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Día siguiente"
        onClick={() => navigate(shiftYmd(date, 1))}
      >
        <ChevronRight className="size-4" />
      </Button>
      {!isTomorrow ? (
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Volver a mañana"
          onClick={() => navigate(tomorrowInTz)}
          title="Volver al parte de mañana"
        >
          <RefreshCcw className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
