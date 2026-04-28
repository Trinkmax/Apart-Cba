"use client";

import { useState } from "react";
import { Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnitFormDialog } from "@/components/units/unit-form-dialog";
import type { Unit } from "@/lib/types/database";

interface EditUnitButtonProps {
  unit: Unit;
}

export function EditUnitButton({ unit }: EditUnitButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        onClick={() => setOpen(true)}
      >
        <Edit size={14} /> Editar
      </Button>
      <UnitFormDialog unit={unit} open={open} onOpenChange={setOpen} />
    </>
  );
}
