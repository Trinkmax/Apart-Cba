import {
  getMessagingStats,
  listChannels,
  listConversations,
  listTags,
  listTemplates,
  listWorkflows,
  listBroadcasts,
  listAlerts,
} from "@/lib/actions/messaging";
import { MessagingShell } from "@/components/messaging/messaging-shell";

export const metadata = { title: "Mensajería · Apart Cba" };

export default async function MensajeriaPage() {
  const [stats, channels, conversations, tags, templates, workflows, broadcasts, alerts] =
    await Promise.all([
      getMessagingStats(),
      listChannels(),
      listConversations(),
      listTags(),
      listTemplates(),
      listWorkflows(),
      listBroadcasts(),
      listAlerts(),
    ]);

  return (
    <MessagingShell
      initialStats={stats}
      initialChannels={channels}
      initialConversations={conversations}
      initialTags={tags}
      initialTemplates={templates}
      initialWorkflows={workflows}
      initialBroadcasts={broadcasts}
      initialAlerts={alerts}
    />
  );
}
