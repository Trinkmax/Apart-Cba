"use client";

import { useEffect } from "react";
import { useLiveContext } from "@/lib/realtime/live-context";
import { decodeDraft, draftStorageKey, encodeDraft, sameFormValues, type DecodedDraft } from "./form-draft";

/**
 * Borrador en sessionStorage de un formulario de ALTA (al editar manda la
 * base, no un borrador viejo). Vive en la pestaña: sobrevive a recargar o
 * navegar, no a cerrarla. Sin storage (modo privado, bloqueado) el formulario
 * anda igual, sólo que sin borrador.
 */

/** Clave del borrador para esta org y este usuario; null = sin borrador (edición o fuera del panel). */
export function useDraftKey(kind: string | null): string | null {
  const live = useLiveContext();
  if (!kind || !live?.organizationId || !live.userId) return null;
  return draftStorageKey(kind, live.organizationId, live.userId);
}

export function readDraft(key: string | null): DecodedDraft | null {
  if (!key || typeof window === "undefined") return null;
  try {
    return decodeDraft(window.sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

export function clearDraft(key: string | null): void {
  if (!key) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* sin storage: no hay nada que borrar */
  }
}

/**
 * Guarda el formulario en cada cambio mientras tenga algo distinto de lo que
 * tenía al abrirse; si vuelve a quedar como estaba, borra el borrador (así no
 * aparece "Recuperamos…" por un formulario vacío). Sin debounce a propósito:
 * con un timer pendiente, guardar y cerrar podía reescribir el borrador
 * después de borrarlo.
 */
export function usePersistDraft(key: string | null, form: unknown, blank: unknown): void {
  useEffect(() => {
    if (!key) return;
    try {
      if (sameFormValues(form, blank)) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, encodeDraft(form));
    } catch {
      /* sin storage o lleno: seguimos sin borrador */
    }
  }, [key, form, blank]);
}
