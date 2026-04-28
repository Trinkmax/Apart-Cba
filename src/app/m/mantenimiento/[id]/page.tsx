import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Clock } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { getTicket } from "@/lib/actions/tickets";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { formatDate, formatTimeAgo } from "@/lib/format";
import { MobileTicketEditor } from "@/components/tickets/mobile-ticket-editor";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MobileTicketDetailPage({ params }: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const { id } = await params;
  const ticket = await getTicket(id);
  if (!ticket) notFound();

  const sm = TICKET_STATUS_META[ticket.status as keyof typeof TICKET_STATUS_META];
  const pm =
    TICKET_PRIORITY_META[ticket.priority as keyof typeof TICKET_PRIORITY_META];

  return (
    <div className="p-4 space-y-4">
      <Link
        href="/m/mantenimiento"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} /> Volver
      </Link>

      <Card className="overflow-hidden">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: pm?.color }}
          aria-hidden
        />
        <div className="p-4 space-y-3">
          <h1 className="text-lg font-semibold leading-snug">{ticket.title}</h1>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className="font-mono gap-1.5"
              style={{ borderColor: sm?.color + "40", color: sm?.color }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: sm?.color }}
              />
              {sm?.label}
            </Badge>
            <Badge
              className="text-[10px] gap-1 border"
              style={{
                color: pm?.color,
                backgroundColor: pm?.color + "15",
                borderColor: pm?.color + "40",
              }}
            >
              {pm?.label}
            </Badge>
            <span className="text-[11px] text-muted-foreground flex items-center gap-1 ml-auto">
              <Clock size={11} /> {formatTimeAgo(ticket.opened_at)}
            </span>
          </div>
          {ticket.unit && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Building2 size={12} />
              <span className="font-mono font-semibold text-foreground">
                {ticket.unit.code}
              </span>
              <span>· {ticket.unit.name}</span>
            </div>
          )}
          {ticket.description && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
              {ticket.description}
            </p>
          )}
          <div className="text-[10px] text-muted-foreground">
            Abierto: {formatDate(ticket.opened_at)}
          </div>
        </div>
      </Card>

      <MobileTicketEditor
        ticketId={ticket.id}
        initialStatus={ticket.status}
        initialActualCost={ticket.actual_cost}
        initialCostCurrency={ticket.cost_currency ?? "ARS"}
        initialAttachments={ticket.attachments ?? []}
      />
    </div>
  );
}
