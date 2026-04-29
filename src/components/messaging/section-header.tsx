"use client";

import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconColor?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  description,
  icon: Icon,
  iconColor = "text-primary",
  actions,
  className,
}: Props) {
  return (
    <header
      className={cn(
        "flex-shrink-0 px-6 py-4 border-b border-border bg-card/30 flex items-center justify-between gap-4 flex-wrap",
        className
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-9 rounded-xl bg-muted/60 grid place-items-center shrink-0">
          <Icon size={17} className={cn(iconColor)} />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight leading-tight">{title}</h2>
          {description && (
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
