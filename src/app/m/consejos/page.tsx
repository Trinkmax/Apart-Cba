import { redirect } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import {
  listUnitTips,
  listUnitsForTipsPicker,
} from "@/lib/actions/unit-tips";
import { TipFeed } from "@/components/unit-tips/tip-feed";
import { TipsFab } from "@/components/unit-tips/tips-fab";
import { TipsCategoryFilter } from "@/components/unit-tips/tips-category-filter";
import { UNIT_TIP_CATEGORIES } from "@/lib/constants";
import type { UnitTipCategory } from "@/lib/types/database";

export default async function ConsejosPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { organization, role } = await getCurrentOrg();

  const { cat } = await searchParams;
  const category =
    cat && (UNIT_TIP_CATEGORIES as string[]).includes(cat)
      ? (cat as UnitTipCategory)
      : null;

  const [tips, units] = await Promise.all([
    listUnitTips(category ? { category } : {}),
    listUnitsForTipsPicker(),
  ]);

  return (
    <div className="px-4 pt-4 pb-8 space-y-4 max-w-2xl mx-auto">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 p-5 text-white shadow-sm">
        <div className="relative z-10">
          <div className="flex items-center gap-2">
            <Lightbulb size={20} className="drop-shadow" />
            <h1 className="text-xl font-semibold">Consejos del equipo</h1>
          </div>
          <p className="text-xs opacity-90 mt-1">
            Trucos, avisos y experiencia compartida entre todas.
          </p>
        </div>
        {/* Decoración */}
        <div className="absolute -top-6 -right-6 size-32 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-10 -left-10 size-40 rounded-full bg-yellow-300/20 blur-3xl" aria-hidden />
      </div>

      {/* Filtros */}
      <div className="sticky top-[3.5rem] z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur-md border-b">
        <TipsCategoryFilter value={category} />
      </div>

      {/* Feed */}
      <TipFeed
        initialTips={tips}
        organizationId={organization.id}
        currentUserId={session.userId}
        currentUserRole={role}
        category={category ?? undefined}
        showUnit
        emptyMessage={
          category
            ? "No hay consejos en esta categoría todavía."
            : "Sé el primero en compartir un consejo con el equipo."
        }
      />

      {/* FAB para crear */}
      <TipsFab unitsForPicker={units} defaultCategory={category ?? "general"} />
    </div>
  );
}
