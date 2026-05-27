"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { TipComposerDrawer } from "./tip-composer-drawer";
import type { UnitRef, UnitTipCategory } from "@/lib/types/database";

interface Props {
  unitsForPicker?: UnitRef[];
  lockedUnit?: UnitRef;
  defaultCategory?: UnitTipCategory;
}

/**
 * Floating Action Button para crear un consejo. Posicionado arriba del bottom
 * nav (sticky) respetando safe-area-inset-bottom de los iPhones modernos.
 */
export function TipsFab({ unitsForPicker, lockedUnit, defaultCategory }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Compartir un consejo"
        className="fixed right-4 z-30 size-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg flex items-center justify-center active:scale-95 hover:scale-105 hover:shadow-xl transition-all"
        style={{
          bottom: "calc(5rem + env(safe-area-inset-bottom) + 0.75rem)",
        }}
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
      <TipComposerDrawer
        open={open}
        onOpenChange={setOpen}
        unitsForPicker={unitsForPicker}
        lockedUnit={lockedUnit}
        defaultCategory={defaultCategory}
      />
    </>
  );
}
