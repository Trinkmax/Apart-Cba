import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PARTE_DIARIO_SECTION_META, type ParteDiarioSectionKey } from "@/lib/constants";

interface SectionShellProps {
  sectionKey: ParteDiarioSectionKey;
  count: number;
  emptyMessage: string;
  isEmpty: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Container con stripe lateral del color de la sección + título + count + slot
 * para acciones (botones de auto-asignar, expandir, etc). Empty state suave.
 */
export function SectionShell({
  sectionKey,
  count,
  emptyMessage,
  isEmpty,
  actions,
  children,
}: SectionShellProps) {
  const meta = PARTE_DIARIO_SECTION_META[sectionKey];
  return (
    <section className="relative rounded-2xl border bg-card overflow-hidden">
      <div className={cn("absolute inset-y-0 left-0 w-1", meta.dotClass)} />
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
              meta.bgClass,
              meta.ringClass,
              meta.textClass,
            )}
          >
            {meta.short}
          </span>
          <h2 className="text-sm font-semibold text-foreground">{meta.label}</h2>
          <span className="text-sm tabular-nums text-muted-foreground">{count}</span>
        </div>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </header>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Sparkles className="size-5 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>
        </div>
      ) : (
        <div>{children}</div>
      )}
    </section>
  );
}
