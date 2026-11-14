"use client";

import * as React from "react";
import type { UserRole } from "@/lib/types/database";
import { TexSheet } from "@/components/tex/tex-sheet";
import { GlassTabBar } from "./glass-tab-bar";
import { MoreSheet } from "./more-sheet";
import { mobileTabs, routeMeta, type ShellContext, type TabId } from "./routes";
import { recordNavigation, useShellPathname } from "./shell-store";
import { TexOrb } from "./tex-orb";

/*
 * El shell del celular (nov-2026): la barra de pestañas flotante + el círculo
 * de Tex, la hoja «Más» y la hoja de Tex. Lo montan /dashboard y /m al final
 * del layout (todo lo de acá es fijo o en portal). La barra de arriba
 * (`AppHeader`) va aparte, antes del <main>, porque es sticky en el flujo.
 *
 * Además lleva la cuenta de:
 * - la pila de navegación (para «‹ volver a …»),
 * - el teclado en pantalla (`html[data-kb="open"]`: la barra se va),
 * - el fundido de entrada de cada pantalla (`main[data-reveal]`).
 * La compu no ve nada de esto, salvo la hoja de Tex (que ahí es una tarjeta).
 */

export type MobileShellProps = {
  role: UserRole;
  rentalsEnabled: boolean;
  texEnabled: boolean;
  userId: string;
  user: { fullName: string; firstName: string; email?: string | null; avatarUrl?: string | null };
  org: { id: string; name: string };
  memberships: Array<{ id: string; name: string; role: UserRole }>;
  unreadCount: number;
  pendingRequests: number;
};

export function MobileShell(p: MobileShellProps) {
  const pathname = useShellPathname();
  const ctx = React.useMemo<ShellContext>(() => ({ role: p.role, rentalsEnabled: p.rentalsEnabled }), [p.role, p.rentalsEnabled]);
  const tabs = React.useMemo(() => mobileTabs(ctx), [ctx]);
  const meta = React.useMemo(() => routeMeta(pathname, ctx), [pathname, ctx]);
  const showTex = p.texEnabled && p.role !== "owner_view";

  // Marca para lo que vive fuera del shell (los avisos de sonner suben arriba de la barra).
  React.useLayoutEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-mobile-shell", "");
    return () => html.removeAttribute("data-mobile-shell");
  }, []);

  // La pila de navegación: un «atrás» del navegador llega como popstate antes
  // que la ruta nueva; lo demás es avanzar.
  const popRef = React.useRef(false);
  React.useEffect(() => {
    const onPop = () => {
      popRef.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  React.useEffect(() => {
    const mode = popRef.current ? "pop" : "push";
    popRef.current = false;
    recordNavigation({ pathname, search: window.location.search }, mode);
  }, [pathname]);

  // El teclado: mientras se escribe, la barra se va y le deja lugar al campo.
  React.useEffect(() => {
    const vv = window.visualViewport;
    const html = document.documentElement;
    const typing = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    let raf = 0;
    const check = () => {
      raf = 0;
      const shrunk = vv ? window.innerHeight - vv.height > 140 : false;
      if (shrunk && typing()) html.setAttribute("data-kb", "open");
      else html.removeAttribute("data-kb");
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    let blurTimer = 0;
    const onBlur = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(schedule, 60);
    };
    vv?.addEventListener("resize", schedule);
    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", onBlur);
    return () => {
      vv?.removeEventListener("resize", schedule);
      window.removeEventListener("focusin", schedule);
      window.removeEventListener("focusout", onBlur);
      window.clearTimeout(blurTimer);
      if (raf) cancelAnimationFrame(raf);
      html.removeAttribute("data-kb");
    };
  }, []);

  // Cada pantalla nueva entra con un fundido (sólo la animación: nada se remonta).
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const main = document.querySelector<HTMLElement>("main[data-shell-main]");
    if (main) main.dataset.reveal = main.dataset.reveal === "a" ? "b" : "a";
  }, [pathname]);

  const badges: Partial<Record<TabId, number>> = {};
  if (p.pendingRequests > 0) badges.reservas = p.pendingRequests;

  return (
    <>
      <div className="lg-bar md:hidden">
        <GlassTabBar tabs={tabs} activeTab={meta.tab} atRoot={meta.kind === "root"} badges={badges} />
        {showTex ? <TexOrb userId={p.userId} /> : null}
      </div>
      <MoreSheet
        role={p.role}
        rentalsEnabled={p.rentalsEnabled}
        texEnabled={showTex}
        user={p.user}
        org={p.org}
        memberships={p.memberships}
        unreadCount={p.unreadCount}
      />
      {showTex ? <TexSheet firstName={p.user.firstName} role={p.role} rentalsEnabled={p.rentalsEnabled} /> : null}
    </>
  );
}
