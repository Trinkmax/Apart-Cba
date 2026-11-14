import Link from "next/link";
import { ArrowRight, LogIn, LogOut } from "lucide-react";
import { formatDate } from "@/lib/format";
import { hhmm } from "@/lib/dashboard/today";
import { cn } from "@/lib/utils";

/*
 * Lo que viene después de hoy (lo de hoy ya está arriba, en el tablero del
 * día): llegadas y salidas de los próximos días, una al lado de la otra.
 */

type Arrival = { id: string; check_in_date: string; check_in_time: string; guest_name: string | null; unit_code: string; guests_count: number };
type Departure = { id: string; check_out_date: string; check_out_time: string; guest_name: string | null; unit_code: string };

export function UpcomingCard({
  arrivals,
  departures,
  today,
  className,
}: {
  arrivals: Arrival[];
  departures: Departure[];
  today: string;
  className?: string;
}) {
  const nextIn = arrivals.filter((b) => b.check_in_date > today).slice(0, 5);
  const nextOut = departures.filter((b) => b.check_out_date > today).slice(0, 5);

  return (
    <section className={cn("rounded-[22px] border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Próximos días</h2>
        <Link href="/dashboard/reservas" className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
          Todas las reservas <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      <div className="mt-3 grid gap-x-8 gap-y-4 md:grid-cols-2">
        <Column icon={LogIn} title="Llegadas" tone="in" empty="Sin llegadas en los próximos días.">
          {nextIn.map((b) => (
            <Row
              key={b.id}
              href={`/dashboard/reservas/${b.id}`}
              date={b.check_in_date}
              title={b.guest_name?.trim() || "Sin huésped cargado"}
              meta={[b.unit_code, `${b.guests_count} ${b.guests_count === 1 ? "persona" : "personas"}`, hhmm(b.check_in_time)].filter(Boolean).join(" · ")}
              tone="in"
            />
          ))}
        </Column>
        <Column icon={LogOut} title="Salidas" tone="out" empty="Sin salidas en los próximos días.">
          {nextOut.map((b) => (
            <Row
              key={b.id}
              href={`/dashboard/reservas/${b.id}`}
              date={b.check_out_date}
              title={b.guest_name?.trim() || "Sin huésped cargado"}
              meta={[b.unit_code, hhmm(b.check_out_time)].filter(Boolean).join(" · ")}
              tone="out"
            />
          ))}
        </Column>
      </div>
    </section>
  );
}

function Column({
  icon: Icon,
  title,
  tone,
  empty,
  children,
}: {
  icon: typeof LogIn;
  title: string;
  tone: "in" | "out";
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        <Icon className={cn("size-3.5", tone === "in" ? "text-emerald-500" : "text-sky-500")} aria-hidden />
        {title}
      </div>
      {children.length === 0 ? (
        <p className="py-3 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">{children}</ul>
      )}
    </div>
  );
}

function Row({
  href,
  date,
  title,
  meta,
  tone,
}: {
  href: string;
  date: string;
  title: string;
  meta: string;
  tone: "in" | "out";
}) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/55">
        <span
          className={cn(
            "flex size-10 shrink-0 flex-col items-center justify-center rounded-xl leading-none",
            tone === "in" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-sky-500/10 text-sky-700 dark:text-sky-300",
          )}
        >
          <span className="text-[15px] font-semibold tabular-nums">{formatDate(date, "d")}</span>
          <span className="mt-0.5 text-[9px] font-medium tracking-wider uppercase opacity-80">{formatDate(date, "MMM")}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{title}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{meta}</span>
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground capitalize">{formatDate(date, "EEE")}</span>
      </Link>
    </li>
  );
}
