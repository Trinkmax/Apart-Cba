"use client";

/**
 * Estado chico del shell del celular, a nivel módulo (sin contexto de React):
 * la barra, la hoja «Más», el círculo de Tex y la barra de arriba se hablan
 * por acá sin envolver la app en un proveedor (patrón de sharp-app).
 *
 * - `openMore()` / `closeMore()` / `useMoreOpen()`: la hoja «Más».
 * - `openTex({ origin, prompt })` / `closeTex()` / `useTexState()`: la hoja de
 *   Tex; `origin` es el punto de la pantalla desde donde nace (genie).
 * - La pila de navegación: de dónde vino la persona, para que «‹ volver» diga
 *   la pantalla de verdad y vuelva ahí (`useNavBack`).
 *
 * También por evento, para quien no puede importar esto:
 * `window.dispatchEvent(new CustomEvent("apart:tex", { detail: { prompt } }))`.
 */
import * as React from "react";
import { usePathname } from "next/navigation";

type Listener = () => void;

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

// ── «Más» ────────────────────────────────────────────────────────────────────

const more = createStore(false);

export function openMore(): void {
  more.set(true);
}
export function closeMore(): void {
  more.set(false);
}
export function toggleMore(): void {
  more.set(!more.get());
}
export function useMoreOpen(): boolean {
  return React.useSyncExternalStore(more.subscribe, more.get, () => false);
}

// ── Tex ──────────────────────────────────────────────────────────────────────

export type TexOpenState = {
  open: boolean;
  /** Punto de la pantalla (px) desde donde nace la hoja. */
  origin: { x: number; y: number } | null;
  /** Pregunta para mandar apenas se abre. */
  prompt: string | null;
  /** Cambia en cada apertura (para reiniciar la animación). */
  nonce: number;
};

const CLOSED: TexOpenState = { open: false, origin: null, prompt: null, nonce: 0 };
const tex = createStore<TexOpenState>(CLOSED);

export function openTex(opts: { origin?: { x: number; y: number } | null; prompt?: string | null } = {}): void {
  closeMore();
  tex.set({ open: true, origin: opts.origin ?? null, prompt: opts.prompt ?? null, nonce: tex.get().nonce + 1 });
}
export function closeTex(): void {
  const cur = tex.get();
  if (!cur.open) return;
  tex.set({ ...cur, open: false, prompt: null });
}
/** Ya se usó la pregunta inicial: que no se mande dos veces. */
export function consumeTexPrompt(): void {
  const cur = tex.get();
  if (cur.prompt) tex.set({ ...cur, prompt: null });
}
export function useTexState(): TexOpenState {
  return React.useSyncExternalStore(tex.subscribe, tex.get, () => CLOSED);
}

/** El centro de un elemento, para que la hoja nazca de ahí. */
export function originOf(el: Element | null | undefined): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ── Pila de navegación ───────────────────────────────────────────────────────

export type NavEntry = { pathname: string; search: string };

const MAX_STACK = 30;
const nav = createStore<{ stack: NavEntry[] }>({ stack: [] });

/** La llama MobileShell en cada cambio de ruta. */
export function recordNavigation(entry: NavEntry, mode: "push" | "pop" | "replace"): void {
  const stack = [...nav.get().stack];
  const top = stack[stack.length - 1];
  if (top && top.pathname === entry.pathname && top.search === entry.search) return;
  if (mode === "pop") {
    // Volvió atrás: se saca lo de arriba hasta encontrarla (o se empieza de nuevo).
    const i = stack.map((e) => e.pathname + e.search).lastIndexOf(entry.pathname + entry.search);
    nav.set({ stack: i >= 0 ? stack.slice(0, i + 1) : [entry] });
    return;
  }
  if (mode === "replace" && stack.length) stack[stack.length - 1] = entry;
  else stack.push(entry);
  nav.set({ stack: stack.slice(-MAX_STACK) });
}

/** Empieza de cero (cambio de pestaña: cada pestaña es su propia raíz). */
export function resetNavigation(entry: NavEntry): void {
  nav.set({ stack: [entry] });
}

const NO_PREV: NavEntry | null = null;
let lastStack: NavEntry[] = [];
let lastPrev: NavEntry | null = NO_PREV;
function previousEntry(): NavEntry | null {
  const s = nav.get().stack;
  if (s === lastStack) return lastPrev;
  lastStack = s;
  lastPrev = s.length >= 2 ? s[s.length - 2] : null;
  return lastPrev;
}

/** La pantalla anterior de esta visita (o null si se llegó por link directo). */
export function usePreviousScreen(): NavEntry | null {
  return React.useSyncExternalStore(nav.subscribe, previousEntry, () => null);
}

// ── Ruta del shell ───────────────────────────────────────────────────────────

const PathOverride = React.createContext<string | null>(null);
/** Sólo para la vista previa de desarrollo: hace de cuenta que el shell está en otra ruta. */
export const ShellPathOverride = PathOverride.Provider;

/** La ruta actual para el shell (la de verdad, salvo en la vista previa). */
export function useShellPathname(): string {
  const override = React.useContext(PathOverride);
  const real = usePathname();
  return override ?? real;
}
