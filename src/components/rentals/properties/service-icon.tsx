import { Building2, Droplets, FileText, Flame, Landmark, Receipt, ShieldCheck, Wifi, Zap, type LucideIcon } from "lucide-react";
import type { RentalServiceKind } from "@/lib/types/database";

/** Ícono de cada servicio (mismo mapa que SERVICE_KIND_META.iconName). Server-safe. */
export const SERVICE_ICON: Record<RentalServiceKind, LucideIcon> = {
  expensas: Building2,
  luz: Zap,
  gas: Flame,
  agua: Droplets,
  municipal: Landmark,
  inmobiliario: FileText,
  internet: Wifi,
  seguro: ShieldCheck,
  otro: Receipt,
};

/** Color de acento por servicio (chip del ícono). */
export const SERVICE_TINT: Record<RentalServiceKind, string> = {
  expensas: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  luz: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  gas: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  agua: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  municipal: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  inmobiliario: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  internet: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  seguro: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  otro: "bg-muted text-muted-foreground",
};

export function ServiceIcon({ kind, size = 15 }: { kind: RentalServiceKind; size?: number }) {
  const Icon = SERVICE_ICON[kind] ?? Receipt;
  return <Icon size={size} aria-hidden />;
}
