"use client";

import { useEffect, useSyncExternalStore } from "react";
import { InstallAppDialog } from "@/components/pwa/install-app-dialog";

/** Evento no estándar de Chromium: no está en lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type InstallState = {
  /** Ya corre instalada (standalone / ícono en inicio): no tiene sentido ofrecerla. */
  standalone: boolean;
  /** El navegador ofreció su prompt nativo y lo tenemos agarrado. */
  canPrompt: boolean;
  /** Diálogo de instrucciones manuales (iOS, Safari, o sin prompt nativo). */
  dialogOpen: boolean;
};

/**
 * Store a nivel módulo, compartido por el item del menú y el botón de /m.
 *
 * `beforeinstallprompt` se dispara UNA sola vez y temprano (apenas Chrome
 * decide que la página es instalable). El item del menú se monta recién al
 * abrir el dropdown, así que si el listener viviera ahí llegaría tarde y el
 * prompt nativo se perdería. Se registra al evaluar el módulo (antes de la
 * hidratación) y el resto se sincroniza desde <InstallAppListener/>.
 *
 * En el server no hay window: el snapshot de SSR dice "oculto" para que nada
 * se pinte hasta saber si ya está instalada (evita el flash y el mismatch).
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const SERVER_STATE: InstallState = { standalone: true, canPrompt: false, dialogOpen: false };
// Arranca con el MISMO objeto que el snapshot de server: así la hidratación no
// dispara un re-render de más por comparar dos objetos iguales por valor.
let state: InstallState = SERVER_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return SERVER_STATE;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const byMedia = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  // iOS no implementa display-mode en versiones viejas: expone navigator.standalone.
  const byIos = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return byMedia || byIos;
}

function onBeforeInstallPrompt(e: Event) {
  // Sin esto Chrome muestra su mini-infobar cuando quiere; lo guardamos para
  // dispararlo desde nuestro botón.
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  setState({ canPrompt: true });
}

function onAppInstalled() {
  deferredPrompt = null;
  setState({ canPrompt: false, standalone: true });
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
}

/**
 * Pide instalar: prompt nativo si el navegador lo dio; si no (iOS, Safari de
 * Mac, Firefox, o Chrome que todavía no lo ofreció), instrucciones a mano.
 */
export async function requestInstall(): Promise<void> {
  const ev = deferredPrompt;
  if (ev) {
    // El evento sirve una sola vez: se consume acá pase lo que pase.
    deferredPrompt = null;
    setState({ canPrompt: false });
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === "accepted") setState({ standalone: true });
      // Si lo rechazó, fue a propósito: no lo perseguimos con el diálogo manual.
      return;
    } catch {
      // Prompt ya usado o bloqueado por el navegador: caemos al manual.
    }
  }
  setState({ dialogOpen: true });
}

export function useInstallApp() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    /** true cuando ya está instalada (o todavía no sabemos): no mostrar la opción. */
    hidden: s.standalone,
    canPrompt: s.canPrompt,
    dialogOpen: s.dialogOpen,
  };
}

export function closeInstallDialog() {
  setState({ dialogOpen: false });
}

/**
 * Componente siempre montado (top bar del dashboard, header de /m): resuelve
 * si ya está instalada y aloja el diálogo de instrucciones. El diálogo vive
 * acá y no en el item del menú porque el dropdown se cierra al elegir un item
 * y se llevaría puesto lo que el item hubiera abierto.
 */
export function InstallAppListener() {
  const { dialogOpen } = useInstallApp();

  useEffect(() => {
    setState({ standalone: isStandalone() });
    // Si el usuario la instala desde el navegador mientras la pestaña está
    // abierta, display-mode no cambia en esa pestaña pero `appinstalled` sí llega.
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const onChange = () => setState({ standalone: isStandalone() });
    mq?.addEventListener?.("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
  }, []);

  return (
    <InstallAppDialog
      open={dialogOpen}
      onOpenChange={(v) => {
        if (!v) closeInstallDialog();
      }}
    />
  );
}
