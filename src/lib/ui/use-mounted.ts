"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** true en el navegador después de hidratar; false en el servidor (sin setState en un efecto). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
