"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptics";
import { lensChannelScales, lensMap, lensStretch, rubberBand } from "@/lib/ui/lens";
import { reflow } from "@/lib/ui/reflow";
import { SCREEN_ICONS } from "./icons";
import type { MobileTab, TabId } from "./routes";
import { closeMore, resetNavigation, toggleMore, useMoreOpen, useShellPathname } from "./shell-store";

/*
 * La barra de pestañas del celular con el vidrio de iOS 26 (nov-2026).
 * Portada de sharp-app (components/app/mobile/glass-tab-bar.tsx), mismo autor.
 *
 * Una cápsula que FLOTA sobre el contenido, con la pestaña elegida sobre una
 * pastilla que se desliza. El lugar que tapa lo descuenta el CSS
 * (`--bar-overlay`, mobile-shell.css): el último renglón queda arriba de ella.
 *
 * La «lupa» (lo del video de WhatsApp en iOS 26):
 * - Arrastrar el dedo por la barra: la pastilla crece, se despega, agranda lo
 *   que tiene abajo y sigue al dedo estirándose con la velocidad; al soltar se
 *   acomoda en la pestaña más cercana y va ahí.
 * - Tocar una pestaña (agregado acá): la lupa se levanta en la pestaña actual,
 *   viaja estirada hasta la tocada y se asienta con un rebote.
 * Lo que se ve agrandado es una copia de la barra (aria-hidden) alineada con
 * la de verdad; fuera del nivel «lite», un filtro SVG la dobla en el canto
 * como una lente convexa, con flecos de arco iris (`src/lib/ui/lens.ts`).
 * Cada cuadro escribe transforms desde refs, sin estado de React.
 *
 * Reglas de toque (las de sharp-app):
 * - Una pestaña siempre lleva a su raíz; tocar la pestaña en la que ya estás
 *   vuelve a la raíz desde una sub-pantalla, o sube al principio en la raíz.
 * - «Más» abre y cierra la hoja.
 * - Un segundo toque dentro de los 350 ms de un cambio no cuenta.
 */

const GUARD_MS = 350;
const PENDING_MS = 8_000;
/** Cuánto hay que correr el dedo de costado para que el toque pase a ser «arrastrar». */
const DRAG_THRESHOLD_PX = 6;
/* La lupa. Tienen que coincidir con `.lg-bar-lens` en glass.css. */
const LENS_WIDTH = 1.4;
const LENS_HEIGHT = 74;
/** Cuánto agranda la lupa lo que pasa por abajo. */
const MAGNIFY = 1.3;
/** Lo que tarda en volver a ser pastilla al soltar (la transición de glass.css). */
const SETTLE_MS = 380;
/** Al tocar: cuánto viaja la lupa levantada antes de asentarse. */
const TAP_TRAVEL_MS = 330;
/** Después de arrastrar, el «click» que manda el navegador al soltar no cuenta. */
const NO_CLICK_MS = 450;

type Gesture = {
  id: number;
  x0: number;
  x: number;
  /** Velocidad del dedo (px/ms, suavizada) y cuándo se movió por última vez. */
  v: number;
  t: number;
  dragging: boolean;
  left: number;
  width: number;
  height: number;
  cell: number;
  lensWidth: number;
  /** Última celda por la que pasó (para el tic háptico). */
  lastCell: number;
};

export type GlassTabBarProps = {
  tabs: MobileTab[];
  /** La pestaña de la pantalla actual (de `routeMeta`). */
  activeTab: TabId | null;
  /** La pantalla actual es la raíz de su pestaña. */
  atRoot: boolean;
  /** Puntitos en las pestañas (solicitudes sin responder, avisos). */
  badges?: Partial<Record<TabId, number>>;
};

