import { Bell } from "lucide-react";
import {
  listNotifications,
  getUnreadCount,
} from "@/lib/actions/notifications";
import { listUpcomingSchedule } from "@/lib/actions/payment-schedule";
import { listAccounts } from "@/lib/actions/cash";
import { AlertsClient } from "@/components/notifications/alerts-client";

export default async function AlertasPage() {
  const [notifications, unread, upcoming, accounts] = await Promise.all([
    listNotifications("all", 200),
    getUnreadCount(),
    listUpcomingSchedule(30),
    listAccounts(),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-rose-500/10 ring-1 ring-amber-500/20 flex items-center justify-center">
            <Bell size={20} className="text-amber-700 dark:text-amber-300" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Alertas y notificaciones
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Recordatorios de cobros, vencimientos y eventos del sistema
            </p>
          </div>
        </div>
      </div>

      <AlertsClient
        initialNotifications={notifications}
        initialUnreadCount={unread}
        upcomingSchedule={upcoming}
        accounts={accounts}
      />
    </div>
  );
}
