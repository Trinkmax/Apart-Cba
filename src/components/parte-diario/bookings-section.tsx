import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOOKING_MODE_META } from "@/lib/constants";
import { SectionShell } from "./section-shell";
import type { ParteDiarioBookingRow } from "@/lib/types/database";
import type { ParteDiarioSectionKey } from "@/lib/constants";

interface BookingsSectionProps {
  sectionKey: Extract<ParteDiarioSectionKey, "check_outs" | "check_ins">;
  rows: ParteDiarioBookingRow[];
  emptyMessage: string;
}

export function BookingsSection({ sectionKey, rows, emptyMessage }: BookingsSectionProps) {
  return (
    <SectionShell
      sectionKey={sectionKey}
      count={rows.length}
      isEmpty={rows.length === 0}
      emptyMessage={emptyMessage}
    >
      <ul className="divide-y">
        {rows.map((row) => (
          <BookingRow key={row.booking_id} row={row} />
        ))}
      </ul>
    </SectionShell>
  );
}

function BookingRow({ row }: { row: ParteDiarioBookingRow }) {
  const modeMeta = BOOKING_MODE_META[row.mode];
  return (
    <li className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-foreground">{row.unit_code}</span>
          <span className="text-sm text-muted-foreground truncate">{row.unit_name}</span>
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {row.is_owner_use ? (
            <>
              <Crown className="size-3" />
              <span>Uso propietario</span>
            </>
          ) : (
            <span className="truncate">{row.guest_name ?? "Sin huésped"}</span>
          )}
        </p>
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 shrink-0",
          modeMeta.bgClass,
          modeMeta.ringClass,
          modeMeta.textClass,
        )}
      >
        {modeMeta.shortLabel}
      </span>
    </li>
  );
}
