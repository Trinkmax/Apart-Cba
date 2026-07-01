"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es-AR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          backgroundColor: "#ffffff",
          color: "#171717",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: "420px", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              margin: "0 0 12px",
            }}
          >
            Algo salió mal
          </h1>
          <p style={{ color: "#525252", lineHeight: 1.6, margin: "0 0 24px" }}>
            Tuvimos un problema inesperado. Ya estamos al tanto. Probá de nuevo
            en un momento.
          </p>
          <button
            onClick={() => reset()}
            style={{
              display: "inline-block",
              borderRadius: "9999px",
              border: "none",
              backgroundColor: "#171717",
              color: "#ffffff",
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
