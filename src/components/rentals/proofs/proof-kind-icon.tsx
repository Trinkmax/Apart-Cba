import {
  Building2,
  Droplets,
  FileText,
  Flame,
  Landmark,
  Receipt,
  ShieldCheck,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SERVICE_KIND_META } from "@/lib/rentals/labels";
import type { RentalServiceKind } from "@/lib/types/database";

/**
 * Ícono y color de cada tipo de comprobante (expensas, luz, gas…). Server-safe:
 * lo usan la pantalla Comprobantes, la grilla del contrato y el portal.
 */

const ICONS: Record<RentalServiceKind, LucideIcon> = {
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

/** Color por tipo (hex): ayuda a reconocerlos de un vistazo en listas largas. */
export const KIND_COLOR: Record<RentalServiceKind, string> = {
  expensas: "#0d9488",
  luz: "#d97706",
  gas: "#ea580c",
  agua: "#0284c7",
  municipal: "#4f46e5",
  inmobiliario: "#7c3aed",
  internet: "#0891b2",
  seguro: "#059669",
  otro: "#64748b",
};

export function kindLabel(kind: RentalServiceKind): string {
  return SERVICE_KIND_META[kind]?.label ?? "Comprobante";
}

export function ProofKindIcon({ kind, size = 16, className }: { kind: RentalServiceKind; size?: number; className?: string }) {
  const Icon = ICONS[kind] ?? Receipt;
  return <Icon size={size} className={className} aria-hidden />;
}

/** Cuadradito de color con el ícono del tipo. */
export function KindChip({ kind, size = "md", className }: { kind: RentalServiceKind; size?: "sm" | "md" | "lg"; className?: string }) {
  const color = KIND_COLOR[kind] ?? KIND_COLOR.otro;
  const box = size === "sm" ? "size-7 rounded-md" : size === "lg" ? "size-11 rounded-xl" : "size-9 rounded-lg";
  const icon = size === "sm" ? 14 : size === "lg" ? 20 : 16;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", box, className)}
      style={{ color, backgroundColor: `${color}18` }}
      title={kindLabel(kind)}
    >
      <ProofKindIcon kind={kind} size={icon} />
    </span>
  );
}
