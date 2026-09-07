"use client";

import { MonitorDown, Smartphone } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { requestInstall, useInstallApp } from "@/components/pwa/install-app-prompt";

/**
 * Item "Instalar la app en este dispositivo" para el menú de usuario del
 * dashboard. Requiere un <InstallAppListener/> montado en el mismo shell (es
 * quien aloja el diálogo de instrucciones). Desaparece cuando ya corre
 * instalada.
 */
export function InstallAppMenuItem() {
  const { hidden } = useInstallApp();
  if (hidden) return null;
  return (
    <DropdownMenuItem onSelect={() => void requestInstall()} className="cursor-pointer">
      <MonitorDown size={14} />
      Instalar la app en este dispositivo
    </DropdownMenuItem>
  );
}

/**
 * Misma acción como botón compacto para el header de /m (limpieza y
 * mantenimiento nunca abren el menú del dashboard).
 */
export function InstallAppButton({ className }: { className?: string }) {
  const { hidden } = useInstallApp();
  if (hidden) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => void requestInstall()}
      className={className ?? "h-8 gap-1.5 px-2 text-xs tap"}
      aria-label="Instalar la app en este dispositivo"
    >
      <Smartphone size={14} />
      Instalar
    </Button>
  );
}
