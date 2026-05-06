"use client";

import { useEffect, useState, useTransition } from "react";
import { Building2, Calendar, Phone, User, Wrench, Banknote, Tag, Plus, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagChip } from "@/components/crm/shared/tag-chip";
import { getConversationDetail } from "@/lib/actions/crm-conversations";
import { addTagToConversation, removeTagFromConversation } from "@/lib/actions/crm-tags";
import { formatPhoneForDisplay } from "@/lib/crm/phone";
import type { CrmConversationListItem, CrmContactWithLinks, CrmTag } from "@/lib/types/database";

interface Props {
  conversationId: string;
  tags: CrmTag[];
}

export function ContextPanel({ conversationId, tags: allTags }: Props) {
  const [data, setData] = useState<{
    conversation: CrmConversationListItem;
    contact: CrmContactWithLinks;
  } | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getConversationDetail(conversationId).then((d) => {
      if (!cancelled && d) setData({ conversation: d.conversation, contact: d.contact });
    });
    return () => { cancelled = true; };
  }, [conversationId]);

  if (!data) {
    return <aside className="w-[340px] shrink-0 border-l border-border p-4 text-sm text-muted-foreground">Cargando…</aside>;
  }

  const { conversation, contact } = data;
  const labelForInitials = contact.name ?? contact.instagram_username ?? contact.phone ?? contact.external_id ?? "?";
  const initials = labelForInitials
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  const refresh = () => {
    startTransition(() => {
      getConversationDetail(conversationId).then((d) => {
        if (d) setData({ conversation: d.conversation, contact: d.contact });
      });
    });
  };

  const handleAddTag = async (tagId: string) => {
    await addTagToConversation(conversationId, tagId);
    refresh();
  };

  const handleRemoveTag = async (tagId: string) => {
    await removeTagFromConversation(conversationId, tagId);
    refresh();
  };

  const conversationTagIds = new Set(conversation.tags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !conversationTagIds.has(t.id));

  return (
    <aside className="w-[340px] shrink-0 border-l border-border flex flex-col min-h-0">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex flex-col items-center text-center space-y-2">
            <Avatar className="size-16">
              <AvatarFallback className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-bold text-xl">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="font-semibold">{contact.name ?? "Sin nombre"}</h3>
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Phone className="size-3" /> {formatPhoneForDisplay(contact.phone)}
              </p>
            </div>
            <div className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {contact.contact_kind}
            </div>
          </div>

          <Separator />

          {/* Tags */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs uppercase font-semibold text-muted-foreground inline-flex items-center gap-1">
                <Tag className="size-3" /> Etiquetas
              </h4>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                    <Plus className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-60 p-2" align="end">
                  <div className="text-xs font-medium mb-2">Agregar etiqueta</div>
                  <div className="flex flex-wrap gap-1.5">
                    {availableTags.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sin tags disponibles</p>
                    ) : (
                      availableTags.map((t) => (
                        <button key={t.id} onClick={() => handleAddTag(t.id)}>
                          <TagChip tag={t} size="xs" />
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {conversation.tags.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin etiquetas</p>
              ) : (
                conversation.tags.map((t) => (
                  <TagChip key={t.id} tag={t} size="xs" onRemove={() => handleRemoveTag(t.id)} />
                ))
              )}
            </div>
          </section>

          {/* Booking activo */}
          {contact.guest?.active_booking && (
            <>
              <Separator />
              <section className="space-y-1.5">
                <h4 className="text-xs uppercase font-semibold text-muted-foreground inline-flex items-center gap-1">
                  <Calendar className="size-3" /> Booking activo
                </h4>
                <div className="bg-muted/50 rounded-md p-2.5 space-y-1 text-xs">
                  {contact.guest.active_booking.unit && (
                    <div className="flex items-center gap-1.5">
                      <Building2 className="size-3 text-muted-foreground" />
                      <span className="font-medium">
                        {contact.guest.active_booking.unit.code} · {contact.guest.active_booking.unit.name}
                      </span>
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    Check-in: {format(parseISO(contact.guest.active_booking.check_in_date), "PP", { locale: es })}
                  </div>
                  <div className="text-muted-foreground">
                    Check-out: {format(parseISO(contact.guest.active_booking.check_out_date), "PP", { locale: es })}
                  </div>
                  <div className="flex items-center gap-1 pt-0.5">
                    <Banknote className="size-3 text-muted-foreground" />
                    <span>
                      Pagado ${contact.guest.active_booking.paid_amount} / ${contact.guest.active_booking.total_amount}
                    </span>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* Guest stats */}
          {contact.guest && (
            <>
              <Separator />
              <section className="space-y-1.5">
                <h4 className="text-xs uppercase font-semibold text-muted-foreground inline-flex items-center gap-1">
                  <User className="size-3" /> Huésped
                </h4>
                <div className="text-xs space-y-1">
                  <div>{contact.guest.full_name}</div>
                  {contact.guest.email && <div className="text-muted-foreground">{contact.guest.email}</div>}
                  {contact.guest.document_number && <div className="text-muted-foreground">DNI: {contact.guest.document_number}</div>}
                  <div className="text-muted-foreground">Total estadías: {contact.guest.total_bookings}</div>
                </div>
              </section>
            </>
          )}

          {/* Owner */}
          {contact.owner && (
            <>
              <Separator />
              <section className="space-y-1.5">
                <h4 className="text-xs uppercase font-semibold text-muted-foreground inline-flex items-center gap-1">
                  <Wrench className="size-3" /> Propietario
                </h4>
                <div className="text-xs space-y-1">
                  <div className="font-medium">{contact.owner.full_name}</div>
                  {contact.owner.email && <div className="text-muted-foreground">{contact.owner.email}</div>}
                </div>
              </section>
            </>
          )}

          {/* AI Summary */}
          {conversation.ai_summary && (
            <>
              <Separator />
              <section>
                <h4 className="text-xs uppercase font-semibold text-muted-foreground mb-1.5">
                  Resumen IA
                </h4>
                <p className="text-xs text-muted-foreground italic bg-violet-500/5 border border-violet-500/20 rounded-md p-2.5">
                  {conversation.ai_summary}
                </p>
              </section>
            </>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <Button size="sm" variant="ghost" className="w-full h-7 text-xs text-muted-foreground" onClick={() => {/* close panel handled by parent */}}>
          <X className="size-3 mr-1" /> Ocultar panel
        </Button>
      </div>
    </aside>
  );
}
