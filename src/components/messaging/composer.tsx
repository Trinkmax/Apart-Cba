"use client";

import {
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { MessagingTemplate } from "@/lib/types/database";

interface Props {
  templates: MessagingTemplate[];
  disabled?: boolean;
  disabledReason?: string;
  onSend: (input: { text: string }) => Promise<void>;
}

export function Composer({ templates, disabled, disabledReason, onSend }: Props) {
  const [value, setValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  // autoresize
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  // detectar shortcuts /
  const slashQuery = useMemo(() => {
    if (!value.startsWith("/")) return null;
    const firstSpace = value.indexOf(" ");
    if (firstSpace !== -1 && firstSpace < value.length - 1) return null;
    const after = firstSpace === -1 ? value : value.slice(0, firstSpace);
    return after.toLowerCase();
  }, [value]);

  const filteredTemplates = useMemo(() => {
    if (slashQuery === null) return [];
    return templates
      .filter((t) => t.active)
      .filter((t) => t.shortcut.toLowerCase().startsWith(slashQuery))
      .slice(0, 6);
  }, [templates, slashQuery]);

  useEffect(() => {
    setShowSuggestions(filteredTemplates.length > 0 && slashQuery !== null);
    setActiveSuggestion(0);
  }, [filteredTemplates.length, slashQuery]);

  const insertTemplate = (t: MessagingTemplate) => {
    setValue(t.body);
    setShowSuggestions(false);
    setTimeout(() => ref.current?.focus(), 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestion((p) => Math.min(p + 1, filteredTemplates.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestion((p) => Math.max(p - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        if (filteredTemplates[activeSuggestion]) {
          e.preventDefault();
          insertTemplate(filteredTemplates[activeSuggestion]);
          return;
        }
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const text = value.trim();
    if (!text || pending) return;
    startTransition(async () => {
      await onSend({ text });
      setValue("");
    });
  };

  if (disabled && disabledReason) {
    return (
      <div className="flex-shrink-0 border-t border-border p-4 bg-muted/40 text-center text-xs text-muted-foreground">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 border-t border-border bg-card/40 p-3 relative">
      {showSuggestions && (
        <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-medium text-muted-foreground border-b border-border bg-muted/40 flex items-center gap-1.5">
            <Sparkles size={11} /> Mensajes rápidos · {filteredTemplates.length}
          </div>
          <ul role="listbox" className="max-h-56 overflow-y-auto">
            {filteredTemplates.map((t, i) => (
              <li
                key={t.id}
                role="option"
                aria-selected={i === activeSuggestion}
                onMouseEnter={() => setActiveSuggestion(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertTemplate(t);
                }}
                className={cn(
                  "px-3 py-2 cursor-pointer transition-colors",
                  i === activeSuggestion ? "bg-muted" : ""
                )}
              >
                <div className="flex items-center gap-2">
                  <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {t.shortcut}
                  </code>
                  <span className="text-xs font-medium">{t.title}</span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{t.body}</p>
              </li>
            ))}
          </ul>
          <div className="px-3 py-1 text-[10px] text-muted-foreground border-t border-border bg-muted/30">
            <kbd className="px-1 rounded bg-card border text-[9px]">Tab</kbd> insertar ·{" "}
            <kbd className="px-1 rounded bg-card border text-[9px]">↑↓</kbd> navegar
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Escribí un mensaje… (probá "/" para insertar un mensaje rápido)'
            rows={1}
            className={cn(
              "w-full resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm leading-snug shadow-xs",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
              "placeholder:text-muted-foreground"
            )}
          />
        </div>
        <Button
          type="button"
          onClick={handleSend}
          disabled={!value.trim() || pending}
          className="size-10 rounded-xl shrink-0"
          size="icon"
          title="Enviar (Enter)"
        >
          <Send size={16} className={cn(pending && "animate-pulse")} />
        </Button>
      </div>
      <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-muted-foreground">
        <span>
          <kbd className="px-1 rounded bg-muted border text-[9px]">Enter</kbd> enviar ·{" "}
          <kbd className="px-1 rounded bg-muted border text-[9px]">Shift+Enter</kbd> salto
        </span>
        <span className={cn("tabular-nums", value.length > 3800 && "text-amber-500")}>
          {value.length}/4096
        </span>
      </div>
    </div>
  );
}
