"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CheckCircle2, MessageCircle, MoreHorizontal, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatContractNumber } from "@/lib/rentals/labels";
import { markProofNotApplicable } from "@/lib/actions/rentals-proofs";
import { cn } from "@/lib/utils";
import { CopyTextButton } from "./copy-text-button";
import { KindChip, kindLabel } from "./proof-kind-icon";
import { monthInSentence } from "./proof-helpers";
import type { MissingProofContract } from "./proof-types";
import { StaffProofUploadDialog } from "./staff-proof-upload-dialog";

/**
 * "Faltan este mes": contratos a los que les falta algún comprobante, con lo
 * necesario para resolverlo sin salir de la pantalla: pedirlo por WhatsApp
 * (con el link del portal), subirlo uno mismo o marcar que no corresponde.
 */
export function MissingProofsList({ items, month }: { items: MissingProofContract[]; month: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const visible = items
    .map((it) => ({ ...it, kinds: it.kinds.filter((k) => !hidden.has(`${it.contractId}|${k.kind}`)) }))
    .filter((it) => it.kinds.length > 0)
    .filter((it) => !needle || `${it.tenantName ?? ""} ${it.address} ${it.propertyCode}`.toLowerCase().includes(needle));

  function notApplicable(it: MissingProofContract, k: MissingProofContract["kinds"][number]) {
    const key = `${it.contractId}|${k.kind}`;
    setHidden((s) => new Set(s).add(key));
    startTransition(async () => {
      const res = await markProofNotApplicable(k.proofId ?? { contractId: it.contractId, kind: k.kind, period: month });
      if (!res.ok) {
        setHidden((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
        toast.error("No se pudo marcar", { description: res.error });
        return;
      }
      toast.success(`${kindLabel(k.kind)}: no corresponde en ${monthInSentence(month)}`);
      router.refresh();
    });
  }

  if (!items.length) {
    return (
      <Card className="items-center gap-3 border-dashed p-8 text-center sm:p-12">
        <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={24} />
        </div>
        <div>
          <p className="text-base font-semibold">No falta ningún comprobante de {monthInSentence(month)}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Todos los inquilinos presentaron lo que les toca (o está en revisión). Los pedidos del mes se arman solos según
            lo que dice cada contrato en «Expensas y servicios».
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.length > 6 && (
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar inquilino o dirección…" className="h-9 pl-8 text-sm" />
        </div>
      )}
      {visible.length === 0 ? (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">Sin resultados para «{q}».</Card>
      ) : (
        <Card className="gap-0 divide-y overflow-hidden p-0">
          {visible.map((it) => (
            <div key={it.contractId} className="flex flex-col gap-3 p-3 sm:p-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{it.tenantName ?? "Sin inquilino cargado"}</p>
                  <Link
                    href={`/dashboard/alquileres/contratos/${it.contractId}`}
                    className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <span className="truncate">{it.address}</span>
                    <span className="shrink-0 font-mono text-[10px]">{formatContractNumber(it.contractNumber)}</span>
                  </Link>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {it.kinds.map((k) => (
                    <span
                      key={k.kind}
                      title={k.rejectionReason ? `Rechazado: ${k.rejectionReason}` : undefined}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs",
                        k.status === "rechazado"
                          ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300"
                          : "bg-card text-foreground",
                      )}
                    >
                      <KindChip kind={k.kind} size="sm" className="size-6 rounded-full" />
                      <span className="truncate">
                        {kindLabel(k.kind)}
                        {k.status === "rechazado" && <span className="font-medium"> · rechazado</span>}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
                {it.tenantWhatsapp ? (
                  <Button asChild size="sm" variant="outline" className="gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                    <a href={`https://wa.me/${it.tenantWhatsapp}?text=${encodeURIComponent(it.whatsappText)}`} target="_blank" rel="noopener noreferrer">
                      <MessageCircle size={14} /> Pedir por WhatsApp
                    </a>
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Sin teléfono cargado</span>
                )}
                <CopyTextButton text={it.whatsappText} iconOnly label="Copiar el mensaje" toastTitle="Mensaje copiado" />
                <StaffProofUploadDialog
                  contractId={it.contractId}
                  currency={it.currency}
                  period={month}
                  kinds={it.kinds.map((k) => k.kind)}
                  tenantName={it.tenantName}
                >
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Upload size={14} /> Subir yo
                  </Button>
                </StaffProofUploadDialog>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label="Más opciones" disabled={pending}>
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">No corresponde este mes</DropdownMenuLabel>
                    {it.kinds.map((k) => (
                      <DropdownMenuItem key={k.kind} onSelect={() => notApplicable(it, k)} className="gap-2">
                        <Ban size={14} /> {kindLabel(k.kind)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
