import { Mail } from "lucide-react";
import { getInboundEmailConfig, listInboundEmails } from "@/lib/actions/inbound-email";
import { InboundEmailClient } from "@/components/inbound-email/inbound-email-client";

export default async function InboundEmailPage() {
  const [config, emails] = await Promise.all([
    getInboundEmailConfig(),
    listInboundEmails(),
  ]);

  return (
    <div className="page-x page-y max-w-4xl mx-auto space-y-4 sm:space-y-5 md:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Mail className="size-5 text-primary" />
          Email Parser
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Recibí emails de Airbnb y Booking.com para crear reservas automáticamente
        </p>
      </div>

      <InboundEmailClient config={config} emails={emails} />
    </div>
  );
}
