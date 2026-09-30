"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { getMyWishlistIds } from "@/lib/actions/storefront";
import { toggleWishlist } from "@/lib/actions/wishlists";

/**
 * Favoritos del huésped: un store de módulo compartido por todas las tarjetas,
 * la ficha y el header. Se carga UNA vez por pestaña:
 *   - la sesión se lee local (`auth.getSession()`, sin red): un visitante sin
 *     cuenta —la enorme mayoría— no dispara ninguna Server Action;
 *   - con sesión, `getMyWishlistIds()` trae los ids guardados.
 * Si la sesión cambia (ingresa / sale), se vuelve a cargar.
 * El toggle es optimista y se reconcilia con lo que responde el server.
 */

type WishlistState = {
  ids: Set<string>;
  /** Ya sabemos si hay sesión y (si la hay) qué guardó. */
  ready: boolean;
  loggedIn: boolean;
};

const useWishlistStore = create<WishlistState>()(() => ({
  ids: new Set<string>(),
  ready: false,
  loggedIn: false,
}));

let loadPromise: Promise<void> | null = null;
let loadSeq = 0;
let authSubscribed = false;
let currentUserId: string | null | undefined = undefined;
/** Unidades con un toggle en vuelo: evita que dos clicks rápidos se crucen. */
const pending = new Set<string>();

async function load(): Promise<void> {
  const seq = ++loadSeq;
  let loggedIn = false;
  try {
    const { data } = await createClient().auth.getSession();
    loggedIn = Boolean(data.session);
    currentUserId = data.session?.user.id ?? null;
  } catch {
    loggedIn = false;
  }
  let ids: string[] = [];
  if (loggedIn) {
    try {
      ids = await getMyWishlistIds();
    } catch {
      ids = [];
    }
  }
  // Una carga más nueva (cambió la sesión en el medio) manda.
  if (seq !== loadSeq) return;
  useWishlistStore.setState({ ids: new Set(ids), loggedIn, ready: true });
}

function ensureLoaded(): void {
  if (typeof window === "undefined") return;
  if (!authSubscribed) {
    authSubscribed = true;
    try {
      createClient().auth.onAuthStateChange((event, session) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
        const nextUserId = session?.user.id ?? null;
        // SIGNED_IN también llega al recuperar la misma sesión: sólo recargamos
        // si de verdad cambió quién está del otro lado.
        if (currentUserId !== undefined && nextUserId === currentUserId) return;
        currentUserId = nextUserId;
        loadPromise = load();
      });
    } catch {
      // Sin cliente de Supabase (env incompleto): los favoritos quedan inertes.
    }
  }
  if (!loadPromise) loadPromise = load();
}

function setSaved(unitId: string, saved: boolean): void {
  useWishlistStore.setState((s) => {
    if (s.ids.has(unitId) === saved) return s;
    const ids = new Set(s.ids);
    if (saved) ids.add(unitId);
    else ids.delete(unitId);
    return { ids };
  });
}

function loginPath(): string {
  const here = `${window.location.pathname}${window.location.search}`;
  return `/ingresar?redirect=${encodeURIComponent(here)}`;
}

const GENERIC_ERROR = "No pudimos guardar el favorito. Probá de nuevo.";

async function toggleUnit(unitId: string, askLogin: () => void): Promise<void> {
  ensureLoaded();
  if (pending.has(unitId)) return;
  if (!useWishlistStore.getState().ready && loadPromise) await loadPromise;
  const state = useWishlistStore.getState();
  if (!state.loggedIn) {
    askLogin();
    return;
  }
  const had = state.ids.has(unitId);
  pending.add(unitId);
  setSaved(unitId, !had);
  try {
    const result = await toggleWishlist(unitId);
    if (result.ok) {
      setSaved(unitId, typeof result.added === "boolean" ? result.added : !had);
      return;
    }
    setSaved(unitId, had);
    const reason = "reason" in result ? result.reason : undefined;
    const message = result.error ?? "";
    if (reason === "auth" || (!reason && /sesi[oó]n|ingres|inici/i.test(message))) {
      useWishlistStore.setState({ loggedIn: false });
      askLogin();
    } else if (reason === "not_found") {
      toast.error("Este lugar ya no está disponible.");
    } else {
      toast.error(GENERIC_ERROR);
    }
  } catch {
    setSaved(unitId, had);
    toast.error(GENERIC_ERROR);
  } finally {
    pending.delete(unitId);
  }
}

/** Acción de guardar/quitar (sin suscribirse a la lista entera). */
export function useWishlistToggle(): (unitId: string) => Promise<void> {
  const router = useRouter();
  useEffect(() => {
    ensureLoaded();
  }, []);
  return useCallback(
    (unitId: string) =>
      toggleUnit(unitId, () => {
        toast("Guardá tus favoritos con una cuenta", {
          description: "Así los encontrás desde cualquier dispositivo.",
          action: { label: "Ingresar", onClick: () => router.push(loginPath()) },
        });
      }),
    [router],
  );
}

/** ¿Esta unidad está guardada? Sólo re-renderiza cuando cambia ESTE valor. */
export function useIsWishlisted(unitId: string): boolean {
  useEffect(() => {
    ensureLoaded();
  }, []);
  return useWishlistStore((s) => s.ids.has(unitId));
}

export function useWishlist(): {
  ids: Set<string>;
  ready: boolean;
  loggedIn: boolean;
  toggle(unitId: string): Promise<void>;
} {
  const ids = useWishlistStore((s) => s.ids);
  const ready = useWishlistStore((s) => s.ready);
  const loggedIn = useWishlistStore((s) => s.loggedIn);
  const toggle = useWishlistToggle();
  return { ids, ready, loggedIn, toggle };
}

/**
 * Precarga lo que ya trajo el server (p. ej. /favoritos) para que los
 * corazones aparezcan llenos desde el primer paint. Si el store ya cargó, no
 * toca nada (lo que tiene está al día con los toggles de esta pestaña).
 */
export function seedWishlist(ids: readonly string[]): void {
  const s = useWishlistStore.getState();
  if (s.ready || ids.length === 0) return;
  const merged = new Set(s.ids);
  for (const id of ids) merged.add(id);
  useWishlistStore.setState({ ids: merged, loggedIn: true });
}
