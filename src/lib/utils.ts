import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * ¿El evento "afuera" de un Dialog/Sheet vino de un toast? Radix trata el clic
 * en un toast como un clic fuera del modal y lo cierra: tocar «Deshacer» o
 * «Recargar» se llevaba puesto el formulario. Los Content lo ignoran con esto.
 */
export function isToastEvent(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && target.closest("[data-sonner-toaster]") !== null;
}
