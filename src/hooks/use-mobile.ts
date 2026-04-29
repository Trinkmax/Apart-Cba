import * as React from "react"

const MOBILE_BREAKPOINT = 768

// useSyncExternalStore es la API idiomática de React para subscribirse a un
// store externo (en este caso, matchMedia). Evita setState en useEffect y
// además ofrece un getServerSnapshot estable para SSR (false por defecto).
function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {}
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot(): boolean {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
