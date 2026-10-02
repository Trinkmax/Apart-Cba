"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PropertyFormDialog } from "./property-form-dialog";

/** CTA "Nueva propiedad": al guardar lleva a la ficha (ahí siguen el contrato y los documentos). */
export function NewPropertyButton({ className, label = "Nueva propiedad", size }: { className?: string; label?: string; size?: "sm" | "default" | "lg" }) {
  const router = useRouter();
  return (
    <PropertyFormDialog onSaved={(p) => router.push(`/dashboard/alquileres/propiedades/${p.id}`)}>
      <Button className={cn("gap-2 shrink-0", className)} size={size}>
        <Plus size={16} />
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">Nueva</span>
      </Button>
    </PropertyFormDialog>
  );
}
