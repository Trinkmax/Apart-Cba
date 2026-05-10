"use client";

import { useTransition } from "react";
import { CheckCircle2, Send, Download, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { changeSettlementStatus, generateSettlement } from "@/lib/actions/settlements";
import { getOrganizationBranding } from "@/lib/actions/org";
import type { OwnerSettlement, Owner, SettlementLine, Unit } from "@/lib/types/database";

type SettlementDetail = OwnerSettlement & {
  owner: Owner;
  lines: (SettlementLine & { unit: Pick<Unit, "id" | "code" | "name"> | null })[];
};

export function SettlementActions({ settlement }: { settlement: SettlementDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleStatus(status: "revisada" | "enviada" | "pagada") {
    startTransition(async () => {
      try {
        await changeSettlementStatus(settlement.id, status);
        toast.success(`Marcada como ${status}`);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleRegenerate() {
    startTransition(async () => {
      try {
        await generateSettlement(
          settlement.owner_id,
          settlement.period_year,
          settlement.period_month,
          settlement.currency
        );
        toast.success("Liquidación regenerada");
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handlePdf() {
    startTransition(async () => {
      try {
        const [branding, { generateSettlementPDF }] = await Promise.all([
          getOrganizationBranding(),
          import("@/lib/pdf/settlement-pdf"),
        ]);
        await generateSettlementPDF(settlement, branding);
      } catch (e) {
        toast.error("Error generando PDF", { description: (e as Error).message });
      }
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {settlement.status === "borrador" && (
        <Button variant="outline" onClick={handleRegenerate} disabled={isPending} className="gap-2">
          {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw size={14} />}
          Regenerar
        </Button>
      )}
      <Button variant="outline" onClick={handlePdf} className="gap-2">
        <Download size={14} /> PDF
      </Button>
      {settlement.status === "borrador" && (
        <Button onClick={() => handleStatus("revisada")} disabled={isPending} className="gap-2">
          <CheckCircle2 size={14} /> Marcar como revisada
        </Button>
      )}
      {settlement.status === "revisada" && (
        <Button onClick={() => handleStatus("enviada")} disabled={isPending} className="gap-2">
          <Send size={14} /> Marcar como enviada
        </Button>
      )}
      {(settlement.status === "enviada" || settlement.status === "revisada") && (
        <Button onClick={() => handleStatus("pagada")} disabled={isPending} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
          <CheckCircle2 size={14} /> Marcar como pagada
        </Button>
      )}
    </div>
  );
}
