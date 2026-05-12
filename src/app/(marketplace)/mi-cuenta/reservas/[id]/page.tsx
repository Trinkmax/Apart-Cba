import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, CalendarRange, MapPin, Phone, Mail, Sparkles } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { requireGuestSession } from "@/lib/actions/guest-auth";
import { formatCurrency } from "@/lib/marketplace/pricing";

export const metadata = {
  title: "Detalle de reserva · rentOS",
};

type Params = Promise<{ id: string }>;

export default async function ReservaDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const session = await requireGuestSession();
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select(
      `
        *,
        unit:units(*, photos:unit_photos(public_url, sort_order, is_cover)),
        organization:organizations(id, name, contact_email, contact_phone, logo_url),
        guest:guests(email, full_name, phone)
      `
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();

  // Validar que el huésped autenticado es el dueño
  const guestEmail = (booking.guest as { email?: string } | null)?.email;
  if (!guestEmail || guestEmail !== session.email) {
    notFound();
  }

  const unit = booking.unit as {
    id: string;
    slug: string | null;
    marketplace_title: string | null;
    name: string;
    address: string | null;
    neighborhood: string | null;
    house_rules: string | null;
    check_in_window_start: string | null;
    check_in_window_end: string | null;
    photos: { public_url: string; sort_order: number; is_cover: boolean }[];
  };
  const org = booking.organization as {
    id: string;
    name: string;
    contact_email: string | null;
    contact_phone: string | null;
    logo_url: string | null;
  };

  const cover =
    unit.photos
      ?.slice()
      .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort_order - b.sort_order)
      ?.[0]?.public_url ?? null;

  const nights = Math.max(
    1,
    Math.round(
      (new Date(`${booking.check_out_date}T00:00:00Z`).getTime() -
        new Date(`${booking.check_in_date}T00:00:00Z`).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );

  return (
    <div className="max-w-[1000px] mx-auto px-4 md:px-8 py-8 md:py-12">
      <div className="rounded-3xl bg-gradient-to-br from-emerald-50 via-white to-rose-50 border border-neutral-200 overflow-hidden">
        <div className="px-6 md:px-10 py-8 md:py-10 flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-emerald-500 text-white grid place-items-center shadow-lg">
            <CheckCircle2 size={28} />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">
              Reserva confirmada
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-neutral-900 leading-tight">
              ¡Listo! Tu lugar te espera.
            </h1>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-8 mt-8">
        <div className="space-y-6">
          <div className="rounded-2xl border border-neutral-200 overflow-hidden bg-white">
            <div className="relative h-48 md:h-64 bg-neutral-100">
              {cover ? (
                <Image src={cover} alt={unit.marketplace_title ?? unit.name} fill className="object-cover" />
              ) : null}
            </div>
            <div className="p-6">
              <Link
                href={`/u/${unit.slug ?? unit.id}`}
                className="font-semibold text-lg text-neutral-900 hover:underline underline-offset-4"
              >
                {unit.marketplace_title ?? unit.name}
              </Link>
              <div className="text-sm text-neutral-600 mt-1 flex items-center gap-1">
                <MapPin size={12} />
                {unit.neighborhood ?? unit.address ?? ""}
              </div>
            </div>
          </div>

          <section className="rounded-2xl border border-neutral-200 bg-white p-6">
            <h2 className="font-semibold text-neutral-900 mb-4 flex items-center gap-2">
              <CalendarRange size={16} />
              Tu estadía
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-neutral-200 p-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wide">Check-in</div>
                <div className="text-base font-semibold mt-1">
                  {formatDate(booking.check_in_date)}
                </div>
                <div className="text-xs text-neutral-600 mt-1">
                  Desde las {(unit.check_in_window_start ?? "15:00").slice(0, 5)}
                </div>
              </div>
              <div className="rounded-xl border border-neutral-200 p-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wide">Check-out</div>
                <div className="text-base font-semibold mt-1">
                  {formatDate(booking.check_out_date)}
                </div>
                <div className="text-xs text-neutral-600 mt-1">
                  Hasta las {(booking.check_out_time ?? "11:00").slice(0, 5)}
                </div>
              </div>
            </div>
            <div className="mt-3 text-sm text-neutral-600">
              {nights} {nights === 1 ? "noche" : "noches"} · {booking.guests_count}{" "}
              {booking.guests_count === 1 ? "huésped" : "huéspedes"}
            </div>
          </section>

          {unit.house_rules ? (
            <section className="rounded-2xl border border-neutral-200 bg-white p-6">
              <h2 className="font-semibold text-neutral-900 mb-3 flex items-center gap-2">
                <Sparkles size={16} />
                Reglas del lugar
              </h2>
              <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">
                {unit.house_rules}
              </p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6">
            <h2 className="font-semibold text-neutral-900 mb-3">Detalle del pago</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-neutral-700">
                <span>Total de la reserva</span>
                <span className="font-medium">
                  {formatCurrency(Number(booking.total_amount), booking.currency)}
                </span>
              </div>
              <div className="flex justify-between text-neutral-700">
                <span>Cobrado</span>
                <span>{formatCurrency(Number(booking.paid_amount ?? 0), booking.currency)}</span>
              </div>
              <div className="pt-2 border-t border-neutral-200 flex justify-between font-semibold">
                <span>Pendiente</span>
                <span>
                  {formatCurrency(
                    Math.max(0, Number(booking.total_amount) - Number(booking.paid_amount ?? 0)),
                    booking.currency
                  )}
                </span>
              </div>
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              Coordiná el pago con tu anfitrión directamente — rentOS no procesa pagos por ahora.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-6">
            <h2 className="font-semibold text-neutral-900 mb-3">Tu anfitrión</h2>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-full bg-rose-100 grid place-items-center text-rose-700 font-semibold">
                {org.name[0]?.toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-neutral-900">{org.name}</div>
                <div className="text-xs text-neutral-500">Anfitrión rentOS</div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {org.contact_email ? (
                <a
                  href={`mailto:${org.contact_email}`}
                  className="flex items-center gap-2 text-neutral-700 hover:text-neutral-900"
                >
                  <Mail size={14} /> {org.contact_email}
                </a>
              ) : null}
              {org.contact_phone ? (
                <a
                  href={`https://wa.me/${org.contact_phone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-neutral-700 hover:text-neutral-900"
                >
                  <Phone size={14} /> {org.contact_phone}
                </a>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-6">
            <h3 className="text-sm font-semibold text-rose-900 mb-1">Código de reserva</h3>
            <code className="text-lg font-mono font-semibold text-rose-900">
              {booking.id.slice(0, 8).toUpperCase()}
            </code>
            <p className="text-xs text-rose-700/70 mt-2">
              Compartilo con tu anfitrión si necesitan referenciar tu reserva.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
