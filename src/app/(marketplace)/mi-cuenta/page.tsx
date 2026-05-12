import Link from "next/link";
import Image from "next/image";
import { CalendarClock, CheckCircle2, Clock, XCircle, MessageSquare } from "lucide-react";
import { requireGuestSession } from "@/lib/actions/guest-auth";
import { listGuestBookings } from "@/lib/actions/marketplace-bookings";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { TimeUntil } from "@/components/marketplace/time-until";

export const metadata = {
  title: "Mi cuenta · rentOS",
};

type BookingRow = {
  id: string;
  unit_id: string;
  organization_id: string;
  check_in_date: string;
  check_out_date: string;
  total_amount: number;
  currency: string;
  status: string;
  paid_amount?: number;
  unit?: { id: string; slug: string | null; marketplace_title: string | null; name: string; cover_image_url: string | null } | null;
  organization?: { name: string } | null;
};

type RequestRow = {
  id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  total_amount: number;
  currency: string;
  expires_at: string;
  rejection_reason: string | null;
  unit?: { id: string; slug: string | null; marketplace_title: string | null; name: string; cover_image_url: string | null } | null;
  organization?: { name: string } | null;
};

export default async function MiCuentaPage() {
  const session = await requireGuestSession();
  const { bookings, requests } = await listGuestBookings();

  const allBookings = bookings as BookingRow[];
  const allRequests = requests as RequestRow[];

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = allBookings.filter((b) => b.check_in_date >= today && b.status !== "cancelada");
  const past = allBookings.filter((b) => b.check_in_date < today || b.status === "check_out");
  const pendingRequests = allRequests.filter((r) => r.status === "pendiente");

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-2 mb-10">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold text-neutral-900">
            Hola, {session.profile.full_name.split(" ")[0]} 👋
          </h1>
          <p className="text-neutral-500 mt-1">Tus reservas y solicitudes en un solo lugar.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/mi-cuenta/perfil"
            className="text-sm font-medium text-neutral-700 hover:text-neutral-900 px-4 py-2 rounded-full border border-neutral-300 hover:border-neutral-700"
          >
            Editar perfil
          </Link>
          <Link
            href="/favoritos"
            className="text-sm font-medium text-neutral-700 hover:text-neutral-900 px-4 py-2 rounded-full border border-neutral-300 hover:border-neutral-700"
          >
            Favoritos
          </Link>
        </div>
      </header>

      {pendingRequests.length > 0 ? (
        <section className="mb-10">
          <SectionTitle icon={<Clock size={16} />} title="Solicitudes pendientes" count={pendingRequests.length} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {pendingRequests.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-10">
        <SectionTitle
          icon={<CalendarClock size={16} />}
          title="Próximas estadías"
          count={upcoming.length}
        />
        <div className="mt-4">
          {upcoming.length === 0 ? (
            <EmptyState
              title="Tu próxima aventura te espera"
              body="Reservá un lugar increíble para tu próxima escapada."
              ctaHref="/buscar"
              ctaLabel="Explorar lugares"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {upcoming.map((b) => (
                <BookingCard key={b.id} booking={b} />
              ))}
            </div>
          )}
        </div>
      </section>

      {past.length > 0 ? (
        <section className="mb-10">
          <SectionTitle icon={<CheckCircle2 size={16} />} title="Estadías pasadas" count={past.length} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {past.slice(0, 6).map((b) => (
              <BookingCard key={b.id} booking={b} compact />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
}) {
  return (
    <h2 className="text-sm font-semibold text-neutral-600 uppercase tracking-wide flex items-center gap-2">
      {icon}
      <span>{title}</span>
      <span className="text-neutral-400">·</span>
      <span className="text-neutral-500">{count}</span>
    </h2>
  );
}

function BookingCard({ booking, compact = false }: { booking: BookingRow; compact?: boolean }) {
  const unit = booking.unit;
  const slug = unit?.slug ?? unit?.id ?? booking.unit_id;
  const title = unit?.marketplace_title ?? unit?.name ?? "Reserva";
  const cover = unit?.cover_image_url;

  return (
    <Link
      href={`/mi-cuenta/reservas/${booking.id}`}
      className="group flex gap-4 p-3 rounded-2xl border border-neutral-200 hover:shadow-md transition-shadow bg-white"
    >
      <div className="relative h-24 w-32 shrink-0 rounded-xl overflow-hidden bg-neutral-100">
        {cover ? (
          <Image src={cover} alt={title} fill sizes="128px" className="object-cover" />
        ) : null}
      </div>
      <div className="flex-1 min-w-0 py-1">
        <div className="text-xs text-neutral-500 line-clamp-1">
          {booking.organization?.name ?? ""}
        </div>
        <div className="font-medium text-neutral-900 group-hover:underline underline-offset-4 line-clamp-1">
          {title}
        </div>
        <div className="text-sm text-neutral-600 mt-1">
          {formatRange(booking.check_in_date, booking.check_out_date)}
        </div>
        <div className="text-sm text-neutral-900 font-medium mt-1">
          {formatCurrency(booking.total_amount, booking.currency)}
        </div>
        {!compact ? (
          <StatusPill status={booking.status as BookingStatusValue} />
        ) : null}
        <Link href={`/u/${slug}`} className="hidden">
          {/* prefetch unit page */}view
        </Link>
      </div>
    </Link>
  );
}

function RequestCard({ request }: { request: RequestRow }) {
  const unit = request.unit;
  const title = unit?.marketplace_title ?? unit?.name ?? "Solicitud";
  const cover = unit?.cover_image_url;

  return (
    <div className="flex gap-4 p-3 rounded-2xl border border-amber-200 bg-amber-50/50">
      <div className="relative h-24 w-32 shrink-0 rounded-xl overflow-hidden bg-neutral-100">
        {cover ? <Image src={cover} alt={title} fill sizes="128px" className="object-cover" /> : null}
      </div>
      <div className="flex-1 min-w-0 py-1">
        <div className="text-xs text-amber-700 font-medium uppercase tracking-wide flex items-center gap-1">
          <Clock size={11} />
          Esperando respuesta · <TimeUntil isoDeadline={request.expires_at} />
        </div>
        <div className="font-medium text-neutral-900 mt-1 line-clamp-1">{title}</div>
        <div className="text-sm text-neutral-600 mt-0.5">
          {formatRange(request.check_in_date, request.check_out_date)}
        </div>
        <div className="text-sm text-neutral-900 font-medium mt-1">
          {formatCurrency(request.total_amount, request.currency)}
        </div>
      </div>
    </div>
  );
}

type BookingStatusValue = "pendiente" | "confirmada" | "check_in" | "check_out" | "cancelada" | "no_show";

function StatusPill({ status }: { status: BookingStatusValue }) {
  const map: Record<BookingStatusValue, { label: string; cls: string }> = {
    pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800" },
    confirmada: { label: "Confirmada", cls: "bg-emerald-100 text-emerald-800" },
    check_in: { label: "Disfrutando", cls: "bg-sky-100 text-sky-800" },
    check_out: { label: "Finalizada", cls: "bg-neutral-100 text-neutral-700" },
    cancelada: { label: "Cancelada", cls: "bg-rose-100 text-rose-800" },
    no_show: { label: "No-show", cls: "bg-neutral-200 text-neutral-700" },
  };
  const s = map[status] ?? { label: status, cls: "bg-neutral-100" };
  return (
    <span className={`mt-1.5 inline-block text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function EmptyState({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 p-10 text-center">
      <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
      <p className="text-sm text-neutral-600 mt-1.5 max-w-sm mx-auto">{body}</p>
      <Link
        href={ctaHref}
        className="mt-5 inline-flex items-center rounded-full bg-neutral-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-800"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

function formatRange(from: string, to: string) {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const fmt = (d: Date) =>
    d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  return `${fmt(f)} → ${fmt(t)}`;
}

void XCircle;
void MessageSquare;
