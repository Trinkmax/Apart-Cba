import type { Metadata } from "next";

/**
 * Superficie comercial de rentOS. Vive en su propio route group para NO heredar
 * el layout del marketplace, que monta el header/footer de ApartCBA (la marca de
 * huéspedes, no la del panel).
 *
 * El tema se fija en claro con la clase `light`, no con un `<ThemeProvider
 * forcedTheme>` anidado: el provider del layout raíz ya escribe la clase en
 * `<html>` y gana, así que un provider acá adentro no cambia nada. La clase
 * redeclara los tokens (`--background`, `--card`, `--primary`, `color-scheme`)
 * para todo el subárbol, que es lo único que hace falta.
 *
 * Consecuencia a tener en cuenta: cualquier componente que porte su contenido a
 * `document.body` (dialogs, popovers de Radix) queda FUERA de este subárbol y se
 * pintaría con el tema del root. Hoy esta superficie no usa ninguno.
 */
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://www.apartcba.com"),
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="light min-h-[100dvh] bg-background text-foreground antialiased">
      {children}
    </div>
  );
}
