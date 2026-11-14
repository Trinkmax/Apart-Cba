"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  SquarePen,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/ui/use-mounted";
import type { UserRole } from "@/lib/types/database";
import { closeTex, consumeTexPrompt, useTexState, useShellPathname } from "@/components/mobile/shell-store";
import { routeMeta } from "@/components/mobile/routes";
import { isInternalHref } from "@/lib/tex/format";
import { TexAvatar } from "./tex-avatar";
import { TexCardView } from "./tex-cards";
import { TexMarkdown } from "./tex-markdown";
import { TexProposal } from "./tex-proposal";
import { useTexChat, type ChatMessage, type LivePart } from "./use-tex-chat";

/*
 * La hoja de Tex (nov-2026).
 * - Celular: pantalla completa que nace del círculo de la barra (genie desde el
 *   punto de toque), con la cabecera de vidrio y el campo pegado al teclado
 *   (visualViewport: en iOS el teclado no achica el layout).
 * - Compu: tarjeta flotante no modal arriba a la derecha (el botón vive en la
 *   TopBar); se puede seguir usando el panel mientras está abierta.
 * Lo que hace Tex en cada momento se ve en su cara: piensa (con lentes) cuando
 * corre una herramienta, mueve la boca cuando escribe y festeja cuando una
 * acción confirmada sale bien.
 */

type Phase = "closed" | "opening" | "open" | "closing";

function isPhone() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function suggestionsFor(pathname: string, role: UserRole, rentalsEnabled: boolean): string[] {
  if (role === "limpieza") return ["¿Qué tengo que limpiar hoy?", "¿Quién entra hoy?", "Marcá limpia una unidad"];
  if (role === "mantenimiento") return ["¿Qué tickets tengo abiertos?", "Creá un ticket", "¿Quién entra hoy?"];
  const meta = routeMeta(pathname, { role, rentalsEnabled });
  if (meta.tab === "reservas") {
    return ["¿Qué hay libre este finde?", "¿Quién entra esta semana?", "Solicitudes sin responder", "Cargá una reserva"];
  }
  if (meta.tab === "caja") {
    return ["¿Cómo viene la caja del mes?", "Saldos de las cuentas", "Registrá un gasto", "¿Cuánto gastamos esta semana?"];
  }
  return ["Armame el plan de hoy", "¿Quién entra hoy?", "¿Qué hay que limpiar?", "¿Cómo viene el mes?"];
}

