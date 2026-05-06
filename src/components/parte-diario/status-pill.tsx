import { cn } from "@/lib/utils";
import { DAILY_REPORT_STATUS_META } from "@/lib/constants";
import type { DailyReportStatus } from "@/lib/types/database";

interface StatusPillProps {
  status: DailyReportStatus;
  className?: string;
}

export function StatusPill({ status, className }: StatusPillProps) {
  const meta = DAILY_REPORT_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors",
        meta.bgClass,
        meta.ringClass,
        meta.textClass,
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          meta.dotClass,
          status === "borrador" && "animate-pulse",
        )}
      />
      {meta.label}
    </span>
  );
}
