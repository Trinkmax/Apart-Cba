"use client";

import { useSyncExternalStore } from "react";

/**
 * Qué tarjeta está "activa" (hover/foco en la grilla, o elegida en el mapa).
 * Vive afuera de React: la grilla sólo ESCRIBE (no se re-renderiza al pasar
 * el mouse) y el mapa se suscribe para pintar la píldora activa.
 */
export type HoverStore = {
  get(): string | null;
  set(id: string | null): void;
  subscribe(listener: () => void): () => void;
};

export function createHoverStore(): HoverStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(id) {
      if (id === current) return;
      current = id;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useHoveredId(store: HoverStore): string | null {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}
