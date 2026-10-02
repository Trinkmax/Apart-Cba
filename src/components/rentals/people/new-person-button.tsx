"use client";

import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PersonFormDialog } from "./person-form-dialog";

/** CTA "Nueva persona": al guardar (o al elegir una ya cargada) lleva a su ficha. */
export function NewPersonButton({ className, label = "Nueva persona", intent }: { className?: string; label?: string; intent?: "inquilino" | "garante" }) {
  const router = useRouter();
  return (
    <PersonFormDialog intent={intent} onSaved={(p) => router.push(`/dashboard/alquileres/personas/${p.id}`)}>
      <Button className={cn("gap-2 shrink-0", className)}>
        <UserPlus size={16} />
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">Nueva</span>
      </Button>
    </PersonFormDialog>
  );
}
