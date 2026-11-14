/**
 * Nivel de «vidrio» del celular (nov-2026): cuánto desenfoque se le puede
 * pedir a este teléfono sin que salte. Lo lee `src/app/styles/glass.css`.
 * Portado de sharp-app (`src/lib/ui/vidrio.ts`).
 *
 * - "" (completo): iPhone, compu y Android con memoria de sobra.
 * - "bar": Android de memoria media (≤ 4 GB). Desenfoque sólo en lo chico: la
 *   barra de pestañas mide 360×62 y se banca; una hoja de pantalla entera no.
 * - "lite": poca memoria (≤ 2 GB), Android de 4 núcleos o menos, o un navegador
 *   sin `backdrop-filter`. Mismas formas y brillos, sin desenfoque ni lente.
 *
 * `navigator.deviceMemory` sólo existe en Chromium (Chrome, Samsung, Edge): en
 * el iPhone no está y el iPhone desenfoca bien. "Reducir transparencia" lo
 * resuelve el CSS con su media query.
 */
export type GlassLevel = "" | "bar" | "lite";

export function glassLevel(d: {
  userAgent: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  supportsBackdrop: boolean;
}): GlassLevel {
  const android = /Android/i.test(d.userAgent);
  if (!d.supportsBackdrop) return "lite";
  if (d.deviceMemory !== undefined && d.deviceMemory <= 2) return "lite";
  if (android && d.hardwareConcurrency !== undefined && d.hardwareConcurrency <= 4) return "lite";
  if (android && d.deviceMemory !== undefined && d.deviceMemory <= 4) return "bar";
  return "";
}

/**
 * Lo mismo, como script para el <head> del layout raíz: corre antes de pintar
 * y deja `html[data-glass]`. Tiene que decidir igual que `glassLevel` (lo
 * prueba `__tests__/glass-level.test.ts`).
 */
export const GLASS_LEVEL_SCRIPT = `(function(){try{var n=navigator,w=window,s=!!(w.CSS&&CSS.supports&&(CSS.supports('backdrop-filter','blur(1px)')||CSS.supports('-webkit-backdrop-filter','blur(1px)'))),a=/Android/i.test(n.userAgent||''),m=n.deviceMemory,c=n.hardwareConcurrency,v='';if(!s)v='lite';else if(m!==undefined&&m<=2)v='lite';else if(a&&c!==undefined&&c<=4)v='lite';else if(a&&m!==undefined&&m<=4)v='bar';if(v)document.documentElement.setAttribute('data-glass',v);}catch(e){}})();`;