export function GlassTabBar({ tabs, activeTab, atRoot, badges }: GlassTabBarProps) {
  const pathname = useShellPathname();
  const router = useRouter();
  const moreOpen = useMoreOpen();

  // La pestaña tocada se enciende ya (optimista) y se apaga sola cuando llega
  // la pantalla: queda atada a la ruta en la que se tocó.
  const [pendingState, setPendingState] = React.useState<{ tab: TabId; path: string } | null>(null);
  const pending = pendingState && pendingState.path === pathname ? pendingState.tab : null;
  const setPending = React.useCallback(
    (tab: TabId | null) => setPendingState(tab ? { tab, path: pathname } : null),
    [pathname],
  );
  const lastChange = React.useRef(0);
  /** Lo mismo en el reloj de performance (para el viaje de la lupa). */
  const lastChangePerf = React.useRef(-Infinity);

  const capsuleRef = React.useRef<HTMLElement>(null);
  const rowRef = React.useRef<HTMLUListElement>(null);
  const lensRef = React.useRef<HTMLSpanElement>(null);
  const copyRef = React.useRef<HTMLSpanElement>(null);
  const mapRef = React.useRef<SVGFEImageElement>(null);

  // Si la pantalla no llega en 8 s, el indicador optimista se apaga.
  React.useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPendingState(null), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const shown: TabId | null = moreOpen ? "mas" : (pending ?? activeTab);
  const index = tabs.findIndex((t) => t.id === shown);
  const n = tabs.length;
  /** La pestaña de verdad (sin la optimista). */
  const chosen = tabs.findIndex((t) => t.id === (moreOpen ? "mas" : activeTab));

  /** Lo que hace tocar (o soltar la lupa en) una pestaña. */
  const activate = React.useCallback(
    (tab: MobileTab) => {
      const now = Date.now();
      if (now - lastChange.current < GUARD_MS) return;

      if (tab.id === "mas") {
        lastChange.current = now;
        haptic("selection");
        toggleMore();
        return;
      }
      const wasMoreOpen = moreOpen;
      closeMore();

      if (tab.id === activeTab) {
        if (atRoot) {
          // Con «Más» abierta, tocar la pestaña de la pantalla sólo cierra la hoja.
          if (wasMoreOpen) {
            lastChange.current = now;
            return;
          }
          const ev = new CustomEvent("apart:tab-reselect", { detail: { tab: tab.id }, cancelable: true });
          window.dispatchEvent(ev);
          if (!ev.defaultPrevented) window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        lastChange.current = now;
        haptic("selection");
        resetNavigation({ pathname: tab.href, search: "" });
        router.push(tab.href, { scroll: true });
        return;
      }

      lastChange.current = now;
      lastChangePerf.current = performance.now();
      haptic("selection");
      setPending(tab.id);
      // Cada pestaña es su propia raíz: «‹ volver» no cruza de una a otra.
      resetNavigation({ pathname: tab.href, search: "" });
      router.push(tab.href, { scroll: true });
    },
    [activeTab, atRoot, moreOpen, router, setPending],
  );

  // Lo que el gesto (oyentes nativos, montados una vez) necesita de este render.
  const live = React.useRef({ tabs, chosen, shownIndex: index, activate, onDrag: () => {}, onCancel: () => {} });
  React.useLayoutEffect(() => {
    live.current = {
      tabs,
      chosen,
      shownIndex: index,
      activate,
      onDrag: () => setPendingState(null),
      onCancel: () => setPendingState(null),
    };
  });

  // El mapa de la lente, del tamaño exacto de la lupa. Se arma al montar y
  // otra vez si cambia el ancho de la barra o la cantidad de pestañas. El
  // filtro se prende recién con la imagen lista (`data-optics`). En «lite» no
  // hay lente: ni se arma.
  React.useEffect(() => {
    const capsule = capsuleRef.current;
    const row = rowRef.current;
    const fe = mapRef.current;
    if (!capsule || !row || !fe || typeof ResizeObserver === "undefined") return;
    if (document.documentElement.getAttribute("data-glass") === "lite") return;
    let key = "";
    let alive = true;
    const build = () => {
      const count = Math.max(1, row.childElementCount);
      const width = Math.round((row.clientWidth / count - 8) * LENS_WIDTH * 2) / 2;
      if (!(width > 0)) return;
      const next = `${width}x${LENS_HEIGHT}`;
      if (next === key) return;
      key = next;
      capsule.removeAttribute("data-optics");
      try {
        const m = lensMap(width, LENS_HEIGHT);
        const canvas = document.createElement("canvas");
        canvas.width = m.width;
        canvas.height = m.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.putImageData(new ImageData(m.data, m.width, m.height), 0, 0);
        const url = canvas.toDataURL("image/png");
        const img = new Image();
        img.src = url;
        const ready = () => {
          if (!alive || key !== next) return;
          fe.setAttribute("href", url);
          capsule.setAttribute("data-optics", "");
        };
        img.decode().then(ready, ready);
      } catch {
        /* sin canvas: la lupa queda con la copia agrandada sola */
      }
    };
    const ro = new ResizeObserver(build);
    ro.observe(row);
    return () => {
      alive = false;
      ro.disconnect();
      capsule.removeAttribute("data-optics");
    };
  }, [n]);

  // La lupa: arrastrar el dedo por la barra, y el viaje al tocar.
  React.useEffect(() => {
    const capsule = capsuleRef.current;
    const row = rowRef.current;
    const lens = lensRef.current;
    const copy = copyRef.current;
    if (!capsule || !row || !lens || !copy) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let gesture: Gesture | null = null;
    let frame = 0;
    let settleTimer = 0;
    let travelTimer = 0;
    let noClickUntil = 0;

    const measure = (g: Pick<Gesture, "left" | "width" | "height" | "cell" | "lensWidth">) => {
      const r = row.getBoundingClientRect();
      const count = Math.max(1, live.current.tabs.length);
      g.left = r.left;
      g.width = r.width;
      g.height = r.height;
      g.cell = r.width / count;
      g.lensWidth = (g.cell - 8) * LENS_WIDTH;
      copy.style.width = `${r.width}px`;
      copy.style.height = `${r.height}px`;
    };

    /** Pone la lupa con su centro en `center` (px desde el borde de la fila) y alinea la copia. */
    const paint = (
      g: Pick<Gesture, "cell" | "lensWidth" | "height">,
      center: number,
      stretch: { x: number; y: number } = { x: 1, y: 1 },
    ) => {
      const scale =
        stretch.x === 1 && stretch.y === 1 ? "" : ` scale(${stretch.x.toFixed(3)},${stretch.y.toFixed(3)})`;
      lens.style.transform = `translate3d(${center - g.cell / 2}px,0,0)${scale}`;
      // La copia se agranda alrededor del centro de la lupa: lo que está justo
      // abajo del dedo queda en su lugar y el resto se abre hacia los costados.
      const tx = g.lensWidth / 2 - MAGNIFY * center;
      const ty = LENS_HEIGHT / 2 - (MAGNIFY * g.height) / 2;
      copy.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${MAGNIFY})`;
    };

    const centerOf = (g: Gesture) => {
      const raw = g.x - g.left;
      const min = g.cell / 2;
      const max = g.width - g.cell / 2;
      if (raw < min) return min - rubberBand(min - raw);
      if (raw > max) return max + rubberBand(raw - max);
      return raw;
    };

    const onFrame = () => {
      frame = 0;
      const g = gesture;
      if (!g?.dragging) return;
      // El estirón se desinfla solo cuando el dedo se queda quieto.
      if (performance.now() - g.t > 40) g.v *= 0.7;
      if (Math.abs(g.v) < 0.01) g.v = 0;
      const c = centerOf(g);
      paint(g, c, reducedMotion.matches ? undefined : lensStretch(g.v));
      const cellNow = Math.min(live.current.tabs.length - 1, Math.max(0, Math.floor(c / g.cell)));
      if (cellNow !== g.lastCell) {
        g.lastCell = cellNow;
        haptic("selection");
      }
      if (g.v !== 0) frame = requestAnimationFrame(onFrame);
    };

    const clearTimers = () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(travelTimer);
    };

    const startDrag = (g: Gesture) => {
      g.dragging = true;
      measure(g);
      clearTimers();
      capsule.removeAttribute("data-travel");
      // Primero la posición (sin transición) y después el estado: la lupa nace
      // debajo del dedo y crece desde el tamaño de la pastilla.
      paint(g, centerOf(g));
      g.lastCell = Math.min(live.current.tabs.length - 1, Math.max(0, Math.floor(centerOf(g) / g.cell)));
      capsule.setAttribute("data-lens", "drag");
      try {
        capsule.setPointerCapture(g.id);
      } catch {
        /* el puntero ya no está: los oyentes de window siguen igual */
      }
      live.current.onDrag();
    };

    const removeListeners = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    /** Termina el arrastre: la lupa vuelve a ser pastilla en una pestaña. */
    const endDrag = (g: Gesture, release: boolean) => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      gesture = null;
      removeListeners();
      noClickUntil = performance.now() + NO_CLICK_MS;

      const { tabs: list, chosen: current } = live.current;
      const last = list.length - 1;
      const target = release ? Math.min(last, Math.max(0, Math.round((centerOf(g) - g.cell / 2) / g.cell))) : current;
      capsule.setAttribute("data-lens", "settle");
      if (target >= 0) paint(g, target * g.cell + g.cell / 2);
      settleTimer = window.setTimeout(() => capsule.removeAttribute("data-lens"), reducedMotion.matches ? 0 : SETTLE_MS);
      // Volver a soltar en la pestaña en la que ya estabas no es tocarla.
      const tab = release && target !== current ? list[target] : undefined;
      if (tab) live.current.activate(tab);
    };

    /**
     * Al tocar otra pestaña: la lupa se levanta donde está la pastilla, viaja
     * estirada hasta la tocada y se asienta (lo del video de iOS 26).
     */
    const travel = (from: number, to: number) => {
      if (reducedMotion.matches || from < 0 || to < 0 || from === to) return;
      const g = { left: 0, width: 0, height: 0, cell: 0, lensWidth: 0 };
      measure(g);
      clearTimers();
      capsule.removeAttribute("data-lens");
      capsule.removeAttribute("data-travel");
      paint(g, from * g.cell + g.cell / 2);
      // Fuerza el estilo inicial (sin rAF: con rAF Safari a veces junta los dos
      // pasos). Por `reflow()` y no `void lens.offsetWidth`: el React Compiler borra
      // esa lectura y la lupa viajaba desde el destino.
      reflow(lens);
      capsule.setAttribute("data-lens", "tap");
      capsule.setAttribute("data-travel", "");
      paint(g, to * g.cell + g.cell / 2);
      travelTimer = window.setTimeout(() => {
        capsule.removeAttribute("data-travel");
        capsule.setAttribute("data-lens", "settle");
        settleTimer = window.setTimeout(() => capsule.removeAttribute("data-lens"), SETTLE_MS);
      }, TAP_TRAVEL_MS);
    };

    const onMove = (e: PointerEvent) => {
      const g = gesture;
      if (!g || e.pointerId !== g.id) return;
      const now = performance.now();
      const dt = Math.max(1, now - g.t);
      g.v = g.v * 0.6 + ((e.clientX - g.x) / dt) * 0.4;
      g.t = now;
      g.x = e.clientX;
      if (!g.dragging) {
        if (Math.abs(g.x - g.x0) >= DRAG_THRESHOLD_PX) startDrag(g);
        return;
      }
      if (!frame) frame = requestAnimationFrame(onFrame);
    };

    const onUp = (e: PointerEvent) => {
      const g = gesture;
      if (!g || e.pointerId !== g.id) return;
      g.x = e.clientX;
      if (g.dragging) {
        endDrag(g, true);
        return;
      }
      gesture = null;
      removeListeners();
    };

    const onCancel = (e: PointerEvent) => {
      const g = gesture;
      if (!g || e.pointerId !== g.id) return;
      if (g.dragging) {
        endDrag(g, false);
        return;
      }
      gesture = null;
      removeListeners();
      live.current.onCancel();
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      // Un segundo dedo (la palma, un pellizco): se anula todo, sin ir a ningún lado.
      if (gesture && e.pointerId !== gesture.id) {
        const g = gesture;
        if (g.dragging) endDrag(g, false);
        else {
          gesture = null;
          removeListeners();
          live.current.onCancel();
        }
        noClickUntil = performance.now() + 2_000;
        return;
      }
      if (!e.isPrimary || gesture) return;
      noClickUntil = 0;
      gesture = {
        id: e.pointerId,
        x0: e.clientX,
        x: e.clientX,
        v: 0,
        t: performance.now(),
        dragging: false,
        left: 0,
        width: 0,
        height: 0,
        cell: 0,
        lensWidth: 0,
        lastCell: -1,
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };

    // La captura se puede perder sin `pointerup` (la página escondida, un diálogo del sistema).
    const onLostCapture = (e: PointerEvent) => {
      const g = gesture;
      if (e.target === capsule && g?.dragging && e.pointerId === g.id) endDrag(g, false);
    };

    // Al soltar después de arrastrar, el navegador manda el click al link donde
    // empezó el dedo: ese no cuenta (ya se fue a la pestaña de la lupa).
    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() < noClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Android: mantener apretado un link abre «Abrir en otra pestaña…».
    const noMenu = (e: Event) => e.preventDefault();

    // El viaje al tocar lo pide el render (cambió la pestaña mostrada por un toque).
    const onTravel = (e: Event) => {
      const d = (e as CustomEvent<{ from: number; to: number }>).detail;
      travel(d.from, d.to);
    };

    capsule.addEventListener("pointerdown", onDown);
    capsule.addEventListener("lostpointercapture", onLostCapture);
    capsule.addEventListener("click", onClickCapture, true);
    capsule.addEventListener("contextmenu", noMenu);
    capsule.addEventListener("lg:travel", onTravel);
    return () => {
      capsule.removeEventListener("pointerdown", onDown);
      capsule.removeEventListener("lostpointercapture", onLostCapture);
      capsule.removeEventListener("click", onClickCapture, true);
      capsule.removeEventListener("contextmenu", noMenu);
      capsule.removeEventListener("lg:travel", onTravel);
      removeListeners();
      if (frame) cancelAnimationFrame(frame);
      clearTimers();
      capsule.removeAttribute("data-lens");
      capsule.removeAttribute("data-travel");
    };
  }, []);

  /** Un toque en una pestaña (el click del link). */
  const onTabClick = React.useCallback(
    (e: React.MouseEvent<HTMLElement>, tab: MobileTab, i: number) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const from = live.current.shownIndex;
      if (from !== i && performance.now() - lastChangePerf.current >= GUARD_MS) {
        capsuleRef.current?.dispatchEvent(new CustomEvent("lg:travel", { detail: { from, to: i } }));
      }
      activate(tab);
    },
    [activate],
  );

  const cellWidth = `calc(100% / ${n})`;

  return (
    <>
      <LensFilter feRef={mapRef} />
      <nav
        ref={capsuleRef}
        aria-label="Secciones"
        className="lg-surface lg-bar-capsule min-w-0 flex-1"
      >
        {/* La pastilla de la pestaña elegida: se desliza de una a otra. */}
        <span
          aria-hidden
          className="lg-bar-slot"
          data-off={index < 0 ? "" : undefined}
          style={{ width: cellWidth, transform: `translate3d(${Math.max(0, index) * 100}%,0,0)` }}
        >
          <span className="lg-bar-pill" />
        </span>

        <ul ref={rowRef} className="relative z-[1] flex h-full">
          {tabs.map((tab, i) => {
            const current = tab.id === activeTab;
            const isMore = tab.id === "mas";
            const face = <TabFace tab={tab} highlighted={tab.id === shown} badge={badges?.[tab.id]} />;
            const common =
              "flex h-full w-full rounded-full outline-none select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:[&_[data-ind]]:scale-[0.88]";
            return (
              <li key={tab.id} className="min-w-0 flex-1">
                {isMore ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={moreOpen}
                    onClick={(e) => onTabClick(e, tab, i)}
                    className={common}
                  >
                    {face}
                  </button>
                ) : (
                  <Link
                    href={tab.href}
                    scroll={false}
                    draggable={false}
                    aria-current={current ? "page" : undefined}
                    onClick={(e) => onTabClick(e, tab, i)}
                    className={common}
                  >
                    {face}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        {/* La lupa: sólo se ve mientras se arrastra o viaja. Adentro, una copia
            de la barra (cápsula y fila), agrandada y alineada con la de verdad. */}
        <span ref={lensRef} aria-hidden className="lg-bar-lenspos" style={{ width: cellWidth }}>
          <span className="lg-bar-lens">
            <span className="lg-bar-optics">
              <span ref={copyRef} className="lg-bar-lenscopy">
                <span className="lg-bar-lenscap" />
                {tabs.map((tab) => (
                  <span key={tab.id} className="min-w-0 flex-1">
                    <TabFace tab={tab} highlighted badge={badges?.[tab.id]} copy />
                  </span>
                ))}
              </span>
            </span>
          </span>
        </span>
      </nav>
    </>
  );
}

/**
 * El filtro de la lente: tres corrimientos del mismo mapa (uno por canal, con
 * `scale` distinto: los flecos de color) y la mezcla. Los canales se suman a
 * un tercio y se vuelven a multiplicar por tres, así el alfa queda el promedio
 * de los tres (con `screen` un borde suave salía opaco). Sin `x/y/width/height`
 * en el `feImage`: ver `src/lib/ui/lens.ts`.
 */
function LensFilter({ feRef }: { feRef: React.Ref<SVGFEImageElement> }) {
  const { r, g, b } = lensChannelScales();
  return (
    <svg aria-hidden focusable="false" width="0" height="0" className="pointer-events-none absolute size-0 overflow-hidden">
      <filter id="lg-lens" x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
        <feImage ref={feRef} preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale={r} xChannelSelector="R" yChannelSelector="G" result="dr" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale={g} xChannelSelector="R" yChannelSelector="G" result="dg" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale={b} xChannelSelector="R" yChannelSelector="G" result="db" />
        <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cr" />
        <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cg" />
        <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cb" />
        <feComposite in="cr" in2="cg" operator="arithmetic" k2="0.3333" k3="0.3333" result="crg" />
        <feComposite in="crg" in2="cb" operator="arithmetic" k2="1" k3="0.3333" result="crgb" />
        <feColorMatrix in="crgb" type="matrix" values="3 0 0 0 0  0 3 0 0 0  0 0 3 0 0  0 0 0 1 0" />
      </filter>
    </svg>
  );
}

/** Ícono y nombre de una pestaña (también la copia que se ve en la lupa). */
function TabFace({
  tab,
  highlighted,
  badge,
  copy = false,
}: {
  tab: MobileTab;
  highlighted: boolean;
  badge?: number;
  copy?: boolean;
}) {
  const Icon = SCREEN_ICONS[tab.icon];
  return (
    <span
      className={cn(
        "flex h-full w-full min-w-0 flex-col items-center justify-center gap-[3px]",
        highlighted ? "text-(--lgbar-active)" : "text-(--lgbar-ink)",
      )}
    >
      <span data-ind className="relative grid size-6 place-items-center transition-transform duration-150">
        <Icon className="size-[23px]" strokeWidth={highlighted ? 2.35 : 1.9} />
        {badge ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-[#e5533d] px-1 text-[10px] font-bold leading-none text-white tabular-nums ring-2 ring-white dark:ring-[#1c211e]"
          >
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "max-w-full truncate text-[11px] leading-[14px] min-[375px]:text-[12px]",
          highlighted ? "font-semibold" : "font-medium",
        )}
      >
        {tab.label}
        {badge && !copy ? <span className="sr-only">, {badge} sin ver</span> : null}
      </span>
    </span>
  );
}
