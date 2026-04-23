import { Sparkles } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { listCleaningTasks } from "@/lib/actions/cleaning";
import { MobileCleaningList } from "@/components/cleaning/mobile-cleaning-list";
import type { CleaningTask, Unit } from "@/lib/types/database";

type CT = CleaningTask & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function MobileLimpiezaPage() {
  const session = await getSession();
  if (!session) return null;
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
      <MobileCleaningList tasks={mine} />
    </div>
  );
}
