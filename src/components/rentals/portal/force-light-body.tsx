"use client";

import { useEffect } from "react";

/**
 * El portal es siempre claro. La clase `light` en el contenedor no alcanza a
 * los diálogos y toasts, que Radix/sonner montan en `document.body`: se la
 * ponemos también al body mientras el portal está abierto.
 */
export function ForceLightBody() {
  useEffect(() => {
    const body = document.body;
    const had = body.classList.contains("light");
    body.classList.add("light");
    return () => {
      if (!had) body.classList.remove("light");
    };
  }, []);
  return null;
}
