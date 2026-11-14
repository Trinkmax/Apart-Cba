/**
 * El "tic" del dedo al cambiar de pestaña o confirmar algo (nov-2026).
 *
 * - Android (Chrome, Samsung): `navigator.vibrate` con un pulso cortísimo.
 * - iPhone: Safari no tiene API de vibración, pero desde iOS 18 un
 *   `<input type="checkbox" switch>` produce el háptico del sistema al
 *   cambiar. Se arma uno invisible, se le hace click a su <label> y se saca.
 *   Sólo funciona adentro de un gesto de la persona (pointerup/click): fuera de
 *   eso no hace nada, que es lo que queremos.
 *
 * Siempre best-effort: si algo falla no pasa nada (nunca tira). En la compu
 * no hace nada.
 */

type HapticKind = "selection" | "impact" | "success";

const ANDROID_MS: Record<HapticKind, number | number[]> = {
  selection: 8,
  impact: 14,
  success: [10, 40, 14],
};

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS se presenta como Mac: lo delata el multitáctil.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

export function haptic(kind: HapticKind = "selection"): void {
  try {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (/Android/i.test(navigator.userAgent) && typeof navigator.vibrate === "function") {
      navigator.vibrate(ANDROID_MS[kind]);
      return;
    }
    if (!isIOS()) return;
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    if (kind === "success") {
      // Dos golpecitos: el segundo un toque después.
      window.setTimeout(() => {
        try {
          label.click();
        } finally {
          label.remove();
        }
      }, 90);
      return;
    }
    label.remove();
  } catch {
    /* best-effort */
  }
}
