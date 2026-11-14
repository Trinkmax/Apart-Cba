import Link from "next/link";
import { ArrowRight, LogIn, LogOut, Sparkles, Sun } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { loadToday } from "@/lib/dashboard/today-data";
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz } from "@/lib/dates";
import {
  briefLines,
  cleaningState,
  headlineSegments,
  hhmm,
  sortCleanings,
  type CleaningState,
} from "@/lib/dashboard/today";
import { cn } from "@/lib/utils";
import type { ParteDiarioBookingRow, ParteDiarioCleaningRow } from "@/lib/types/database";
import { TexAskButton } from "./tex-ask-button";

/*
 * El día, arriba de todo: quién entra, quién sale y qué hay que limpiar, en
 * tres columnas que se leen de un vistazo. Es lo primero que se mira a la
 * mañana; antes estaba repartido entre cuatro tarjetas de estados de unidades
 * y dos listas de "próximos" que no distinguían hoy de la semana que viene.
 */

export type DayBoardData = {
  checkIns: ParteDiarioBookingRow[];
  checkOuts: ParteDiarioBookingRow[];
  cleanings: ParteDiarioCleaningRow[];
  requests: number;
};

const MAX_ROWS = 6;

export async function DayBoard({ texEnabled }: { texEnabled: boolean }) {
  const { organization } = await getCurrentOrg();
  const today = todayYmdInTz(organization.timezone || DEFAULT_ORG_TIMEZONE);
  // Misma lectura que "Tex te cuenta" y que la página (una sola por request).
  const { parte, requests } = await loadToday(today);
  if (!parte) return null;
  return (
    <DayBoardView
      texEnabled={texEnabled}
      data={{ checkIns: parte.check_ins, checkOuts: parte.check_outs, cleanings: parte.sucios, requests }}
    />
  );
}

