"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { setMemberOwnerLink } from "@/lib/actions/team";

const UNLINKED = "__none";

/**
 * Selector del propietario que representa un usuario con rol "Propietario".
 * Es lo que acota lo que ve (sus unidades, reservas y liquidaciones): sin
 * vincular no ve nada, y así se lo decimos a quien administra el equipo.
 */
export function OwnerLinkSelect({
  userId,
  ownerId,
  owners,
  disabled = false,
}: {
  userId: string;
  ownerId: string | null;
  owners: { id: string; full_name: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const next = value === UNLINKED ? null : value;
    if (next === ownerId) return;
    startTransition(async () => {
      const r = await setMemberOwnerLink(userId, next);
      if (!r.ok) {
        toast.error("No se pudo vincular", { description: r.error });
        return;
      }
      toast.success(next ? "Propietario vinculado" : "Quedó sin vincular: no ve ninguna unidad");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-[11px] text-muted-foreground shrink-0">Ve lo de</span>
      <Select value={ownerId ?? UNLINKED} onValueChange={onChange} disabled={disabled || isPending}>
        <SelectTrigger
          size="sm"
          className={
            ownerId
              ? "h-7 text-xs max-w-[240px]"
              : "h-7 text-xs max-w-[240px] border-amber-500/40 text-amber-700 dark:text-amber-400"
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNLINKED}>Sin vincular — no ve nada</SelectItem>
          {owners.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
