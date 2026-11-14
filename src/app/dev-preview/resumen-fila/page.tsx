// TEMPORAL — vista previa de desarrollo de la fila «Para atender» + «Unidades ahora». Se borra antes del commit.
import { notFound } from "next/navigation";
import { AlertTriangle, Bell, Inbox, Sparkles, UserPlus, Wrench } from "lucide-react";
import { AttentionCard, type AttentionItem } from "@/components/dashboard/home/attention";
import { UnitsNowCard, type UnitTotals } from "@/components/dashboard/home/units-now";

export const dynamic = "force-dynamic";

const ALL: Record<string, AttentionItem> = {
  requests: { key: "requests", href: "#", icon: Inbox, label: "Solicitudes sin responder", value: "2", detail: "Pedidos de la web que esperan tu respuesta", cta: "Responder", tone: "amber" },
  urgent: { key: "urgent", href: "#", icon: AlertTriangle, label: "Arreglo urgente", value: "1", detail: "Tickets de mantenimiento marcados como urgentes", cta: "Ver arreglos", tone: "rose" },
  complete: { key: "complete", href: "#", icon: UserPlus, label: "Reservas sin precio", value: "48", detail: "Booking y Airbnb entran sin importe: cargalo para cerrar bien el mes. Y 5 sin huésped.", cta: "Completar", tone: "amber" },
  tickets: { key: "tickets", href: "#", icon: Wrench, label: "Mantenimiento abierto", value: "12", cta: "Ver mantenimiento", tone: "neutral" },
  cleaning: { key: "cleaning", href: "#", icon: Sparkles, label: "Limpiezas pendientes", value: "9", cta: "Ver limpiezas", tone: "neutral" },
  tasks: { key: "tasks", href: "#", icon: Bell, label: "Tareas pendientes", value: "3", cta: "Ver tareas", tone: "neutral" },
};

const APART: UnitTotals = { units: 73, occupied_units: 64, cleaning_units: 6, maintenance_units: 0, available_units: 3, reserved_units: 0, blocked_units: 0 };
const VIAGGIATO: UnitTotals = { units: 21, occupied_units: 5, cleaning_units: 1, maintenance_units: 0, available_units: 3, reserved_units: 12, blocked_units: 0 };

const CASES: { id: string; items: string[]; units: UnitTotals }[] = [
  { id: "cinco", items: ["requests", "complete", "tickets", "cleaning", "tasks"], units: APART },
  { id: "seis", items: ["requests", "urgent", "complete", "tickets", "cleaning", "tasks"], units: APART },
  { id: "dos-contadores", items: ["cleaning", "tasks"], units: VIAGGIATO },
  { id: "una-accion", items: ["complete", "cleaning"], units: APART },
  { id: "nada", items: [], units: VIAGGIATO },
];

export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="page-x page-y mx-auto max-w-[1600px] space-y-10 @container">
        {CASES.map((c) => (
          <div key={c.id} data-case={c.id} className="grid gap-5 @4xl:grid-cols-3">
            <AttentionCard items={c.items.map((k) => ALL[k])} className="@4xl:col-span-2" />
            <UnitsNowCard totals={c.units} occupancy30d={47.4} href="#" />
          </div>
        ))}
      </div>
    </div>
  );
}