export function DayBoardView({ data, texEnabled }: { data: DayBoardData; texEnabled: boolean }) {
  const arriving = new Set(data.checkIns.map((b) => b.unit_id));
  const pendingCleanings = data.cleanings.filter((c) => cleaningState(c) !== "lista");
  const dirtyUnits = new Set(pendingCleanings.map((c) => c.unit_id));
  const counts = {
    checkIns: data.checkIns.length,
    checkOuts: data.checkOuts.length,
    dirtyWithArrival: pendingCleanings.filter((c) => arriving.has(c.unit_id)).length,
    dirty: pendingCleanings.length,
    requests: data.requests,
  };
  const lines = briefLines(counts);
  const cleaningByUnit = new Map(data.cleanings.map((c) => [c.unit_id, c]));
  const byTime = (key: "check_in_time" | "check_out_time") => (a: ParteDiarioBookingRow, b: ParteDiarioBookingRow) =>
    (hhmm(a[key]) ?? "99").localeCompare(hhmm(b[key]) ?? "99");

  return (
    <section
      aria-labelledby="hoy-titulo"
      className="@container overflow-hidden rounded-[22px] border border-border/70 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-24px_rgba(0,0,0,0.25)]"
    >
      <div className="relative px-5 pt-5 pb-4 sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-[oklch(0.75_0.09_152)] opacity-[0.13] blur-3xl dark:opacity-[0.08]"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[oklch(0.5_0.09_152)]/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em] text-[oklch(0.42_0.09_152)] uppercase dark:bg-[oklch(0.7_0.09_152)]/15 dark:text-[oklch(0.84_0.08_150)]">
              <Sun className="size-3" aria-hidden />
              Hoy
            </span>
            <h2 id="hoy-titulo" className="mt-2 text-[22px] leading-tight font-semibold tracking-[-0.015em] sm:text-[26px]">
              {headlineSegments(counts).map((s, i) =>
                s.tone ? (
                  <span
                    key={i}
                    className={cn(
                      "tabular-nums",
                      s.tone === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400",
                    )}
                  >
                    {s.text}
                  </span>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}
            </h2>
            {lines.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                {lines.map((l) => (
                  <li key={l} className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                    <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
                    {l}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {texEnabled ? (
              <TexAskButton
                prompt="Armame el plan de hoy: quién entra y sale, qué hay que limpiar primero y qué cobros o solicitudes tengo pendientes."
                label="Armame el plan"
              />
            ) : null}
            <Link
              href="/dashboard/parte-diario"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/80 px-3.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-muted/60"
            >
              Parte diario
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-px border-t border-border/70 bg-border/70 @2xl:grid-cols-2 @4xl:grid-cols-3">
        <DayColumn
          icon={LogIn}
          title="Entran"
          count={data.checkIns.length}
          tone="in"
          empty="Hoy no entra nadie."
          more={data.checkIns.length - MAX_ROWS}
        >
          {[...data.checkIns].sort(byTime("check_in_time")).slice(0, MAX_ROWS).map((b) => (
            <DayRow
              key={b.booking_id}
              href={`/dashboard/reservas/${b.booking_id}`}
              time={hhmm(b.check_in_time)}
              title={guestLabel(b)}
              subtitle={unitLabel(b)}
              badge={
                dirtyUnits.has(b.unit_id) ? (
                  <Chip tone="amber">Sin limpiar</Chip>
                ) : b.status === "pendiente" ? (
                  <Chip tone="neutral">Pendiente</Chip>
                ) : null
              }
            />
          ))}
        </DayColumn>

        <DayColumn
          icon={LogOut}
          title="Salen"
          count={data.checkOuts.length}
          tone="out"
          empty="Hoy no sale nadie."
          more={data.checkOuts.length - MAX_ROWS}
        >
          {[...data.checkOuts].sort(byTime("check_out_time")).slice(0, MAX_ROWS).map((b) => {
            const cleaning = cleaningByUnit.get(b.unit_id);
            return (
              <DayRow
                key={b.booking_id}
                href={`/dashboard/reservas/${b.booking_id}`}
                time={hhmm(b.check_out_time)}
                title={guestLabel(b)}
                subtitle={unitLabel(b)}
                badge={
                  b.status === "check_out" ? (
                    <Chip tone="done">Salió</Chip>
                  ) : arriving.has(b.unit_id) ? (
                    <Chip tone="sky">Entra otro</Chip>
                  ) : cleaning && cleaningState(cleaning) === "sin_asignar" ? (
                    <Chip tone="neutral">Limpieza sin asignar</Chip>
                  ) : null
                }
              />
            );
          })}
        </DayColumn>

        <DayColumn
          icon={Sparkles}
          title="Limpiezas"
          count={pendingCleanings.length}
          tone="clean"
          empty="Nada para limpiar hoy."
          more={data.cleanings.length - MAX_ROWS}
          moreHref="/dashboard/limpieza"
          className="@2xl:col-span-2 @4xl:col-span-1"
        >
          {sortCleanings(data.cleanings, arriving)
            .slice(0, MAX_ROWS)
            .map((c) => {
              const state = cleaningState(c);
              const why = arriving.has(c.unit_id)
                ? "Entra alguien hoy"
                : c.overdue
                  ? "Quedó de otro día"
                  : c.check_out_time
                    ? `Sale ${hhmm(c.check_out_time)}`
                    : null;
              return (
                <DayRow
                  key={c.task_id ?? `ghost-${c.unit_id}`}
                  href="/dashboard/limpieza"
                  title={c.unit_name || c.unit_code}
                  subtitle={[c.unit_code !== c.unit_name ? c.unit_code : null, c.assigned_to_name ?? (state === "lista" ? null : "Sin asignar")]
                    .filter(Boolean)
                    .join(" · ")}
                  aside={why}
                  asideUrgent={arriving.has(c.unit_id) && state !== "lista"}
                  badge={<CleaningChip state={state} />}
                  muted={state === "lista"}
                />
              );
            })}
        </DayColumn>
      </div>
    </section>
  );
}

export function DayBoardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[22px] border border-border/70 bg-card" aria-hidden>
      <div className="space-y-3 px-6 pt-5 pb-4">
        <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="grid gap-px border-t border-border/70 bg-border/70 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 bg-card p-5">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-10 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────────

const TONES = {
  in: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  out: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  clean: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
} as const;

function DayColumn({
  icon: Icon,
  title,
  count,
  tone,
  empty,
  more,
  moreHref = "/dashboard/parte-diario",
  className,
  children,
}: {
  icon: typeof LogIn;
  title: string;
  count: number;
  tone: keyof typeof TONES;
  empty: string;
  more: number;
  moreHref?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className={cn("flex min-w-0 flex-col bg-card py-3", className)}>
      <div className="flex items-center gap-2.5 px-5 pb-2 sm:px-6">
        <span className={cn("grid size-7 place-items-center rounded-lg", TONES[tone])}>
          <Icon className="size-[15px]" aria-hidden />
        </span>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="ml-auto text-[13px] font-semibold text-muted-foreground tabular-nums">{count}</span>
      </div>
      {hasRows ? (
        <ul className="flex flex-col px-2 sm:px-3">{children}</ul>
      ) : (
        <p className="px-5 py-6 text-[13px] text-muted-foreground sm:px-6">{empty}</p>
      )}
      {more > 0 ? (
        <Link
          href={moreHref}
          className="mx-5 mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground sm:mx-6"
        >
          {more === 1 ? "1 más" : `${more} más`}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function DayRow({
  href,
  time,
  title,
  subtitle,
  aside,
  asideUrgent,
  badge,
  muted,
}: {
  href: string;
  time?: string | null;
  title: string;
  subtitle?: string | null;
  aside?: string | null;
  asideUrgent?: boolean;
  badge?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted/55",
          muted && "opacity-55",
        )}
      >
        {time !== undefined ? (
          <span className="w-11 shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">{time ?? "—"}</span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] leading-snug font-medium">{title}</span>
          {subtitle || aside ? (
            <span className="block truncate text-[12px] text-muted-foreground">
              {subtitle}
              {subtitle && aside ? " · " : null}
              {aside ? <span className={cn(asideUrgent && "font-medium text-amber-700 dark:text-amber-300")}>{aside}</span> : null}
            </span>
          ) : null}
        </span>
        {badge ? <span className="shrink-0">{badge}</span> : null}
      </Link>
    </li>
  );
}

function Chip({ tone, children }: { tone: "amber" | "sky" | "neutral" | "done" | "cyan"; children: React.ReactNode }) {
  const styles = {
    amber: "bg-amber-500/14 text-amber-800 dark:text-amber-300",
    sky: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
    cyan: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
    neutral: "bg-muted text-muted-foreground",
    done: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  } as const;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", styles[tone])}>
      {children}
    </span>
  );
}

function CleaningChip({ state }: { state: CleaningState }) {
  if (state === "lista") return <Chip tone="done">Lista</Chip>;
  if (state === "en_curso") return <Chip tone="cyan">Limpiando</Chip>;
  if (state === "asignada") return <Chip tone="neutral">Asignada</Chip>;
  return <Chip tone="amber">Sin asignar</Chip>;
}

function guestLabel(b: ParteDiarioBookingRow): string {
  if (b.is_owner_use) return "Uso del propietario";
  return b.guest_name?.trim() || "Sin huésped cargado";
}

function unitLabel(b: ParteDiarioBookingRow): string {
  return b.unit_name && b.unit_name !== b.unit_code ? `${b.unit_code} · ${b.unit_name}` : b.unit_code;
}
