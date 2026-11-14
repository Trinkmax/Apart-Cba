/**
 * ¿Es este enlace el calendario de SALIDA de rentOS —el que se pega en la OTA—
 * en vez del de ENTRADA, el que da la OTA?
 *
 * Los dos son una URL de .ics y se copian del mismo diálogo, así que se
 * confunden. Viaggiato, 09/11/2026: el calendario entrante de VillaSol en
 * Airbnb quedó con el propio enlace de exportación de rentOS. Desde ese momento
 * cada lectura falló ("Redirect sin destino") y, aunque hubiera respondido, el
 * guard contra la auto-importación descarta nuestros propios eventos: ninguna
 * reserva de Airbnb de esa unidad entraba al calendario, con riesgo de venta
 * doble. Era la única conexión así entre todas las orgs.
 *
 * Exige el host propio Y la forma exacta de nuestras rutas de exportación
 * (/api/channels/ical/<id>.ics y la legacy /api/ical/<id>.ics): un .ics de otro
 * sistema con un path parecido no tiene por qué rechazarse.
 */
const OWN_EXPORT_PATH = /^\/api\/(?:channels\/)?ical\/[^/]+\.ics$/i;
const OWN_HOSTS = ["apartcba.com"];

export function isOwnExportFeedUrl(rawUrl: string, appUrl?: string | null): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (!OWN_EXPORT_PATH.test(url.pathname)) return false;

  const own = new Set(OWN_HOSTS);
  if (appUrl) {
    try {
      own.add(bareHost(new URL(appUrl).hostname));
    } catch {
      // NEXT_PUBLIC_APP_URL mal formada: quedan los hosts conocidos.
    }
  }
  return own.has(bareHost(url.hostname));
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}
