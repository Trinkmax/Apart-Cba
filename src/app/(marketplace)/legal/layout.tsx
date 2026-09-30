import type { ReactNode } from "react";
import { LegalNav } from "@/components/marketplace/shell/legal-nav";

/**
 * Textos legales dentro de la web de apart: el header y el footer los pone el
 * layout de (marketplace). Acá sólo la columna de lectura y las pestañas.
 * Las URLs (/legal/*) no cambian: están cargadas en Meta y en los mails.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:pb-28">
      <LegalNav />
      <div className="mt-10 sm:mt-12">{children}</div>
    </div>
  );
}
