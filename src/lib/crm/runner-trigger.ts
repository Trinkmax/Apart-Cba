/**
 * Helper para disparar el runner de workflows sin esperar respuesta.
 * Vive fuera de /workflows/ a propósito para evitar confusión con Vercel
 * Workflow DevKit (no usamos eso — engine es custom).
 */
export function triggerWorkflowRunner(): void {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const secret = process.env.PG_CRON_SECRET ?? "";
  fetch(`${baseUrl}/api/cron/from-pg?immediate=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pg-cron-secret": secret,
    },
    body: JSON.stringify({ source: "dispatcher", immediate: true }),
    cache: "no-store",
  }).catch(() => {
    // Best-effort. Si falla, el cron pg cada 5min lo agarra.
  });
}
