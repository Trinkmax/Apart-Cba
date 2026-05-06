import { Crown, Clock } from "lucide-react";
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
  const isCheckIn = sectionKey === "check_ins";
  return (
    <SectionShell
      sectionKey={sectionKey}
      count={rows.length}
      isEmpty={rows.length === 0}
      emptyMessage={emptyMessage}
    >
      <ul className="divide-y">
        {rows.map((row) => (
          <BookingRow key={row.booking_id} row={row} isCheckIn={isCheckIn} />
        ))}
      </ul>
    </SectionShell>
  );
}

function formatHHMM(t: string | null): string | null {
  if (!t) return null;
  // Postgres time returns "HH:MM:SS" or "HH:MM:SS.ffffff" — slice to HH:MM.
  return t.slice(0, 5);
}

function BookingRow({ row, isCheckIn }: { row: ParteDiarioBookingRow; isCheckIn: boolean }) {
  const modeMeta = BOOKING_MODE_META[row.mode];
  const time = formatHHMM(isCheckIn ? row.check_in_time : row.check_out_time);
  return (
    <li className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
      {/* Time chip a la izquierda — agarra el ojo y queda como meta-data primaria */}
      {time ? (
        <div className="flex flex-col items-center justify-center rounded-lg bg-muted/50 px-2 py-1 min-w-[52px] shrink-0">
          <Clock className="size-3 text-muted-foreground" />
          <span className="text-xs font-bold tabular-nums leading-tight mt-0.5">{time}</span>
        </div>
      ) : (
        <div className="flex items-center justify-center min-w-[52px] shrink-0">
          <span className="text-[10px] text-muted-foreground italic">sin hora</span>
        </div>
      )}
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
