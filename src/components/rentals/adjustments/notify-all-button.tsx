"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notifyAllApplied } from "@/lib/actions/rentals-adjustments";

type Missing = { id: string; contractId: string; contractNumber: string; tenantName: string | null };

/** "Avisar a todos": manda por mail cada ajuste aplicado que todavía no se avisó. */
export function NotifyAllButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState<Missing[] | null>(null);

  function run() {
    startTransition(async () => {
      const res = await notifyAllApplied();
      if (!res.ok) {
        toast.error("No se pudieron mandar los avisos", { description: res.error });
        return;
      }
      const parts = [
        res.sent ? `${res.sent} ${res.sent === 1 ? "aviso enviado" : "avisos enviados"}` : null,
        res.withoutEmail.length ? `${res.withoutEmail.length} sin mail` : null,
        res.failed ? `${res.failed} con error` : null,
      ].filter(Boolean);
      if (res.sent) toast.success(parts.join(" · "));
      else toast.message(parts.join(" · ") || "No había avisos pendientes");
      router.refresh();
      if (res.withoutEmail.length) setMissing(res.withoutEmail);
      else setOpen(false);
    });
  }

  if (count <= 0) return null;
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Send size={14} /> Avisar a todos ({count})
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setMissing(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="size-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <MailCheck size={16} />
              </span>
              {missing ? "Faltan algunos" : "Avisar los ajustes aplicados"}
            </DialogTitle>
            <DialogDescription>
              {missing
                ? "Estos inquilinos no tienen mail cargado: avisales por WhatsApp desde su tarjeta."
                : `Le mandamos un mail a cada inquilino con su alquiler nuevo, desde cuándo rige y el índice usado (${count} ${count === 1 ? "ajuste" : "ajustes"}).`}
            </DialogDescription>
          </DialogHeader>
          {missing ? (
            <ul className="divide-y rounded-lg border">
              {missing.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/dashboard/alquileres/ajustes?tab=aplicados#ajuste-${m.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-accent/40"
                  >
                    <span className="min-w-0 truncate">{m.tenantName ?? "Inquilino"}</span>
                    <span className="font-mono text-xs text-muted-foreground">{m.contractNumber}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={run} disabled={pending}>
                {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Mandar avisos
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
