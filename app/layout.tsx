// Raíz de la aplicación: idioma, metadatos, tema y proveedor de avisos (toasts).
// DUEÑO: constructor E. Sin dependencias externas.
//
// El guion del tema aplica el tema guardado ANTES del primer pintado para que no
// haya un fogonazo blanco al recargar en oscuro. Va con next/script y
// `strategy="beforeInteractive"` (Next 16, node_modules/next/dist/docs/01-app/
// 03-api-reference/02-components/script.md): Next lo inyecta en el <head> del
// HTML inicial y React ya no avisa de "Encountered a script tag while rendering
// React component". Un <script> escrito a mano dentro del árbol de React sí lo
// provoca y, además, nunca se ejecuta al renderizar en cliente.

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";
import { ProveedorToast } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Atalaya · Sala de mando",
  description:
    "Sala de mando de Atalaya Incendios: agentes que detectan, deciden y actúan sobre incendios forestales, con supervisión humana.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1319" },
  ],
};

/** Se ejecuta antes de pintar: lee el tema guardado y lo pone en <html>. */
const GUION_TEMA = `
try {
  var t = localStorage.getItem("atalaya:tema");
  if (t === "claro") document.documentElement.setAttribute("data-theme", "light");
  else if (t === "oscuro") document.documentElement.setAttribute("data-theme", "dark");
} catch (e) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full antialiased">
        {/* `id` es obligatorio en los guiones en línea para que Next los siga. */}
        <Script id="atalaya-tema" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: GUION_TEMA }} />
        <ProveedorToast>{children}</ProveedorToast>
      </body>
    </html>
  );
}
