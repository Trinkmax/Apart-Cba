"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CalendarCheck, Loader2, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency, type PricingBreakdown } from "@/lib/marketplace/pricing";
import { submitCheckout, type CheckoutResult } from "@/lib/actions/marketplace-bookings";
import type { GuestProfile, MarketplaceListingDetail } from "@/lib/types/database";

type Props = {
  listing: MarketplaceListingDetail;
  guest: GuestProfile;
  guestEmail: string;
  pricing: PricingBreakdown;
  currency: string;
  checkIn: string;
  checkOut: string;
  guestsCount: number;
};

export function CheckoutForm({
  listing,
  guest,
  guestEmail,
  pricing,
  currency,
  checkIn,
  checkOut,
  guestsCount,
}: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(guest.full_name);
  const [email, setEmail] = useState(guestEmail);
  const [phone, setPhone] = useState(guest.phone ?? "");
  const [document, setDocument] = useState(guest.document_number ?? "");
  const [specialRequests, setSpecialRequests] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [pending, startTransition] = useTransition();

  const totalGuests = `${guestsCount} ${guestsCount === 1 ? "huésped" : "huéspedes"}`;
  const stay = `${formatRange(checkIn, checkOut)} · ${pricing.nights_count} ${
    pricing.nights_count === 1 ? "noche" : "noches"
  }`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) {
      toast.error("Tenés que aceptar las reglas para reservar");
      return;
    }
    startTransition(async () => {
      const result: CheckoutResult = await submitCheckout({
        unit_id: listing.id,
        check_in_date: checkIn,
        check_out_date: checkOut,
        guests_count: guestsCount,
        full_name: fullName,
        email,
        phone,
        document: document || null,
        special_requests: specialRequests || null,
        agreed_to_rules: agreed,
      });
      if (!result.ok) {
        toast.error("No pudimos completar tu reserva", { description: result.error });
        return;
      }
      if (result.kind === "booking") {
        toast.success("¡Reserva confirmada!");
        router.push(`/mi-cuenta/reservas/${result.booking_id}?fresh=1`);
      } else {
        toast.success("Solicitud enviada. El anfitrión te va a responder pronto.");
        router.push(`/mi-cuenta?fresh=1&request=${result.request_id}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 lg:gap-16">
      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold text-neutral-900 mb-4">Tu viaje</h2>
          <div className="space-y-3">
            <Row label="Fechas" value={stay} />
            <Row label="Huéspedes" value={totalGuests} />
          </div>
        </section>

        <section className="pt-6 border-t border-neutral-200">
          <h2 className="text-xl font-semibold text-neutral-900 mb-4">¿Quién viaja?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nombre completo">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                disabled={pending}
                autoComplete="name"
                className={inputCls}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={pending}
                autoComplete="email"
                className={inputCls}
              />
            </Field>
            <Field label="Teléfono">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                disabled={pending}
                placeholder="+54 9 ..."
                autoComplete="tel"
                className={inputCls}
              />
            </Field>
            <Field label="Documento (opcional)">
              <input
                value={document}
                onChange={(e) => setDocument(e.target.value)}
                disabled={pending}
                placeholder="DNI / Pasaporte"
                className={inputCls}
              />
            </Field>
          </div>
        </section>

        <section className="pt-6 border-t border-neutral-200">
          <h2 className="text-xl font-semibold text-neutral-900 mb-1">
            ¿Algo que el anfitrión deba saber?
          </h2>
          <p className="text-sm text-neutral-500 mb-3">
            Hora estimada de llegada, mascotas, restricciones alimentarias, etc.
          </p>
          <textarea
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
            disabled={pending}
            rows={4}
            placeholder="Llegamos a eso de las 21:00. Vamos con un perro mediano (tiene autorización 🐕)."
            className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors resize-y"
          />
        </section>

        <section className="pt-6 border-t border-neutral-200 space-y-4">
          <h2 className="text-xl font-semibold text-neutral-900">Reglas de la propiedad</h2>
          {listing.house_rules ? (
            <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed bg-neutral-50 rounded-xl p-4 border border-neutral-200">
              {listing.house_rules}
            </p>
          ) : (
            <p className="text-sm text-neutral-500">
              El anfitrión no especificó reglas adicionales. Cuidá el lugar como si fuera tuyo.
            </p>
          )}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              required
              className="mt-0.5 h-4 w-4 rounded border-neutral-300"
            />
            <span className="text-sm text-neutral-700 leading-relaxed">
              Acepto las reglas y la política de cancelación ({listing.cancellation_policy}). Entiendo
              que esta reserva sigue los términos y la política de privacidad de rentOS.
            </span>
          </label>
        </section>

        <section className="pt-6 border-t border-neutral-200">
          <button
            type="submit"
            disabled={pending}
            className={cn(
              "w-full h-14 rounded-2xl font-semibold text-base transition-all flex items-center justify-center gap-2",
              "bg-gradient-to-r from-sage-500 to-sage-600 text-white hover:from-sage-600 hover:to-sage-700 shadow-md hover:shadow-lg",
              pending && "opacity-70 cursor-not-allowed"
            )}
          >
            {pending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : listing.instant_book ? (
              <Zap size={18} className="fill-white" />
            ) : (
              <CalendarCheck size={18} />
            )}
            {listing.instant_book ? "Confirmar reserva al toque" : "Enviar solicitud al anfitrión"}
          </button>
          <p className="mt-3 text-xs text-neutral-500 text-center">
            <ShieldCheck size={12} className="inline -mt-0.5 mr-1 text-emerald-600" />
            No se cobra al {listing.instant_book ? "reservar" : "solicitar"}. El anfitrión coordina el
            pago directamente con vos.
          </p>
        </section>
      </div>

      <aside className="lg:sticky lg:top-28 self-start">
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-6 space-y-5">
          <div className="flex gap-4">
            <div className="relative h-20 w-28 rounded-lg overflow-hidden bg-neutral-100 shrink-0">
              {listing.cover_url ? (
                <Image src={listing.cover_url} alt={listing.marketplace_title} fill sizes="120px" className="object-cover" />
              ) : null}
            </div>
            <div className="flex-1">
              <div className="text-xs text-neutral-500 line-clamp-1">
                {listing.marketplace_property_type} · {listing.organization_name}
              </div>
              <div className="text-sm font-medium text-neutral-900 line-clamp-2">
                {listing.marketplace_title}
              </div>
              {listing.rating_count > 0 ? (
                <div className="text-xs text-neutral-500 mt-1">
                  ★ {listing.rating_avg.toFixed(2)} · {listing.rating_count}{" "}
                  {listing.rating_count === 1 ? "reseña" : "reseñas"}
                </div>
              ) : null}
            </div>
          </div>

          <div className="pt-4 border-t border-neutral-200 space-y-2.5 text-sm">
            <h3 className="font-semibold text-neutral-900">Detalle de precio</h3>
            <div className="flex justify-between text-neutral-700">
              <span>
                {formatCurrency(pricing.avg_price_per_night, currency)} × {pricing.nights_count}{" "}
                {pricing.nights_count === 1 ? "noche" : "noches"}
              </span>
              <span>{formatCurrency(pricing.subtotal, currency)}</span>
            </div>
            {pricing.cleaning_fee > 0 ? (
              <div className="flex justify-between text-neutral-700">
                <span>Tarifa de limpieza</span>
                <span>{formatCurrency(pricing.cleaning_fee, currency)}</span>
              </div>
            ) : null}
            <div className="pt-3 border-t border-neutral-200 flex justify-between font-semibold">
              <span>Total ({currency})</span>
              <span className="text-base">{formatCurrency(pricing.total, currency)}</span>
            </div>
          </div>

          <div className="pt-4 border-t border-neutral-200 text-xs text-neutral-500 space-y-1">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-emerald-600" />
              Sin cargos ocultos
            </div>
            <div>Pagás directamente al anfitrión cuando lo coordinen.</div>
          </div>
        </div>
      </aside>
    </form>
  );
}

const inputCls =
  "w-full h-11 px-3 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-neutral-700 mb-1">{label}</div>
      {children}
    </label>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <span className="text-neutral-600">{label}</span>
      <span className="font-medium text-neutral-900">{value}</span>
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
