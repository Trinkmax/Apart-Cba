"use client";

import { useSyncExternalStore } from "react";
import { MonitorDown, Smartphone } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Platform = "ios" | "mac-safari" | "android" | "desktop-chromium" | "other";

/**
 * Sólo para elegir qué instrucción mostrar primero: si le erramos, abajo
 * están todas. Devuelve un string (estable entre llamadas) para poder usarlo
 * como snapshot; en el server no hay navigator → "other".
 */
function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // iPadOS se presenta como Mac; lo delata el touch.
  const isIpadOs = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || isIpadOs) return "ios";
  if (/Android/i.test(ua)) return "android";
  const chromium = /Chrome|Chromium|Edg/i.test(ua);
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua) && !chromium) return "mac-safari";
  if (chromium) return "desktop-chromium";
  return "other";
}

const STEPS: Record<Platform, { title: string; how: string; mobile: boolean }> = {
  ios: {
    title: "iPhone o iPad (Safari)",
    how: "Tocá Compartir (el cuadrado con la flecha) → Agregar a inicio.",
    mobile: true,
  },
  android: {
    title: "Android (Chrome)",
    how: "Menú ⋮ → Agregar a pantalla de inicio.",
    mobile: true,
  },
  "desktop-chromium": {
    title: "Chrome o Edge en la notebook",
    how: "Menú ⋮ → Guardar y compartir → Instalar página como app (o el ícono de instalar en la barra de direcciones).",
    mobile: false,
  },
  "mac-safari": {
    title: "Safari en Mac",
    how: "Archivo → Agregar al Dock.",
    mobile: false,
  },
  other: {
    title: "Otro navegador",
    how: "Buscá «Instalar app» o «Agregar a pantalla de inicio» en el menú del navegador.",
    mobile: false,
  },
};

const ORDER: Platform[] = ["ios", "android", "desktop-chromium", "mac-safari"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const noSubscribe = () => () => {};
const serverPlatform = (): Platform => "other";

/**
 * Instrucciones a mano para instalar la app cuando el navegador no da prompt
 * nativo (iOS y Safari nunca lo dan; Chrome sólo cuando la página califica).
 * Queda un ícono en inicio / Dock: abre directo en /login y de ahí cada rol
 * cae en su casa.
 */
export function InstallAppDialog({ open, onOpenChange }: Props) {
  // El user agent no cambia: se lee una vez, sin efecto ni estado, y el
  // snapshot de server evita el mismatch de hidratación.
  const platform = useSyncExternalStore(noSubscribe, detectPlatform, serverPlatform);

  const detected = STEPS[platform];
  const Icon = detected.mobile ? Smartphone : MonitorDown;
  const others = ORDER.filter((p) => p !== platform);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Instalar la app en este dispositivo</DialogTitle>
          <DialogDescription>
            Te queda un ícono como cualquier otra app: abre directo, sin buscar
            la dirección ni volver a escribir el usuario.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border bg-primary/5 border-primary/20 p-4">
            <Icon className="size-5 shrink-0 mt-0.5 text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{detected.title}</p>
              <p className="text-sm leading-relaxed">{detected.how}</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">En otros dispositivos</p>
            <ul className="space-y-1.5">
              {others.map((p) => (
                <li key={p} className="text-xs leading-relaxed">
                  <span className="font-medium">{STEPS[p].title}:</span>{" "}
                  <span className="text-muted-foreground">{STEPS[p].how}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
