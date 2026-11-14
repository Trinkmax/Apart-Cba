import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { isPathAllowedForOwner } from "@/lib/auth/route-access";
import type { UserRole } from "@/lib/types/database";
import {
  cleanPath,
  desktopNav,
  isAllowed,
  mobileTabs,
  moreGroups,
  profileHref,
  reachableScreens,
  routeMeta,
  type ShellContext,
} from "../routes";

const ROLES: UserRole[] = ["admin", "recepcion", "mantenimiento", "limpieza", "owner_view"];
const ctx = (role: UserRole, rentalsEnabled = true): ShellContext => ({ role, rentalsEnabled });

describe("pestañas por rol", () => {
  it("admin y recepción: Hoy · Reservas · Caja · Más", () => {
    for (const role of ["admin", "recepcion"] as const) {
      expect(mobileTabs(ctx(role)).map((t) => t.label)).toEqual(["Hoy", "Reservas", "Caja", "Más"]);
    }
  });

  it("limpieza y mantenimiento viven en /m", () => {
    expect(mobileTabs(ctx("limpieza")).map((t) => t.href)).toEqual(["/m", "/m/limpieza", "/m/parte-diario", "#mas"]);
    expect(mobileTabs(ctx("mantenimiento")).map((t) => t.href)).toEqual([
      "/m",
      "/m/mantenimiento",
      "/m/parte-diario",
      "#mas",
    ]);
  });

  it("propietario: Inicio · Calendario · Liquidaciones · Más", () => {
    expect(mobileTabs(ctx("owner_view")).map((t) => t.label)).toEqual(["Inicio", "Calendario", "Liquidaciones", "Más"]);
  });

  it("como mucho cuatro pestañas más «Más»: con el círculo de Tex entran a 375 pt", () => {
    for (const role of ROLES) expect(mobileTabs(ctx(role)).length).toBeLessThanOrEqual(4);
  });

  it("Tradicionales sólo aparece con el módulo encendido", () => {
    const rows = (on: boolean) => moreGroups(ctx("admin", on)).flatMap((g) => g.rows.map((r) => r.id));
    expect(rows(true)).toContain("tradicionales");
    expect(rows(false)).not.toContain("tradicionales");
  });
});

describe("ninguna puerta lleva a una pantalla que rebota al rol", () => {
  for (const role of ROLES) {
    it(role, () => {
      const c = ctx(role);
      const hrefs = [
        ...mobileTabs(c)
          .filter((t) => t.id !== "mas")
          .flatMap((t) => [t.href, ...t.subtabs.map((s) => s.href)]),
        ...moreGroups(c).flatMap((g) => g.rows.map((r) => r.href)),
        profileHref(role),
      ];
      for (const href of hrefs) {
        if (role === "owner_view") expect(isPathAllowedForOwner(href), href).toBe(true);
        if (role === "limpieza" || role === "mantenimiento") expect(href.startsWith("/m"), href).toBe(true);
      }
      for (const s of reachableScreens(c)) {
        expect(isAllowed(s, c), s.href).toBe(true);
        if (s.resource && s.resource !== "*") expect(can(role, s.resource, "view"), s.href).toBe(true);
      }
    });
  }
});

