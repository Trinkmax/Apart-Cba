/**
 * E2E de Canales de venta — flujos críticos.
 *
 * Usa un usuario staff TEMPORAL en la org demo "rentOS Test" (creado en
 * beforeAll vía Auth Admin API y borrado en afterAll junto con todo lo que el
 * test genera). No toca la org real de Apart CBA.
 */
import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import path from "path";

const DEMO_ORG_ID = "eb8be683-fb43-41ef-a61d-4b05bc63ce1c"; // rentOS Test
const TEST_EMAIL = `zz-canales-e2e-${Date.now()}@example.com`;
const TEST_PASSWORD = "Zz-canales-e2e-1!";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let auth: SupabaseClient<any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: SupabaseClient<any, any, any>;
let userId = "";
let issueId = "";

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

test.beforeAll(async () => {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  auth = createClient(url, key, { auth: { persistSession: false } });
  admin = createClient(url, key, {
    db: { schema: "apartcba" },
    auth: { persistSession: false },
  });

  const { data: created, error } = await auth.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  userId = created.user!.id;

  await admin.from("user_profiles").upsert({ user_id: userId, full_name: "ZZ Canales E2E" });
  const { error: memberErr } = await admin.from("organization_members").insert({
    organization_id: DEMO_ORG_ID,
    user_id: userId,
    role: "admin",
  });
  if (memberErr) throw new Error(`membership: ${memberErr.message}`);

  // incidencia sembrada para el flujo de resolución
  const { data: issue } = await admin
    .from("channel_issues")
    .insert({
      organization_id: DEMO_ORG_ID,
      issue_type: "parse_error",
      severity: "warning",
      status: "open",
      title: "Incidencia E2E de prueba",
      detail: "Sembrada por el test — se descarta durante el flujo.",
      dedupe_key: `e2e:${Date.now()}`,
    })
    .select("id")
    .single();
  issueId = issue!.id;
});

test.afterAll(async () => {
  if (!admin) return;
  // todo lo que el test pudo crear en la org demo
  await admin.from("channel_issues").delete().eq("organization_id", DEMO_ORG_ID).like("title", "%E2E%");
  await admin.from("channel_links").delete().eq("organization_id", DEMO_ORG_ID);
  await admin.from("channel_settings").delete().eq("organization_id", DEMO_ORG_ID);
  if (userId) {
    await admin.from("organization_members").delete().eq("user_id", userId);
    await admin.from("user_profiles").delete().eq("user_id", userId);
    await auth.auth.admin.deleteUser(userId);
  }
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Contraseña").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /iniciar|entrar|ingresar/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}

test("ver Canales de venta: estados, email y redirección legacy", async ({ page }) => {
  await login(page);

  await page.goto("/dashboard/canales");
  await expect(page.getByRole("heading", { name: "Canales de venta" })).toBeVisible();
  // honestidad sobre iCal
  await expect(page.getByText(/demora final de actualización depende/i)).toBeVisible();
  // sin conexiones en la org demo → estado vacío accionable
  await expect(page.getByText("Todavía no hay departamentos conectados")).toBeVisible();
  // configuración de email por organización visible
  await expect(page.getByText("Datos del huésped por email")).toBeVisible();
  // incidencia sembrada visible en el panel "Para resolver"
  await expect(page.getByText("Incidencia E2E de prueba")).toBeVisible();

  // rutas legacy redirigen
  await page.goto("/dashboard/channel-manager");
  await page.waitForURL(/\/dashboard\/canales/);
  await page.goto("/dashboard/configuracion/inbound-email");
  await page.waitForURL(/\/dashboard\/canales/);
});

test("conectar una unidad: asistente crea el checklist por unidad", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/canales/conectar");

  await expect(page.getByText("¿Con qué canal querés conectar?")).toBeVisible();
  await page.getByRole("button", { name: /Airbnb/ }).first().click();

  await expect(page.getByText(/Elegí los departamentos/)).toBeVisible();
  // seleccionar la primera unidad de la lista
  await page.locator('label:has([role="checkbox"])').first().click();
  await page.getByRole("button", { name: /Crear checklist \(1\)/ }).click();

  // checklist por unidad con pasos A y B
  await expect(page.getByText(/Checklist por departamento/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Pegá el enlace del calendario del anuncio/)).toBeVisible();
  await expect(page.getByText(/Cargá nuestro calendario dentro de la OTA/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Activar conexión" })).toBeDisabled();
});

test("filtrar y buscar conexiones en la matriz", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/canales");

  // el borrador creado en el test anterior aparece en la tabla
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Borrador").first()).toBeVisible();

  // filtro por estado
  await page.getByLabel("Filtrar por estado").click();
  await page.getByRole("option", { name: "Borradores" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);

  // búsqueda que no matchea → vacío con mensaje
  await page.getByLabel("Buscar departamento").fill("zzz-inexistente");
  await expect(page.getByText(/Ninguna conexión coincide/)).toBeVisible();
});

test("resolver una incidencia: descartar con motivo queda auditado", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/canales");

  const issueRow = page.locator("li", { hasText: "Incidencia E2E de prueba" });
  await expect(issueRow).toBeVisible();
  await issueRow.getByRole("button", { name: "Descartar incidencia" }).click();
  await page.getByPlaceholder(/Motivo/).fill("Prueba E2E — falso positivo");
  await page.getByRole("button", { name: "Descartar", exact: true }).click();

  await expect(page.getByText("Incidencia descartada")).toBeVisible();
  // desaparece del panel
  await expect(page.getByText("Incidencia E2E de prueba")).toHaveCount(0, { timeout: 15_000 });

  // auditoría en la base
  const { data } = await admin
    .from("channel_issues")
    .select("status, resolution, resolved_by")
    .eq("id", issueId)
    .single();
  expect(data!.status).toBe("dismissed");
  expect(data!.resolution).toContain("falso positivo");
  expect(data!.resolved_by).toBe(userId);
});

test("navegación por teclado y responsive básico", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/canales");
  await expect(page.getByRole("heading", { name: "Canales de venta" })).toBeVisible();

  // teclado: Tab recorre controles enfocables hasta llegar al CTA principal
  let reachedCta = false;
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    if (focused.includes("Conectar departamento")) {
      reachedCta = true;
      break;
    }
  }
  expect(reachedCta).toBe(true);

  // tablet: sin scroll horizontal en el body
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto("/dashboard/canales");
  await expect(page.getByRole("heading", { name: "Canales de venta" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
