import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "@/components/ui/sonner";
import { GLASS_LEVEL_SCRIPT } from "@/lib/ui/glass-level";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ApartCBA — Reservá tu próximo lugar",
  description:
    "Marketplace de alojamientos temporales en Argentina. Descubrí, compará y reservá departamentos, lofts y casas en segundos.",
  applicationName: "ApartCBA",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "ApartCBA",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.png",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
      { url: "/icons/icon-152.png", sizes: "152x152" },
      { url: "/icons/icon-167.png", sizes: "167x167" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0A" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Nivel de vidrio del celular (glass.css) ANTES de pintar: sin parpadeo
            en los Android que no se bancan el desenfoque. */}
        <script dangerouslySetInnerHTML={{ __html: GLASS_LEVEL_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster
            richColors
            position="bottom-right"
            // En el celular con la barra de vidrio, los avisos salen arriba de ella (mobile-shell.css).
            offset={{ bottom: "var(--toast-bottom, 24px)", right: "24px" }}
            mobileOffset={{ bottom: "var(--toast-bottom, 16px)" }}
            closeButton
            containerAriaLabel="Notificaciones"
            toastOptions={{
              closeButtonAriaLabel: "Cerrar aviso",
              style: {
                // La web pública define --toast-font (tipografía de la marca);
                // el panel no, y sigue con Geist.
                fontFamily: "var(--toast-font, var(--font-geist-sans))",
              },
            }}
          />
        </ThemeProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