describe("routeMeta", () => {
  const admin = ctx("admin");

  it("el inicio es Hoy · Resumen", () => {
    const m = routeMeta("/dashboard", admin);
    expect(m).toMatchObject({ tab: "hoy", subtab: "resumen", kind: "root" });
    expect(m.subtabs.map((s) => s.id)).toEqual(["resumen", "parte", "limpieza", "mantenimiento", "tareas"]);
  });

  it("Solicitudes no se confunde con Lista (prefijo sin barra)", () => {
    expect(routeMeta("/dashboard/reservas-pendientes", admin)).toMatchObject({ tab: "reservas", subtab: "solicitudes" });
    expect(routeMeta("/dashboard/reservas", admin)).toMatchObject({ tab: "reservas", subtab: "lista", kind: "root" });
  });

  it("el detalle de una reserva es una sub-pantalla de Lista, sin sub-pestañas", () => {
    const m = routeMeta("/dashboard/reservas/1b2c3d", admin);
    expect(m).toMatchObject({ tab: "reservas", kind: "sub", title: "Reserva" });
    expect(m.parent).toEqual({ href: "/dashboard/reservas", label: "Lista" });
    expect(m.subtabs).toEqual([]);
  });

  it("el calendario es de alto completo y el mensual es la misma pantalla", () => {
    expect(routeMeta("/dashboard/unidades/kanban", admin)).toMatchObject({
      tab: "reservas",
      subtab: "calendario",
      kind: "root",
      fullHeight: true,
    });
    expect(routeMeta("/dashboard/unidades/calendario/mensual", admin)).toMatchObject({
      tab: "reservas",
      subtab: "calendario",
      kind: "root",
      fullHeight: true,
    });
  });

  it("Unidades vive en «Más» y su ficha es una sub-pantalla", () => {
    expect(routeMeta("/dashboard/unidades", admin)).toMatchObject({ tab: "mas", kind: "root", title: "Unidades" });
    expect(routeMeta("/dashboard/unidades/abc/precios", admin)).toMatchObject({ tab: "mas", kind: "sub", title: "Precios" });
  });

  it("Caja, Resultados y Liquidaciones son la misma sección", () => {
    for (const [path, sub] of [
      ["/dashboard/caja", "caja"],
      ["/dashboard/resultados", "resultados"],
      ["/dashboard/liquidaciones", "liquidaciones"],
      ["/dashboard/propietarios", "propietarios"],
    ] as const) {
      expect(routeMeta(path, admin)).toMatchObject({ tab: "caja", subtab: sub, kind: "root" });
    }
    expect(routeMeta("/dashboard/caja/acc-1", admin)).toMatchObject({ tab: "caja", kind: "sub", title: "Cuenta" });
  });

  it("las pantallas de /m de un admin caen en su sección", () => {
    expect(routeMeta("/m/tareas", admin)).toMatchObject({ tab: "hoy", subtab: "tareas", kind: "sub" });
  });

  it("limpieza: su ticket o su tarea en /m", () => {
    const c = ctx("limpieza");
    expect(routeMeta("/m/limpieza", c)).toMatchObject({ tab: "limpieza", kind: "root" });
    expect(routeMeta("/m", c)).toMatchObject({ tab: "inicio", kind: "root" });
    expect(routeMeta("/m/perfil", c)).toMatchObject({ tab: "mas" });
  });

  it("una ruta que no está en el mapa no rompe", () => {
    expect(routeMeta("/dashboard/inventario", admin)).toMatchObject({ tab: null, kind: "sub" });
  });

  it("limpia query, hash y barra final", () => {
    expect(cleanPath("/dashboard/reservas/?q=1#x")).toBe("/dashboard/reservas");
    expect(cleanPath("/")).toBe("/");
  });
});

describe("navegación de la compu", () => {
  it("admin: las mismas 3 secciones y «Tu negocio», sin pantallas de /m", () => {
    const nav = desktopNav(ctx("admin"));
    expect(nav.sections.map((s) => s.label)).toEqual(["Hoy", "Reservas", "Caja"]);
    const rows = nav.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.id)).toEqual(["unidades", "tradicionales", "canales", "avisos", "configuracion"]);
    expect(rows.every((r) => !r.href.startsWith("/m"))).toBe(true);
  });
  it("limpieza sigue viendo lo suyo de /m", () => {
    const nav = desktopNav(ctx("limpieza"));
    expect(nav.sections.map((s) => s.href)).toEqual(["/m", "/m/limpieza", "/m/parte-diario"]);
    expect(nav.groups.flatMap((g) => g.rows.map((r) => r.href))).toEqual(["/m/consejos"]);
  });
  it("routeMeta dice a qué link pertenece cada pantalla", () => {
    expect(routeMeta("/dashboard/unidades/abc", ctx("admin")).link).toBe("unidades");
    expect(routeMeta("/dashboard/caja", ctx("admin")).link).toBe("caja");
  });
});
