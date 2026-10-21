import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { listUnitsGuestInfo } from "@/lib/actions/units";
import { isAdminLevel } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { todayYmdInTz } from "@/lib/dates";
import { getGuestMessageTemplates } from "@/lib/email/booking-templates";
import {
  bookingMessageVariables,
  sampleMessageVariables,
  type BookingMessageSource,
} from "@/lib/email/booking-message";
import {
  GUEST_MESSAGE_EVENTS,
  isGuestMessageEvent,
} from "@/lib/email/templates/guest-defaults";
import { DomainCard } from "@/components/settings/org/domain-card";
import { TemplatesSection } from "@/components/settings/org/templates-section";
import { UnitGuestInfoEditor } from "@/components/settings/org/unit-guest-info-editor";

export const dynamic = "force-dynamic";

type PreviewBooking = BookingMessageSource["booking"] & {
  guest: BookingMessageSource["guest"];
  unit: BookingMessageSource["unit"];
};

export default async function ComunicacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ abrir?: string }>;
}) {
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) redirect("/dashboard");
  const { abrir } = await searchParams;

  const admin = createAdminClient();
  // La vista previa se arma con la próxima reserva real (su depto, su
  // huésped): así se ve el link de Maps y el instructivo de verdad.
  const [templates, units, { data: next }] = await Promise.all([
    getGuestMessageTemplates(organization.id),
    listUnitsGuestInfo(),
    admin
      .from("bookings")
      .select(
        `check_in_date, check_out_date, check_in_time, check_out_time, total_amount,
         paid_amount, deposit_amount, security_deposit, currency, guests_count, mode,
         guest:guests(full_name, email, phone),
         unit:units(name, code, address, marketplace_title, guest_maps_url, guest_instructions)`
      )
      .eq("organization_id", organization.id)
      .eq("is_block", false)
      .not("status", "in", "(cancelada,no_show)")
      .gte("check_out_date", todayYmdInTz(organization.timezone || undefined))
      .order("check_in_date")
      .limit(1)
      .maybeSingle(),
  ]);

  const preview = next as unknown as PreviewBooking | null;
  const previewVars = preview
    ? bookingMessageVariables({ booking: preview, guest: preview.guest, unit: preview.unit, org: organization })
    : sampleMessageVariables(organization.name);
  const previewLabel = preview
    ? `la reserva de ${previewVars.guest.full_name || "un huésped"} en ${previewVars.unit.name || "su depto"}`
    : "un ejemplo";

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
          Comunicaciones
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Los mensajes que le mandás al huésped y el dominio de los mails.
        </p>
      </header>

      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-3">
        <h3 className="text-sm font-semibold">Mensajes al huésped</h3>
        <TemplatesSection
          templates={GUEST_MESSAGE_EVENTS.map((event) => ({ event_type: event, ...templates[event] }))}
          previewVars={previewVars}
          previewLabel={previewLabel}
          initialOpen={abrir && isGuestMessageEvent(abrir) ? abrir : null}
        />
      </div>

      <div id="deptos" className="scroll-mt-20 rounded-lg border bg-card p-4 sm:p-6 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Datos de cada depto</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Lo que cambia de un depto a otro: el link de Google Maps y su instructivo (cómo entrar, piso, wifi…).
            En los mensajes van con «Link de Google Maps» e «Instructivo del depto».
          </p>
        </div>
        <UnitGuestInfoEditor units={units} />
      </div>

      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-3">
        <h3 className="text-sm font-semibold">Dominio de envío</h3>
        <DomainCard organization={organization} />
      </div>
    </section>
  );
}
