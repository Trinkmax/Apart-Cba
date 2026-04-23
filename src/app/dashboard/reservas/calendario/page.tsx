import { listBookings } from "@/lib/actions/bookings";
import { listUnitsEnriched } from "@/lib/actions/units";
import { BookingsTimeline } from "@/components/bookings/bookings-timeline";

export default async function CalendarioPage() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 7);
  const end = new Date(today);
  end.setDate(today.getDate() + 60);

  const [bookings, units] = await Promise.all([
    listBookings({ fromDate: start.toISOString().slice(0, 10) }),
    listUnitsEnriched(),
  ]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-6 py-4 border-b">
        <h1 className="text-xl font-semibold tracking-tight">Calendario</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Timeline de reservas por unidad
        </p>
      </div>
      <BookingsTimeline
        units={units}
        bookings={bookings}
        startDate={start.toISOString().slice(0, 10)}
        days={67}
      />
    </div>
  );
}
