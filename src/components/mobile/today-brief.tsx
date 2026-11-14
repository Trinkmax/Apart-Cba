import { getTexBrief } from "@/lib/actions/tex";
import { TodayBriefCard } from "./today-brief-card";

/** El resumen del día para Hoy en el celular (va en su propio Suspense: no frena el inicio). */
export async function TodayBrief({ texEnabled }: { texEnabled: boolean }) {
  const brief = await getTexBrief().catch(() => null);
  if (!brief) return null;
  return (
    <div className="md:hidden">
      <TodayBriefCard brief={brief} texEnabled={texEnabled} />
    </div>
  );
}

export function TodayBriefSkeleton() {
  return <div className="h-[204px] animate-pulse rounded-[26px] bg-muted/60 md:hidden" aria-hidden />;
}
