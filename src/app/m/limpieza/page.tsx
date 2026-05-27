import { Sparkles } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { listCleaningTasks } from "@/lib/actions/cleaning";
import { MobileCleaningList } from "@/components/cleaning/mobile-cleaning-list";
import type { CleaningTask, UnitRef } from "@/lib/types/database";

type CT = CleaningTask & { unit: UnitRef };

export default async function MobileLimpiezaPage() {
  const session = await getSession();
  if (!session) return null;
  const { role } = await getCurrentOrg();
  const all = (await listCleaningTasks()) as CT[];
  const mine = all.filter(
    (c) =>
      c.assigned_to === session.userId &&
      ["pendiente", "en_progreso", "completada"].includes(c.status)
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="size-5 text-cyan-500" />
        <h1 className="text-xl font-semibold">Limpieza</h1>
      </div>
      <MobileCleaningList
        tasks={mine}
        currentUserId={session.userId}
        currentUserRole={role}
      />
    </div>
  );
}
