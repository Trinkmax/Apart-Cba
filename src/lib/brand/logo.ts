/**
 * Cómo se muestra el logo que subió cada organización.
 *
 * El sidebar pinta los logos transparentes como silueta del color del texto
 * (negro en claro, blanco en oscuro): así el PNG blanco de Apart CBA, pensado
 * para fondo oscuro, no queda invisible en modo claro. Pero un JPG no tiene
 * transparencia: la silueta pintaba el rectángulo entero y Habitana y
 * Viaggiato veían un bloque negro (blanco en oscuro) en lugar de su logo.
 * Esos van en sus colores, sobre un fondo blanco como el de un ícono de app.
 */
export function isOpaqueLogo(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[?#]/)[0] ?? "";
  return /\.(jpe?g|jfif|bmp)$/i.test(path);
}
