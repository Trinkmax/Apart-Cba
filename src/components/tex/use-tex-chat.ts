"use client";

import * as React from "react";
import { cancelTexAction, confirmTexAction, getTexAction, getTexConversation } from "@/lib/actions/tex";
import { haptic } from "@/lib/ui/haptics";
import { NdjsonReader } from "@/lib/tex/ndjson";
import type { ProposalView, TexErrorCode, TexEvent, TexPart } from "@/lib/tex/types";

/**
 * El estado del chat con Tex en el navegador (nov-2026): la historia, el
 * stream en vivo (NDJSON de /api/tex/chat) y las propuestas por confirmar.
 * AbortController manual (Safari 15 no tiene AbortSignal.timeout).
 */

export type LivePart =
  | Exclude<TexPart, { type: "tool" }>
  | { type: "tool"; id: string; name: string; label: string; state: "start" | "done" | "error"; note?: string }
  | { type: "error"; message: string; code?: TexErrorCode };

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; parts: LivePart[]; streaming: boolean };

export type TexMood = "idle" | "thinking" | "talking" | "happy";

type State = {
  loaded: boolean;
  conversationId: string | null;
  fresh: boolean;
  messages: ChatMessage[];
  actions: Record<string, ProposalView>;
  streaming: boolean;
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function useTexChat() {
  const [state, setState] = React.useState<State>({
    loaded: false,
    conversationId: null,
    fresh: false,
    messages: [],
    actions: {},
    streaming: false,
  });
  const [activity, setActivity] = React.useState<string | null>(null);
  const [celebrating, setCelebrating] = React.useState(false);
  const celebrateTimer = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const stateRef = React.useRef(state);
  React.useLayoutEffect(() => {
    stateRef.current = state;
  });

  /** Trae la conversación vigente (la primera vez que se abre). */
  const load = React.useCallback(async () => {
    if (stateRef.current.loaded) return;
    const r = await getTexConversation().catch(() => null);
    setState((s) => {
      if (s.loaded) return s;
      if (!r || !r.ok) return { ...s, loaded: true };
      return {
        ...s,
        loaded: true,
        conversationId: r.view.conversationId,
        actions: r.view.actions,
        messages: r.view.messages.map<ChatMessage>((m) =>
          m.role === "user"
            ? { id: m.id, role: "user", text: m.text }
            : { id: m.id, role: "assistant", parts: m.parts as LivePart[], streaming: false },
        ),
      };
    });
  }, []);

  /** Cambia el último mensaje de Tex (el que se está escribiendo). */
  const patchLast = (fn: (parts: LivePart[]) => LivePart[]) =>
    setState((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return s;
      msgs[msgs.length - 1] = { ...last, parts: fn(last.parts) };
      return { ...s, messages: msgs };
    });

  const apply = (ev: TexEvent) => {
    switch (ev.t) {
      case "start":
        setState((s) => ({ ...s, conversationId: ev.conversationId, fresh: false }));
        break;
      case "text":
        setActivity("Escribiendo…");
        patchLast((parts) => {
          const last = parts[parts.length - 1];
          if (last && last.type === "text") return [...parts.slice(0, -1), { type: "text", text: last.text + ev.d }];
          return [...parts, { type: "text", text: ev.d }];
        });
        break;
      case "tool":
        setActivity(ev.state === "start" ? ev.label : null);
        patchLast((parts) => {
          const i = parts.findIndex((p) => p.type === "tool" && p.id === ev.id);
          const next: LivePart = { type: "tool", id: ev.id, name: ev.name, label: ev.label, state: ev.state, note: ev.note };
          if (i === -1) return [...parts, next];
          const copy = [...parts];
          copy[i] = next;
          return copy;
        });
        break;
      case "rewind":
        patchLast((parts) => {
          let left = ev.chars;
          const copy = [...parts];
          for (let i = copy.length - 1; i >= 0 && left > 0; i--) {
            const p = copy[i];
            if (p.type !== "text") continue;
            const cut = Math.min(left, p.text.length);
            left -= cut;
            const text = p.text.slice(0, p.text.length - cut);
            if (text) copy[i] = { type: "text", text };
            else copy.splice(i, 1);
          }
          return copy;
        });
        break;
      case "card":
        patchLast((parts) => [...parts, { type: "card", id: ev.id, card: ev.card }]);
        break;
      case "proposal":
        haptic("impact");
        setState((s) => ({ ...s, actions: { ...s.actions, [ev.action.id]: ev.action } }));
        patchLast((parts) => [...parts, { type: "proposal", actionId: ev.action.id }]);
        break;
      case "navigate":
        patchLast((parts) => [...parts, { type: "navigate", href: ev.href, label: ev.label }]);
        break;
      case "error":
        patchLast((parts) => [...parts, { type: "error", message: ev.message, code: ev.code }]);
        break;
      case "done":
        break;
    }
  };

  const send = React.useCallback(async (text: string, pathname: string) => {
    const message = text.trim();
    if (!message || stateRef.current.streaming) return;
    haptic("selection");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setActivity("Pensando…");
    setState((s) => ({
      ...s,
      streaming: true,
      messages: [
        ...s.messages,
        { id: `u-${uid()}`, role: "user", text: message },
        { id: `a-${uid()}`, role: "assistant", parts: [], streaming: true },
      ],
    }));

    const fail = (msg: string, code?: TexErrorCode) => patchLast((parts) => [...parts, { type: "error", message: msg, code }]);
    try {
      const res = await fetch("/api/tex/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId: stateRef.current.conversationId,
          pathname,
          fresh: stateRef.current.fresh || undefined,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string; code?: TexErrorCode } | null;
        fail(j?.error ?? "No pude conectarme. Probá de nuevo.", j?.code);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const nd = new NdjsonReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const ev of nd.push(decoder.decode(value, { stream: true }))) apply(ev);
      }
      for (const ev of nd.flush()) apply(ev);
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") fail("Se cortó la conexión. Probá de nuevo.");
    } finally {
      abortRef.current = null;
      setActivity(null);
      setState((s) => {
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === "assistant") msgs[msgs.length - 1] = { ...last, streaming: false };
        return { ...s, streaming: false, messages: msgs };
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply`/`patchLast` sólo usan setState
  }, []);

  const stop = React.useCallback(() => abortRef.current?.abort(), []);

  /** Nueva conversación: la próxima pregunta arranca de cero. */
  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    haptic("selection");
    setState((s) => ({ ...s, conversationId: null, fresh: true, messages: [], actions: {}, streaming: false }));
  }, []);

  const setAction = (view: ProposalView) => setState((s) => ({ ...s, actions: { ...s.actions, [view.id]: view } }));

  const confirm = React.useCallback(async (id: string) => {
    const cur = stateRef.current.actions[id];
    if (!cur || cur.status !== "pending") return;
    setAction({ ...cur, status: "executing" });
    const r = await confirmTexAction(id).catch(() => null);
    if (r && r.ok) {
      setAction(r.action);
      haptic("success");
      // Tex festeja un ratito (trofeo) y vuelve.
      setCelebrating(true);
      window.clearTimeout(celebrateTimer.current);
      celebrateTimer.current = window.setTimeout(() => setCelebrating(false), 2600);
      return;
    }
    if (r) {
      setAction(r.action ?? { ...cur, status: "failed", error: r.error });
      return;
    }
    // La confirmación no respondió (se cortó la red): NO se supone que falló —
    // pudo haberse ejecutado. Se relee el estado real antes de decir nada.
    const s = await getTexAction(id).catch(() => null);
    if (s && s.ok) {
      setAction(s.action);
      if (s.action.status === "executed") {
        haptic("success");
        setCelebrating(true);
        window.clearTimeout(celebrateTimer.current);
        celebrateTimer.current = window.setTimeout(() => setCelebrating(false), 2600);
      }
      return;
    }
    setAction({
      ...cur,
      status: "failed",
      error: "Se cortó la conexión y no sé si se hizo. Revisalo en la pantalla antes de repetirlo.",
    });
  }, []);

  const cancel = React.useCallback(async (id: string) => {
    const cur = stateRef.current.actions[id];
    if (!cur || cur.status !== "pending") return;
    setAction({ ...cur, status: "cancelled" });
    const r = await cancelTexAction(id).catch(() => null);
    if (r && r.ok) setAction(r.action);
  }, []);

  let mood: TexMood = "idle";
  if (state.streaming) mood = activity && activity !== "Escribiendo…" ? "thinking" : "talking";

  return { ...state, activity, celebrating, mood, load, send, stop, reset, confirm, cancel };
}
