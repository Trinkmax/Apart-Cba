"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FileText, Hammer, History, LayoutList, Receipt, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ContractTab } from "./types";

/**
 * Pestañas de la ficha. El estado vive en `?tab=` (se comparte, el "atrás"
 * funciona) y el servidor renderiza SÓLO la pestaña activa: cambiar de
 * pestaña navega, y mientras llega se ve el esqueleto (optimista).
 */

const TAB_META: Record<ContractTab, { label: string; short: string; icon: LucideIcon }> = {
  resumen: { label: "Resumen", short: "Resumen", icon: LayoutList },
  cuenta: { label: "Cuenta corriente", short: "Cuenta", icon: Wallet },
  ajustes: { label: "Ajustes", short: "Ajustes", icon: TrendingUp },
  servicios: { label: "Expensas y servicios", short: "Servicios", icon: Receipt },
  gastos: { label: "Gastos", short: "Gastos", icon: Hammer },
  documentos: { label: "Documentos", short: "Docs", icon: FileText },
  historial: { label: "Historial", short: "Historial", icon: History },
};

export function ContractTabs({
  basePath,
  active,
  tabs,
  children,
}: {
  basePath: string;
  active: ContractTab;
  tabs: ContractTab[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(active);

  function go(value: string) {
    const tab = value as ContractTab;
    if (tab === shown) return;
    startTransition(() => {
      setShown(tab);
      router.push(tab === "resumen" ? basePath : `${basePath}?tab=${tab}`, { scroll: false });
    });
  }

  return (
    <Tabs value={shown} onValueChange={go} className="gap-4">
      <div className="-mx-1 px-1 pb-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b">
        <TabsList variant="line" className="h-10 w-max">
          {tabs.map((t) => {
            const Icon = TAB_META[t].icon;
            return (
              <TabsTrigger key={t} value={t} className="px-2.5 sm:px-3 flex-none">
                <Icon size={14} />
                <span className="hidden sm:inline">{TAB_META[t].label}</span>
                <span className="sm:hidden">{TAB_META[t].short}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <TabsContent value={shown} className="min-w-0">
        {pending && shown !== active ? <TabSkeleton /> : children}
      </TabsContent>
    </Tabs>
  );
}

export function TabSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando">
      <div className="h-5 w-40 rounded bg-muted animate-pulse" />
      <div className="h-40 rounded-xl border bg-card animate-pulse" />
      <div className="h-24 rounded-xl border bg-card animate-pulse" />
    </div>
  );
}