export function TexSheet({
  firstName,
  role,
  rentalsEnabled,
}: {
  firstName: string;
  role: UserRole;
  rentalsEnabled: boolean;
}) {
  const tex = useTexState();
  const chat = useTexChat();
  const pathname = useShellPathname();
  const mounted = useMounted();
  // La fase de la animación se ajusta EN el render cuando cambia `open` (el
  // patrón de React para derivar estado de una prop); los timers la avanzan.
  const [phase, setPhase] = React.useState<Phase>(tex.open ? "opening" : "closed");
  const [prevOpen, setPrevOpen] = React.useState(tex.open);
  if (prevOpen !== tex.open) {
    setPrevOpen(tex.open);
    setPhase(tex.open ? "opening" : phase === "closed" ? "closed" : "closing");
  }
  const [input, setInput] = React.useState("");
  const celebrating = chat.celebrating;
  const panelRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const { load, send } = chat;

  // Abrir / cerrar con su animación.
  React.useEffect(() => {
    if (tex.open) void load();
  }, [tex.open, load]);
  React.useEffect(() => {
    if (phase === "opening") {
      const t = window.setTimeout(() => setPhase("open"), 420);
      return () => window.clearTimeout(t);
    }
    if (phase === "closing") {
      const t = window.setTimeout(() => setPhase("closed"), 240);
      return () => window.clearTimeout(t);
    }
  }, [phase]);

  // La pregunta con la que se abrió (la burbuja del círculo, la tarjeta de Hoy).
  React.useEffect(() => {
    if (!tex.open || !tex.prompt || !chat.loaded || chat.streaming) return;
    const prompt = tex.prompt;
    consumeTexPrompt();
    void send(prompt, pathname);
  }, [tex.open, tex.prompt, chat.loaded, chat.streaming, send, pathname]);

  // Escape cierra; en el celular, el fondo no scrollea.
  React.useEffect(() => {
    if (phase === "closed") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeTex();
    window.addEventListener("keydown", onKey);
    const phone = isPhone();
    const html = document.documentElement;
    const prev = html.style.overflow;
    if (phone) html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      if (phone) html.style.overflow = prev;
    };
  }, [phase]);

  // iOS: el teclado no achica el layout. La hoja sigue al viewport visible.
  React.useEffect(() => {
    if (phase === "closed" || !isPhone()) return;
    const vv = window.visualViewport;
    const panel = panelRef.current;
    if (!vv || !panel) return;
    const sync = () => {
      panel.style.height = `${vv.height}px`;
      panel.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      panel.style.height = "";
      panel.style.transform = "";
    };
  }, [phase]);

  // Abajo de todo cuando llega algo nuevo (si la persona no se fue para arriba).
  const lastLen = chat.messages.length;
  const lastParts = (() => {
    const m = chat.messages[chat.messages.length - 1];
    return m && m.role === "assistant" ? m.parts.length + (m.parts.at(-1)?.type === "text" ? (m.parts.at(-1) as { text: string }).text.length : 0) : 0;
  })();
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [lastLen, lastParts]);
  React.useEffect(() => {
    if (phase === "open" || phase === "opening") {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [phase, chat.loaded]);

  const onNavigate = React.useCallback(() => {
    if (isPhone()) closeTex();
  }, []);

  const submit = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || chat.streaming) return;
    setInput("");
    void send(value, pathname);
    if (!isPhone()) inputRef.current?.focus();
  };

  if (!mounted || phase === "closed") return null;

  const origin = tex.origin;
  const mood = celebrating ? "happy" : chat.mood;
  const status = chat.activity ?? (celebrating ? "¡Listo!" : "Tu asistente · respondo al instante");
  const empty = chat.loaded && chat.messages.length === 0;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={isPhone() ? true : undefined}
      aria-label="Tex, tu asistente"
      data-phase={phase === "opening" ? "opening" : phase === "closing" ? "closing" : undefined}
      className={cn(
        "tex-sheet fixed z-[60] flex flex-col overflow-hidden bg-background",
        // Celular: pantalla completa.
        "max-md:inset-x-0 max-md:top-0 max-md:h-[100dvh]",
        // Compu: tarjeta flotante arriba a la derecha.
        "md:top-[4.75rem] md:right-4 md:h-[min(46rem,calc(100dvh-6rem))] md:w-[27rem] md:rounded-[28px] md:border md:border-black/[0.08] md:shadow-[0_30px_80px_-24px_rgba(22,46,36,0.45)] md:dark:border-white/10",
      )}
      style={
        {
          "--tex-ox": origin ? `${origin.x}px` : "85%",
          "--tex-oy": origin ? `${origin.y}px` : "100%",
        } as React.CSSProperties
      }
    >
      {/* Brillo celeste de Tex arriba (el azul de la mascota sobre el salvia de Apart). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(120%_80%_at_20%_0%,rgba(58,160,240,0.16),transparent_60%),radial-gradient(90%_70%_at_100%_0%,rgba(126,217,87,0.10),transparent_60%)]"
      />

      <header className="lg-sheet relative z-10 flex items-center gap-3 border-b border-black/[0.05] px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2.5 md:border-t-0 md:pt-3 dark:border-white/[0.06]">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#dcefff] dark:bg-[#123250]">
          <TexAvatar mood={mood === "happy" ? "happy" : mood === "thinking" ? "thinking" : mood === "talking" ? "talking" : "idle"} className="size-11" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] leading-tight font-semibold tracking-tight">Tex</p>
          <p className="flex items-center gap-1.5 truncate text-[12.5px] text-muted-foreground" aria-live="polite">
            {chat.streaming ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />}
            {status}
          </p>
        </div>
        <button
          type="button"
          onClick={chat.reset}
          aria-label="Nueva conversación"
          title="Nueva conversación"
          className="lg-icon-btn size-10 text-muted-foreground hover:text-foreground"
        >
          <SquarePen className="size-[19px]" />
        </button>
        <button type="button" onClick={closeTex} aria-label="Cerrar" className="lg-icon-btn size-10 bg-black/[0.05] dark:bg-white/10">
          <ChevronDown className="size-5 md:hidden" />
          <X className="hidden size-5 md:block" />
        </button>
      </header>

      <div ref={scrollRef} className="relative z-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pt-4 pb-3">
        {!chat.loaded ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : empty ? (
          <Welcome firstName={firstName} suggestions={suggestionsFor(pathname, role, rentalsEnabled)} onPick={submit} />
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {chat.messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                last={i === chat.messages.length - 1}
                actions={chat.actions}
                streaming={chat.streaming}
                onConfirm={chat.confirm}
                onCancel={chat.cancel}
                onNavigate={onNavigate}
                onRetry={() => {
                  const prev = chat.messages[i - 1];
                  if (prev && prev.role === "user") submit(prev.text);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <Composer
        inputRef={inputRef}
        value={input}
        onChange={setInput}
        onSubmit={() => submit()}
        streaming={chat.streaming}
        onStop={chat.stop}
      />
    </div>,
    document.body,
  );
}

function Welcome({ firstName, suggestions, onPick }: { firstName: string; suggestions: string[]; onPick: (s: string) => void }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-5 pb-4 text-center">
      <div className="pixel-bubble tex-pop-in max-w-[19rem] text-left text-[14.5px]" data-tail="bottom-left">
        ¡Hola, {firstName}! Soy <strong>Tex</strong>. Preguntame lo que quieras del negocio o pedime que cargue algo por vos:
        yo lo preparo y vos confirmás.
      </div>
      <TexAvatar mood="wave" className="size-28 self-start" float pop />
      <div className="grid w-full grid-cols-2 gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-2xl border border-black/[0.07] bg-card px-3 py-2.5 text-left text-[13.5px] leading-snug font-medium shadow-sm active:scale-[0.98] dark:border-white/[0.08]"
          >
            {s}
          </button>
        ))}
      </div>
      <ul className="w-full space-y-1.5 text-left text-[12.5px] text-muted-foreground">
        <li className="flex gap-2">
          <span aria-hidden>🔎</span> Consulto llegadas, disponibilidad, caja, limpiezas y tickets.
        </li>
        <li className="flex gap-2">
          <span aria-hidden>📊</span> Analizo el mes, la ocupación y los resultados.
        </li>
        <li className="flex gap-2">
          <span aria-hidden>✅</span> Preparo cobros, gastos, reservas y tickets: nada se hace sin tu confirmación.
        </li>
      </ul>
    </div>
  );
}

function Message({
  message,
  last,
  actions,
  streaming,
  onConfirm,
  onCancel,
  onNavigate,
  onRetry,
}: {
  message: ChatMessage;
  last: boolean;
  actions: Record<string, import("@/lib/tex/types").ProposalView>;
  streaming: boolean;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onNavigate: () => void;
  onRetry: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="tex-msg-in tex-msg-in-right flex justify-end">
        <p className="max-w-[84%] rounded-[20px] rounded-br-[6px] bg-[oklch(0.48_0.08_152)] px-3.5 py-2 text-[15.5px] leading-snug whitespace-pre-wrap text-white shadow-sm dark:bg-[oklch(0.52_0.08_152)]">
          {message.text}
        </p>
      </div>
    );
  }

  const parts = message.parts;
  const groups: Array<{ kind: "tools"; items: Extract<LivePart, { type: "tool" }>[] } | { kind: "part"; part: LivePart }> = [];
  for (const p of parts) {
    if (p.type === "tool") {
      const g = groups[groups.length - 1];
      if (g && g.kind === "tools") g.items.push(p);
      else groups.push({ kind: "tools", items: [p] });
    } else groups.push({ kind: "part", part: p });
  }
  const lastText = [...parts].reverse().find((p) => p.type === "text");

  return (
    <div className="tex-msg-in flex gap-2.5">
      <TexAvatar mood="face" className="mt-0.5 size-8 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2.5 text-[15px] text-foreground/90">
        {parts.length === 0 && message.streaming ? (
          <p className="tex-dots pt-1.5 text-[22px] leading-none text-muted-foreground" aria-label="Tex está pensando">
            <span>·</span>
            <span>·</span>
            <span>·</span>
          </p>
        ) : null}
        {groups.map((g, i) => {
          if (g.kind === "tools") {
            return (
              <div key={`t${i}`} className="flex flex-wrap gap-1.5">
                {g.items.map((t) => (
                  <span
                    key={t.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium",
                      t.state === "error" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-black/[0.045] text-muted-foreground dark:bg-white/[0.07]",
                    )}
                  >
                    {t.state === "start" ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : t.state === "error" ? (
                      <AlertCircle className="size-3" aria-hidden />
                    ) : (
                      <Check className="size-3 text-emerald-600" aria-hidden />
                    )}
                    {t.state === "start" ? t.label : t.label.replace(/…$/, "")}
                    {t.note ? <span className="opacity-70">· {t.note}</span> : null}
                  </span>
                ))}
              </div>
            );
          }
          const p = g.part;
          if (p.type === "text") {
            const typing = streaming && last && p === lastText && message.streaming;
            return (
              <div key={`x${i}`} data-typing={typing ? "" : undefined}>
                <TexMarkdown text={p.text} onNavigate={onNavigate} />
              </div>
            );
          }
          if (p.type === "card") return <TexCardView key={p.id} card={p.card} onNavigate={onNavigate} />;
          if (p.type === "proposal") {
            const a = actions[p.actionId];
            if (!a) return null;
            return (
              <TexProposal
                key={p.actionId}
                action={a}
                disabled={streaming && last}
                onConfirm={() => onConfirm(p.actionId)}
                onCancel={() => onCancel(p.actionId)}
                onNavigate={onNavigate}
              />
            );
          }
          if (p.type === "navigate") {
            if (!isInternalHref(p.href)) return null;
            return (
              <Link
                key={`n${i}`}
                href={p.href}
                onClick={onNavigate}
                className="tex-msg-in inline-flex items-center gap-1.5 rounded-full bg-[oklch(0.5_0.09_152)] px-4 py-2 text-[14px] font-semibold text-white shadow-sm active:scale-[0.98]"
              >
                Ir a {p.label}
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            );
          }
          if (p.type === "error") {
            return (
              <div key={`e${i}`} className="flex items-start gap-2 rounded-2xl bg-red-500/[0.08] px-3 py-2.5 text-[13.5px] text-red-800 dark:text-red-200">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{p.message}</span>
                {last && p.code !== "disabled" && p.code !== "not_configured" ? (
                  <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline underline-offset-2">
                    Reintentar
                  </button>
                ) : null}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const noopSubscribe = () => () => {};

function useDictation(onText: (t: string) => void) {
  const supported = React.useSyncExternalStore(
    noopSubscribe,
    () => {
      const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
      return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
    },
    () => false,
  );
  const [listening, setListening] = React.useState(false);
  const recRef = React.useRef<SpeechRec | null>(null);
  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "es-AR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };
  return { supported, listening, toggle };
}

function Composer({
  inputRef,
  value,
  onChange,
  onSubmit,
  streaming,
  onStop,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  streaming: boolean;
  onStop: () => void;
}) {
  const dictation = useDictation(onChange);
  // El campo crece con el texto (hasta 6 renglones).
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 22 + 16)}px`;
  }, [value, inputRef]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="relative z-10 border-t border-black/[0.05] bg-background/80 px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-xl md:pb-3 dark:border-white/[0.06]"
    >
      <div className="mx-auto flex max-w-2xl items-end gap-1.5 rounded-[26px] border border-black/[0.08] bg-card p-1.5 pl-4 shadow-[0_6px_20px_-12px_rgba(22,46,36,0.35)] dark:border-white/10">
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(min-width: 768px)").matches) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={dictation.listening ? "Te escucho…" : "Preguntale o pedile algo a Tex…"}
          aria-label="Mensaje para Tex"
          enterKeyHint="send"
          className="max-h-[148px] min-h-[38px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-[22px] outline-none placeholder:text-muted-foreground"
        />
        {dictation.supported && !streaming ? (
          <button
            type="button"
            onClick={dictation.toggle}
            aria-label={dictation.listening ? "Dejar de dictar" : "Dictar"}
            aria-pressed={dictation.listening}
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full transition-colors",
              dictation.listening ? "animate-pulse bg-red-500 text-white" : "text-muted-foreground hover:bg-black/[0.05] dark:hover:bg-white/10",
            )}
          >
            <Mic className="size-5" />
          </button>
        ) : null}
        {streaming ? (
          <button type="button" onClick={onStop} aria-label="Parar" className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background">
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Enviar"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.5_0.09_152)] text-white shadow-sm transition-opacity disabled:opacity-35"
          >
            <ArrowUp className="size-5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  );
}
