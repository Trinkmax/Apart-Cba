import { listConversations } from "@/lib/actions/crm-conversations";
import { listTags } from "@/lib/actions/crm-tags";
import { listChannels } from "@/lib/actions/crm-channels";
import { InboxClient } from "./inbox-client";

export async function InboxShell() {
  const [conversations, tags, channels] = await Promise.all([
    listConversations({ status: "all", limit: 200 }),
    listTags(),
    listChannels(),
  ]);

  return (
    <InboxClient
      initialConversations={conversations}
      tags={tags}
      channels={channels}
    />
  );
}
