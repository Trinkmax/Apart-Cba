"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertCircle, Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { createOrgDomain, verifyOrgDomain, deleteOrgDomain } from "@/lib/actions/org";
import type { Organization, ResendDnsRecord } from "@/lib/types/database";

interface Props {
  organization: Organization;
}

export function DomainCard({ organization }: Props) {
  const hasDomain = !!organization.email_domain;
  const isVerified = !!organization.email_domain_verified_at;

  if (!hasDomain) return <DomainEmptyState />;
  if (!isVerified) return <DomainPendingState organization={organization} />;
  return <DomainVerifiedState organization={organization} />;
}

// ─────────────────────────────────────────────────────────────────────
// Estado A — sin dominio
// ─────────────────────────────────────────────────────────────────────

function DomainEmptyState() {
  const [domain, setDomain] = useState("");
  const [senderName, setSenderName] = useState("");
  const [localPart, setLocalPart] = useState("reservas");
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const result = await createOrgDomain({
        domain: domain.trim().toLowerCase(),
        sender_name: senderName.trim(),
        sender_local_part: localPart.trim().toLowerCase(),
      });
      if (!result.ok) {
        toast.error("Error al crear dominio", { description: result.error });
        return;
      }
      toast.success("Dominio creado en Resend. Configurá los DNS para verificar.");
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configurá un dominio propio para que los emails a tus huéspedes salgan de tu marca.
        Mientras tanto, salen desde un remitente genérico de rentOS.
      </p>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="d_domain">Dominio</Label>
          <Input
            id="d_domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="monacosuites.com"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d_sender">Nombre del remitente</Label>
          <Input
            id="d_sender"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Monaco Suites"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d_local">Local part (lo que va antes del @)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="d_local"
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value)}
              placeholder="reservas"
              required
              className="max-w-[200px]"
            />
            <span className="text-sm text-muted-foreground">@{domain || "tu-dominio.com"}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={handleCreate} disabled={isPending || !domain || !senderName || !localPart}>
          {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Crear dominio en Resend
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Estado B — pendiente verificación
// ─────────────────────────────────────────────────────────────────────

function DomainPendingState({ organization }: { organization: Organization }) {
  const [isVerifying, startVerify] = useTransition();
  const [isResetting, startReset] = useTransition();
  const [copiedRow, setCopiedRow] = useState<number | null>(null);
  const records = (organization.email_domain_dns_records ?? []) as ResendDnsRecord[];

  function handleVerify() {
    startVerify(async () => {
      const result = await verifyOrgDomain();
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      if (result.verified) toast.success("✓ Dominio verificado");
      else toast.warning("Aún no verificado. Esperá unos minutos tras agregar los DNS.");
    });
  }

  function handleReset() {
    if (!confirm("Esto borra el dominio en Resend y limpia la configuración. ¿Seguir?")) return;
    startReset(async () => {
      const result = await deleteOrgDomain();
      if (!result.ok) toast.error("Error", { description: result.error });
      else toast.success("Configuración reiniciada");
    });
  }

  function handleCopy(value: string, idx: number) {
    navigator.clipboard.writeText(value);
    setCopiedRow(idx);
    setTimeout(() => setCopiedRow(null), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-3">
        <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Pendiente verificación: <span className="font-mono">{organization.email_domain}</span>
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Agregá los DNS records de abajo en tu proveedor (Cloudflare, GoDaddy, etc.) y presioná &quot;Verificar ahora&quot;.
          </p>
        </div>
      </div>
      {records.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Tipo</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono text-xs">{r.type}</TableCell>
                  <TableCell className="font-mono text-xs break-all">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs break-all">{r.value}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => handleCopy(r.value, idx)}>
                      {copiedRow === idx ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={handleReset} disabled={isResetting} className="text-destructive">
          {isResetting && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Reiniciar config
        </Button>
        <Button onClick={handleVerify} disabled={isVerifying}>
          {isVerifying && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Verificar ahora
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Estado C — verificado
// ─────────────────────────────────────────────────────────────────────

function DomainVerifiedState({ organization }: { organization: Organization }) {
  const [isResetting, startReset] = useTransition();

  function handleReset() {
    if (!confirm("Esto borra el dominio en Resend. Los próximos mails al huésped van a salir desde el remitente genérico de rentOS. ¿Seguir?")) return;
    startReset(async () => {
      const result = await deleteOrgDomain();
      if (!result.ok) toast.error("Error", { description: result.error });
      else toast.success("Dominio eliminado");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 p-3">
        <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
            Dominio verificado: <span className="font-mono">{organization.email_domain}</span>
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Remitente: {organization.email_sender_name} &lt;{organization.email_sender_local_part}@{organization.email_domain}&gt;
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={handleReset} disabled={isResetting} className="text-destructive">
          {isResetting && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Cambiar configuración
        </Button>
      </div>
    </div>
  );
}
