import type { Metadata } from "next";
import Link from "next/link";
import { Heart, Search, UserRound } from "lucide-react";
import { requireGuestSession } from "@/lib/actions/guest-auth";
import { listGuestReservations } from "@/lib/actions/reservation-status";
import type { ReservationListItem } from "@/lib/marketplace/contracts";
import { isActiveStage } from "@/lib/marketplace/guest-stage";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArchShape, BrandDot } from "@/components/marketplace/brand/brand-shapes";
import { FormAlert } from "@/components/marketplace/shell/form-fields";
import { ReservationList } from "@/components/marketplace/reservation/reservation-list";
import { ReservationTabs } from "@/components/marketplace/reservation/reservation-tabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mis reservas",
  robots: { index: false, follow: false },
};

function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Aviso para quien pidió sin ingresar: esos pedidos se siguen por el link del mail. */
function LinkHint() {
  return (
    <p className="text-sm leading-relaxed text-ink-500">
      ¿Hiciste un pedido sin ingresar a tu cuenta? Lo seguís desde el link que te mandamos por mail.
    </p>
  );
}

function EmptyTab({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-3xl bg-paper px-5 py-8 ring-1 ring-cream-300 sm:flex-row sm:items-center sm:px-8">
      <div aria-hidden className="relative flex h-20 w-16 shrink-0 items-end justify-center">
        <ArchShape className="absolute inset-0 rounded-b-xl bg-leaf-200" />
        <ApartLogo variant="symbol" title={null} className="relative mb-4 h-8 text-forest-700" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-extrabold tracking-[-0.01em] text-forest-700">{title}</p>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-700">{body}</p>
      </div>
      <ApartButton asChild variant="cta" size="lg" className="w-full sm:w-auto">
        <Link href="/buscar">
          <Search aria-hidden />
          Buscar alojamiento
        </Link>
      </ApartButton>
    </div>
  );
}

/**
 * "Mis reservas" del huésped con cuenta: pedidos y reservas vinculados a su
 * usuario (nunca por coincidencia de email), próximas primero.
 */
export default async function MiCuentaPage() {
  const session = await requireGuestSession("/mi-cuenta");
  const name = firstName(session.profile?.full_name);

  let items: ReservationListItem[] = [];
  let failed = false;
  try {
    items = await listGuestReservations();
  } catch (e) {
    console.error("[mi-cuenta] listGuestReservations:", e);
    failed = true;
  }
  const upcoming = items.filter((i) => isActiveStage(i.stage));
  const past = items.filter((i) => !isActiveStage(i.stage));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-apart text-[2rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 sm:text-[2.75rem]">
            Hola{name ? `, ${name}` : ""}
            <BrandDot />
          </h1>
          <p className="mt-2 font-apart-serif text-lg italic text-forest-600 sm:text-xl">
            Acá están tus pedidos y reservas.
          </p>
        </div>
        <nav aria-label="Tu cuenta" className="flex flex-wrap gap-2">
          <ApartButton asChild variant="secondary" size="md">
            <Link href="/mi-cuenta/perfil">
              <UserRound aria-hidden />
              Mis datos
            </Link>
          </ApartButton>
          <ApartButton asChild variant="secondary" size="md">
            <Link href="/favoritos">
              <Heart aria-hidden />
              Favoritos
            </Link>
          </ApartButton>
        </nav>
      </header>

      <div className="mt-8 sm:mt-10">
        {failed ? (
          <FormAlert tone="error" title="No pudimos cargar tus reservas">
            Probá actualizar la página en un rato. Si necesitás algo urgente, escribinos.
          </FormAlert>
        ) : items.length === 0 ? (
          <div className="space-y-4">
            <EmptyTab
              title="Todavía no tenés reservas."
              body="Cuando pidas una, la vas a ver acá con cada novedad: la confirmación, la seña y tu llegada."
            />
            <LinkHint />
          </div>
        ) : (
          <div className="space-y-6">
            <ReservationTabs
              upcomingCount={upcoming.length}
              pastCount={past.length}
              defaultTab={upcoming.length === 0 && past.length > 0 ? "anteriores" : "proximas"}
              upcoming={
                upcoming.length > 0 ? (
                  <ReservationList items={upcoming} />
                ) : (
                  <EmptyTab
                    title="No tenés reservas próximas."
                    body="Tu lugar en Córdoba, por el tiempo que necesites. Buscá fechas y pedí sin pagar nada."
                  />
                )
              }
              past={
                past.length > 0 ? (
                  <ReservationList items={past} />
                ) : (
                  <p className="rounded-3xl bg-paper px-5 py-6 text-[0.9375rem] text-ink-700 ring-1 ring-cream-300">
                    Todavía no tenés reservas anteriores.
                  </p>
                )
              }
            />
            <LinkHint />
          </div>
        )}
      </div>
    </div>
  );
}
