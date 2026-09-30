"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_SHELL_CONTACT, type ShellContact } from "./contact";

/**
 * El contacto del sitio para los componentes cliente que no lo reciben por
 * props: sobre todo `error.tsx`, que Next monta como límite de error y no
 * puede leer nada del server. Lo provee el layout de la web con el mismo
 * `ShellContact` que usan el header y el footer (valores planos,
 * serializables, sin cookies).
 */
const SiteContactContext = createContext<ShellContact>(EMPTY_SHELL_CONTACT);

export function SiteContactProvider({ value, children }: { value: ShellContact; children: ReactNode }) {
  return <SiteContactContext.Provider value={value}>{children}</SiteContactContext.Provider>;
}

export function useSiteContact(): ShellContact {
  return useContext(SiteContactContext);
}
