"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { listQuickReplies, bumpQuickReplyUsage } from "@/lib/actions/crm-quick-replies";
import { renderTemplate } from "@/lib/crm/render-vars";
import type { CrmQuickReply, CrmContactWithLinks } from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Props {
  query: string;
  contact: CrmContactWithLinks;
  onSelect: (text: string, qrId: string) => void;
  onClose: () => void;
}

export function QuickReplyPicker({ query, contact, onSelect, onClose }: Props) {
  const [replies, setReplies] = useState<CrmQuickReply[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    listQuickReplies().then(setReplies);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return replies;
    const q = query.toLowerCase();
    return replies.filter((r) => r.shortcut.includes(q) || r.title.toLowerCase().includes(q));
  }, [replies, query]);

  // Reset al cambiar query — usa key para evitar setState en effect
  // (el componente se remonta cuando query cambia? no, mejor manejar con index clamping)
  const safeIdx = Math.min(activeIdx, Math.max(0, filtered.length - 1));

  const handleSelect = useCallback((qr: CrmQuickReply) => {
    const vars = buildVarsFromContact(contact);
    const rendered = renderTemplate(qr.body, vars);
    onSelect(rendered, qr.id);
    bumpQuickReplyUsage(qr.id).catch(() => undefined);
  }, [contact, onSelect]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered[safeIdx]) {
          e.preventDefault();
          handleSelect(filtered[safeIdx]);
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [safeIdx, filtered, onClose, handleSelect]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-popover border border-border rounded-lg shadow-xl max-h-72 overflow-y-auto z-30">
      <div className="px-3 py-1.5 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
        <Zap className="size-3" /> Rápidos · ↑↓ navegar · Enter elegir · Esc cerrar
      </div>
      <ul>
        {filtered.map((qr, idx) => (
          <li key={qr.id}>
            <button
              type="button"
              onClick={() => handleSelect(qr)}
              onMouseEnter={() => setActiveIdx(idx)}
              className={cn(
                "w-full text-left px-3 py-2 hover:bg-muted/70 transition-colors",
                safeIdx === idx && "bg-muted",
              )}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <code className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono">
                  /{qr.shortcut}
                </code>
                <span className="text-sm font-medium">{qr.title}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1">{qr.body}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildVarsFromContact(contact: CrmContactWithLinks): Record<string, unknown> {
  return {
    contact: {
      name: contact.name,
      phone: contact.phone,
    },
    contact_name: contact.name ?? "",
    guest_name: contact.guest?.full_name ?? contact.name ?? "",
    owner_name: contact.owner?.full_name ?? "",
    unit_code: contact.guest?.active_booking?.unit?.code ?? "",
    unit_name: contact.guest?.active_booking?.unit?.name ?? "",
    checkin_date: contact.guest?.active_booking?.check_in_date ?? "",
    checkout_date: contact.guest?.active_booking?.check_out_date ?? "",
    text: "",
  };
}
