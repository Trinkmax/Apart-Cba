import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getConversationDetail } from "@/lib/actions/crm-conversations";
import { MobileChat } from "@/components/crm/inbox/mobile-chat";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default async function MobileChatPage({ params }: Props) {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "view")) redirect("/sin-acceso");

  const { conversationId } = await params;
  const detail = await getConversationDetail(conversationId);
  if (!detail) notFound();

  return (
    <div className="flex flex-col h-[calc(100svh-3.5rem-5rem)]">
      <div className="border-b border-border px-3 py-2 flex items-center gap-2">
        <Link href="/m/crm/inbox" className="size-8 flex items-center justify-center rounded hover:bg-muted tap">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{detail.contact.name ?? detail.contact.phone}</h2>
          <p className="text-[10px] text-muted-foreground">{detail.contact.phone}</p>
        </div>
      </div>
      <MobileChat conversationId={conversationId} initial={detail} />
    </div>
  );
}
