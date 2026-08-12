import { ImageResponse } from "next/og";

export const alt = "rentOS — El panel para administrar alquileres temporarios";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Preview social de la landing. No hay ninguna imagen OG en el repo y los logos
 * son PNG rasterizados, así que se compone acá con `ImageResponse` (viene con
 * Next, sin dependencias nuevas). Las barras de abajo repiten los colores de
 * estado del calendario, que es lo que hace reconocible al producto.
 */
export default function OpengraphImage() {
  const bars = [
    { color: "#10b981", width: 210 },
    { color: "#3b82f6", width: 150 },
    { color: "#06b6d4", width: 120 },
    { color: "#f59e0b", width: 90 },
    { color: "#7c3aed", width: 170 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fbfcfa",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: "#647560",
            }}
          />
          <div style={{ fontSize: 30, color: "#4f5d4c", letterSpacing: -0.5 }}>rentOS</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              color: "#232a22",
              lineHeight: 1.05,
              letterSpacing: -2.5,
              maxWidth: 860,
            }}
          >
            Tu operación entera, en una sola pantalla.
          </div>
          <div style={{ fontSize: 30, color: "#6b756a", maxWidth: 800, lineHeight: 1.35 }}>
            Calendario, canales de venta, limpieza, caja y liquidaciones a propietarios.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          {bars.map((b) => (
            <div
              key={b.color}
              style={{ width: b.width, height: 14, borderRadius: 7, background: b.color }}
            />
          ))}
        </div>
      </div>
    ),
    size
  );
}
