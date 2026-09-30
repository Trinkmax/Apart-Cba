import Link from "next/link";
import { getSiteContact } from "@/lib/marketplace/web-settings-server";

/**
 * El mail de contacto de los textos legales: el mail público que la
 * organización cargó en Configuración → Web y cobros (o, si no, el mail de
 * contacto de la organización). Nunca una casilla escrita a mano: la que
 * había (@apart-cba.com.ar) es un dominio sin correo y todo rebotaba.
 *
 * Server component: lee la configuración cacheada, sin cookies (las páginas
 * legales siguen siendo estáticas).
 */
export async function LegalContactEmail({ subject }: { subject?: string }) {
  const { publicEmail } = await getSiteContact();
  if (!publicEmail) return <Link href="/como-reservar">nuestros canales de contacto</Link>;
  const href = `mailto:${publicEmail}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  return <a href={href}>{publicEmail}</a>;
}
