import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Lightbulb } from "lucide-react";
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

export default async function ConsejosUnidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ unitId: string }>;
  searchParams: Promise<{ cat?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { organization, role } = await getCurrentOrg();

  const { unitId } = await params;
  const { cat } = await searchParams;
  const category =
    cat && (UNIT_TIP_CATEGORIES as string[]).includes(cat)
      ? (cat as UnitTipCategory)
      : null;

  const allUnits = await listUnitsForTipsPicker();
  const unit = allUnits.find((u) => u.id === unitId);
  if (!unit) notFound();

  const tips = await listUnitTips({
    unitId,
    ...(category ? { category } : {}),
  });

  return (
    <div className="px-4 pt-4 pb-8 space-y-4 max-w-2xl mx-auto">
      <Link
        href="/m/consejos"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={12} />
        Todos los consejos
      </Link>

      {/* Hero unit-specific */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 p-5 text-white shadow-sm">
        <div className="relative z-10">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider opacity-80 font-medium">
            <Building2 size={11} />
            <span className="font-mono">{unit.code}</span>
          </div>
          <h1 className="text-xl font-semibold leading-tight mt-1 truncate">{unit.name}</h1>
          <div className="flex items-center gap-1.5 mt-2 text-xs opacity-90">
            <Lightbulb size={13} />
            Consejos para este depto
          </div>
        </div>
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
        unitId={unitId}
        category={category ?? undefined}
        showUnit={false}
        emptyMessage={
          category
            ? `No hay consejos de "${category}" para este depto.`
            : "Sé la primera en compartir un consejo de este depto."
        }
      />

      <TipsFab lockedUnit={unit} defaultCategory={category ?? "general"} />
    </div>
  );
}
