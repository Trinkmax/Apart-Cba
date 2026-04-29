"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Search, Phone, Mail, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WhatsAppIcon, InstagramIcon } from "./channel-icons";
import { toast } from "sonner";
import type { MessagingChannel, MessagingChannelType } from "@/lib/types/database";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channels: MessagingChannel[];
  onSearchGuests: (query: string) => Promise<
    { id: string; full_name: string; phone: string | null; email: string | null }[]
  >;
  onCreate: (input: {
    channel_type: MessagingChannelType;
    external_id: string;
    display_name?: string;
    guest_id?: string;
  }) => Promise<void>;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  channels,
  onSearchGuests,
  onCreate,
}: Props) {
  const [channelType, setChannelType] = useState<MessagingChannelType>("whatsapp");
  const [mode, setMode] = useState<"guest" | "manual">("guest");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; full_name: string; phone: string | null; email: string | null }[]
  >([]);
  const [searching, startSearching] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [externalId, setExternalId] = useState("");
  const [displayName, setDisplayName] = useState("");

  const selectedGuest = useMemo(
    () => results.find((r) => r.id === selectedGuestId),
    [results, selectedGuestId]
  );

  const wa = channels.find((c) => c.channel_type === "whatsapp" && c.active);
  const ig = channels.find((c) => c.channel_type === "instagram" && c.active);
  const noChannels = !wa && !ig;

  // Auto-pick the available channel
  useEffect(() => {
    if (open) {
      if (wa && !ig) setChannelType("whatsapp");
      else if (ig && !wa) setChannelType("instagram");
    }
  }, [open, wa, ig]);

  // Reset state when closing
  useEffect(() => {
    if (!open) {
      setMode("guest");
      setQuery("");
      setResults([]);
      setSelectedGuestId(null);
      setExternalId("");
      setDisplayName("");
    }
  }, [open]);

  // Search guests on debounce
  useEffect(() => {
    if (mode !== "guest") return;
    const timer = setTimeout(() => {
      startSearching(async () => {
        try {
          const r = await onSearchGuests(query);
          setResults(r);
        } catch {
          setResults([]);
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, mode, onSearchGuests]);

  const canSubmit =
    !noChannels &&
    ((mode === "guest" && selectedGuest && (channelType === "whatsapp" ? selectedGuest.phone : true)) ||
      (mode === "manual" && externalId.trim().length > 0));

  const handleCreate = () => {
    if (!canSubmit) return;
    let id = "";
    let name = "";
    if (mode === "guest" && selectedGuest) {
      if (channelType === "whatsapp") {
        id = (selectedGuest.phone ?? "").replace(/\D/g, "");
        if (!id) {
          toast.error("Este huésped no tiene teléfono cargado");
          return;
        }
      } else {
        id = externalId.trim();
        if (!id) {
          toast.error("Ingresá el IGSID o handle de Instagram");
          return;
        }
      }
      name = selectedGuest.full_name;
    } else {
      id =
        channelType === "whatsapp"
          ? externalId.trim().replace(/\D/g, "")
          : externalId.trim();
      name = displayName.trim() || externalId.trim();
    }

    if (!id) return;
    startSubmit(async () => {
      try {
        await onCreate({
          channel_type: channelType,
          external_id: id,
          display_name: name,
          guest_id: mode === "guest" && selectedGuest ? selectedGuest.id : undefined,
        });
        toast.success("Conversación creada");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al crear");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Nueva conversación</DialogTitle>
          <DialogDescription>
            Iniciá un hilo con un huésped existente o ingresá un contacto manualmente.
          </DialogDescription>
        </DialogHeader>

        {noChannels ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
            Tenés que conectar al menos un canal antes de crear conversaciones. Andá a
            Configuración para conectar WhatsApp o Instagram.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Channel picker */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Canal</label>
              <div className="grid grid-cols-2 gap-2">
                <ChannelOption
                  active={channelType === "whatsapp"}
                  disabled={!wa}
                  type="whatsapp"
                  onClick={() => setChannelType("whatsapp")}
                />
                <ChannelOption
                  active={channelType === "instagram"}
                  disabled={!ig}
                  type="instagram"
                  onClick={() => setChannelType("instagram")}
                />
              </div>
            </div>

            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted/50 rounded-lg">
              <button
                type="button"
                onClick={() => setMode("guest")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === "guest" ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground"
                )}
              >
                Huésped existente
              </button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === "manual" ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground"
                )}
              >
                Manual
              </button>
            </div>

            {mode === "guest" && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Buscar huésped por nombre, teléfono, email"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-8 h-9 text-sm"
                  />
                </div>
                <ul className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {searching && (
                    <li className="p-3 text-center">
                      <Loader2 size={14} className="animate-spin inline" />
                    </li>
                  )}
                  {!searching && results.length === 0 && (
                    <li className="p-4 text-xs text-muted-foreground text-center">
                      Sin resultados
                    </li>
                  )}
                  {!searching &&
                    results.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedGuestId(g.id)}
                          className={cn(
                            "w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-3",
                            selectedGuestId === g.id ? "bg-primary/5" : "hover:bg-muted/60"
                          )}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{g.full_name}</div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                              {g.phone && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Phone size={10} />
                                  {g.phone}
                                </span>
                              )}
                              {g.email && (
                                <span className="inline-flex items-center gap-0.5 truncate">
                                  <Mail size={10} />
                                  {g.email}
                                </span>
                              )}
                            </div>
                          </div>
                          {selectedGuestId === g.id && (
                            <span className="size-2 rounded-full bg-primary shrink-0" />
                          )}
                        </button>
                      </li>
                    ))}
                </ul>
                {channelType === "instagram" && selectedGuest && (
                  <div>
                    <label className="text-xs font-medium">IGSID o handle</label>
                    <Input
                      value={externalId}
                      onChange={(e) => setExternalId(e.target.value)}
                      placeholder="ej. 17841401234567890 o @usuario"
                      className="h-9 mt-1.5"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Obtené el IGSID con un mensaje entrante o usá el handle si Meta lo permite.
                    </p>
                  </div>
                )}
              </div>
            )}

            {mode === "manual" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium">
                    {channelType === "whatsapp" ? "Número (con cód. país, sin +)" : "IGSID"}
                  </label>
                  <Input
                    autoFocus
                    value={externalId}
                    onChange={(e) => setExternalId(e.target.value)}
                    placeholder={channelType === "whatsapp" ? "5491123456789" : "17841401234567890"}
                    className="h-9 mt-1.5"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Nombre (opcional)</label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="ej. Juan Pérez"
                    className="h-9 mt-1.5"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit || submitting}>
            {submitting ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
            Crear conversación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChannelOption({
  active,
  disabled,
  type,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  type: MessagingChannelType;
  onClick: () => void;
}) {
  const Icon = type === "whatsapp" ? WhatsAppIcon : InstagramIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
        active
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border hover:bg-muted/40",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      <Icon className="size-5" />
      <div>
        <div className="text-sm font-medium leading-tight">
          {type === "whatsapp" ? "WhatsApp" : "Instagram"}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {disabled ? "No conectado" : "Listo para usar"}
        </div>
      </div>
    </button>
  );
}
