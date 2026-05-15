import Link from "next/link";
import { cn } from "@/lib/utils";

/** Control segmentado Por propietario / Por período. Presentacional (RSC). */
export function SettlementsViewTabs({
  active,
}: {
  active: "propietario" | "periodo";
}) {
  const tabs = [
    { href: "/dashboard/liquidaciones", key: "propietario", label: "Por propietario" },
    { href: "/dashboard/liquidaciones/periodo", key: "periodo", label: "Por período" },
  ] as const;
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "px-3 py-1.5 text-sm rounded-md transition-colors",
            active === t.key
              ? "bg-card shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
