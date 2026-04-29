"use client";

import { useState, useTransition } from "react";
import {
  User,
  Phone,
  Mail,
  Globe,
  CalendarDays,
  Tag as TagIcon,
  Plus,
  X,
  Building2,
  Link as LinkIcon,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { setConversationTags, linkConversationToBooking } from "@/lib/actions/messaging";
import { formatDate, formatPhone } from "@/lib/format";
import { toast } from "sonner";
import type {
  MessagingConversation,
  MessagingMessage,
  MessagingTag,
} from "@/lib/types/database";
import type { ConversationListItem } from "./messaging-shell";

interface ConversationDetail {
  conversation: ConversationListItem & {
    contact: ConversationListItem["contact"] & {
      guest: {
        id: string;
        full_name: string;
        phone: string | null;
        email: string | null;
        country: string | null;
        total_bookings: number;
      } | null;
    };
    related_booking: {
      id: string;
      check_in_date: string;
      check_out_date: string;
      status: string;
      unit: { id: string; code: string; name: string } | null;
    } | null;
  };
  messages: MessagingMessage[];
}

interface Props {
  detail: ConversationDetail;
  tags: MessagingTag[];
  onConversationUpdate: (updates: Partial<MessagingConversation>) => void;
}

export function ConversationInfoPanel({ detail, tags, onConversationUpdate }: Props) {
  const c = detail.conversation;
  const guest = c.contact.guest;
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  return (
    <aside className="w-[320px] flex-shrink-0 border-l border-border bg-card/30 overflow-y-auto hidden xl:block">
      <div className="p-4 space-y-4">
        {/* Datos del contacto / huésped */}
        <Section title="Contacto" icon={User}>
          {guest ? (
            <div className="space-y-2.5">
              <Field label="Nombre" value={guest.full_name} />
              {guest.phone && (
                <Field
                  label="Teléfono"
                  value={
                    <a
                      href={`tel:${guest.phone}`}
                      className="hover:underline inline-flex items-center gap-1.5"
                    >
                      <Phone size={11} />
                      {formatPhone(guest.phone)}
                    </a>
                  }
                />
              )}
              {guest.email && (
                <Field
                  label="Email"
                  value={
                    <a
                      href={`mailto:${guest.email}`}
                      className="hover:underline inline-flex items-center gap-1.5 break-all"
                    >
                      <Mail size={11} />
                      {guest.email}
                    </a>
                  }
                />
              )}
              {guest.country && (
                <Field
                  label="País"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <Globe size={11} />
                      {guest.country}
                    </span>
                  }
                />
              )}
              <Field
                label="Reservas previas"
                value={`${guest.total_bookings}`}
              />
              <Link
                href={`/dashboard/huespedes`}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                Ver perfil del huésped <LinkIcon size={11} />
              </Link>
            </div>
          ) : (
            <div className="space-y-2.5">
              <Field
                label="Identificador"
                value={
                  <code className="text-xs font-mono">
                    {c.contact.channel_type === "whatsapp" ? "+" : "@"}
                    {c.contact.external_id}
                  </code>
                }
              />
              <p className="text-[11px] text-muted-foreground italic">
                Sin huésped vinculado. Vinculá una reserva para asociar.
              </p>
            </div>
          )}
        </Section>

        {/* Reserva relacionada */}
        <Section title="Reserva" icon={CalendarDays}>
          {detail.conversation.related_booking ? (
            <div className="space-y-2">
              <BookingPill booking={detail.conversation.related_booking} />
              <BookingLinkActions
                conversationId={c.id}
                onUpdate={onConversationUpdate}
                isLinked
              />
            </div>
          ) : (
            <BookingLinkActions
              conversationId={c.id}
              onUpdate={onConversationUpdate}
              isLinked={false}
            />
          )}
        </Section>

        {/* Etiquetas */}
        <Section title="Etiquetas" icon={TagIcon}>
          <TagSelector
            conversationId={c.id}
            allTags={tags}
            selectedTagIds={c.tag_ids}
            onChange={(newTags) => onConversationUpdate({ tag_ids: newTags })}
          />
          {c.tag_ids.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {c.tag_ids.map((id) => {
                const t = tagMap.get(id);
                if (!t) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium"
                    style={{ backgroundColor: `${t.color}1A`, color: t.color }}
                  >
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.label}
                  </span>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground flex items-center gap-1.5">
        <Icon size={11} />
        {title}
      </h3>
      <div className="rounded-xl border border-border bg-card p-3">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground block leading-tight">{label}</span>
      <span className="text-foreground block leading-tight mt-0.5">{value}</span>
    </div>
  );
}

function BookingPill({
  booking,
}: {
  booking: {
    id: string;
    check_in_date: string;
    check_out_date: string;
    status: string;
    unit: { id: string; code: string; name: string } | null;
  };
}) {
  return (
    <Link
      href={`/dashboard/reservas/${booking.id}`}
      className="block rounded-lg border border-border p-2.5 hover:border-primary/40 transition-colors"
    >
      <div className="flex items-center gap-2 text-xs">
        <Building2 size={12} className="text-muted-foreground" />
        <span className="font-medium">
          {booking.unit ? `${booking.unit.code} · ${booking.unit.name}` : "Unidad ?"}
        </span>
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px]">
        <span className="text-muted-foreground tabular-nums">
          {formatDate(booking.check_in_date)} → {formatDate(booking.check_out_date)}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          {booking.status}
        </span>
      </div>
    </Link>
  );
}

function BookingLinkActions({
  conversationId,
  onUpdate,
  isLinked,
}: {
  conversationId: string;
  onUpdate: (u: Partial<MessagingConversation>) => void;
  isLinked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  if (isLinked) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="w-full text-xs"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await linkConversationToBooking(conversationId, null);
            onUpdate({ related_booking_id: null, related_unit_id: null });
            toast.success("Reserva desvinculada");
          });
        }}
      >
        Desvincular reserva
      </Button>
    );
  }
  return (
    <p className="text-[11px] text-muted-foreground italic">
      Sin reserva vinculada. Para asociar una, abrí la reserva en{" "}
      <Link href="/dashboard/reservas" className="text-primary hover:underline">
        /reservas
      </Link>{" "}
      y volvé acá.
    </p>
  );
}

function TagSelector({
  conversationId,
  allTags,
  selectedTagIds,
  onChange,
}: {
  conversationId: string;
  allTags: MessagingTag[];
  selectedTagIds: string[];
  onChange: (newTagIds: string[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedTagIds);
  const apply = (next: string[]) => {
    startTransition(async () => {
      try {
        await setConversationTags(conversationId, next);
        onChange(next);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="w-full text-xs gap-1.5" disabled={pending}>
          <Plus size={12} /> Gestionar etiquetas
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <div className="p-2 border-b border-border">
          <p className="text-[11px] text-muted-foreground">Tocá para agregar/quitar</p>
        </div>
        <ul className="p-1 max-h-64 overflow-y-auto">
          {allTags.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">
              Sin etiquetas creadas. Crealas desde Configuración.
            </li>
          )}
          {allTags.map((t) => {
            const isOn = selected.has(t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs transition-colors",
                    isOn ? "bg-muted" : "hover:bg-muted/60"
                  )}
                  onClick={() => {
                    const next = isOn
                      ? selectedTagIds.filter((id) => id !== t.id)
                      : [...selectedTagIds, t.id];
                    apply(next);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.label}
                  </span>
                  {isOn && <X size={12} className="text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
