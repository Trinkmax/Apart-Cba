"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeTicketStatus, updateTicketCost } from "@/lib/actions/tickets";
import { TICKET_STATUS_META } from "@/lib/constants";
import { TicketPhotosSection } from "./ticket-photos-section";
import type {
  TicketAttachment,
  TicketStatus,
} from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Props {
  ticketId: string;
  initialStatus: TicketStatus;
  initialActualCost: number | null;
  initialCostCurrency: string;
  initialAttachments: TicketAttachment[];
}

export function MobileTicketEditor({
  ticketId,
  initialStatus,
  initialActualCost,
  initialCostCurrency,
  initialAttachments,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<TicketStatus>(initialStatus);
  const [actualCost, setActualCost] = useState<string>(
    initialActualCost !== null && initialActualCost !== undefined
      ? String(initialActualCost)
      : ""
  );
  const [currency, setCurrency] = useState<string>(initialCostCurrency);
  const [statusPending, startStatusTransition] = useTransition();
  const [costPending, startCostTransition] = useTransition();

  function handleStatusChange(next: TicketStatus) {
    if (next === status) return;
    const prev = status;
    setStatus(next);
    startStatusTransition(async () => {
      try {
        await changeTicketStatus(ticketId, next);
        toast.success("Estado actualizado");
        router.refresh();
      } catch (e) {
        setStatus(prev);
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleCostSave() {
    startCostTransition(async () => {
      try {
        await updateTicketCost(
          ticketId,
          actualCost === "" ? null : Number(actualCost),
          currency
        );
        toast.success("Costo actualizado");
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <>
      <Card className="p-4 space-y-3">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Estado del trabajo
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TICKET_STATUS_META) as TicketStatus[]).map((s) => {
            const m = TICKET_STATUS_META[s];
            const isCurrent = status === s;
            return (
              <button
                key={s}
                type="button"
                disabled={statusPending}
                onClick={() => handleStatusChange(s)}
                className={cn(
                  "px-3 py-2.5 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-1.5",
                  isCurrent
                    ? "shadow-sm"
                    : "hover:bg-accent active:scale-[0.98]"
                )}
                style={{
                  backgroundColor: isCurrent ? m.color + "20" : undefined,
                  color: m.color,
                  borderColor: m.color + (isCurrent ? "60" : "30"),
                }}
              >
                {statusPending && isCurrent && (
                  <Loader2 size={12} className="animate-spin" />
                )}
                {m.label}
              </button>
            );
          })}
        </div>
      </Card>

      <CostCard
        actualCost={actualCost}
        setActualCost={setActualCost}
        currency={currency}
        setCurrency={setCurrency}
        onSave={handleCostSave}
        pending={costPending}
        dirty={
          (actualCost === "" ? null : Number(actualCost)) !== initialActualCost ||
          currency !== initialCostCurrency
        }
      />

      <Card className="p-4">
        <TicketPhotosSection
          ticketId={ticketId}
          initialAttachments={initialAttachments}
          preferCamera
        />
      </Card>
    </>
  );
}

function CostCard({
  actualCost,
  setActualCost,
  currency,
  setCurrency,
  onSave,
  pending,
  dirty,
}: {
  actualCost: string;
  setActualCost: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  onSave: () => void;
  pending: boolean;
  dirty: boolean;
}) {
  return (
    <Card className="p-4 space-y-3">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
        <DollarSign size={13} />
        Costo del trabajo
      </Label>
      <div className="flex gap-2">
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={actualCost}
          onChange={(e) => setActualCost(e.target.value)}
          placeholder="0.00"
          className="flex-1 text-base"
        />
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">ARS</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="USDT">USDT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        className="w-full gap-2"
        disabled={pending || !dirty}
        onClick={onSave}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Guardar costo
      </Button>
    </Card>
  );
}
