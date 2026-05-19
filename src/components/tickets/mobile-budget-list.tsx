"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { updateTicketCost } from "@/lib/actions/tickets";
import { TICKET_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { TicketStatus } from "@/lib/types/database";

export interface BudgetItem {
  id: string;
  title: string;
  unitCode: string;
  unitName: string;
  status: TicketStatus;
  finishedAt: string | null;
}

/**
 * Lista "para presupuestar": los trabajos que el técnico ya terminó pero
 * todavía no tienen monto. Pensada para cargar el viernes a la noche, uno por
 * uno, sin tener que abrir cada ticket. Al guardar, la card desaparece.
 */
export function MobileBudgetList({ items }: { items: BudgetItem[] }) {
  const [rows, setRows] = useState<BudgetItem[]>(items);

  if (rows.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <CheckCircle2 className="size-10 mx-auto text-emerald-500 mb-3" />
        <p className="text-sm font-medium">¡Todo presupuestado!</p>
        <p className="text-xs text-muted-foreground mt-1">
          No tenés trabajos terminados sin monto.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((it) => (
        <BudgetCard
          key={it.id}
          item={it}
          onDone={() => setRows((cur) => cur.filter((r) => r.id !== it.id))}
        />
      ))}
    </div>
  );
}

function BudgetCard({
  item,
  onDone,
}: {
  item: BudgetItem;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("ARS");
  const [pending, startTransition] = useTransition();
  const sm = TICKET_STATUS_META[item.status];

  const valid = amount !== "" && Number(amount) >= 0 && !Number.isNaN(Number(amount));

  function save() {
    if (!valid) return;
    startTransition(async () => {
      try {
        await updateTicketCost(item.id, Number(amount), currency);
        toast.success("Presupuesto cargado", { description: item.title });
        onDone();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold leading-snug">{item.title}</div>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground min-w-0">
            <Building2 size={11} className="shrink-0" />
            <span className="font-mono shrink-0">{item.unitCode}</span>
            <span className="truncate">· {item.unitName}</span>
          </div>
        </div>
        <Badge
          variant="secondary"
          className="text-[10px] shrink-0"
          style={{ color: sm?.color }}
        >
          {sm?.label ?? item.status}
        </Badge>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Terminado: {formatDate(item.finishedAt)}
      </div>

      <div className="flex gap-2">
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Monto del arreglo"
          className="flex-1 text-base"
          aria-label={`Monto para ${item.title}`}
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

      <div className="flex items-center gap-2">
        <Button
          type="button"
          className="flex-1 gap-2"
          disabled={pending || !valid}
          onClick={save}
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Wallet size={14} />
          )}
          Guardar presupuesto
        </Button>
        <Button asChild variant="ghost" size="sm" className="gap-1 shrink-0">
          <Link href={`/m/mantenimiento/${item.id}`}>
            Abrir
            <ChevronRight size={14} />
          </Link>
        </Button>
      </div>
    </Card>
  );
}
