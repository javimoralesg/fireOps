import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

// Tipografía de marca Atalaya v2: Manrope (humanista, redondeada, muy legible en
// paneles densos; una sola familia para texto y titulares, cambia el peso) y
// JetBrains Mono para cifras, ids y horas (tabular).
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Atalaya · Mando de crisis con IA supervisada",
    template: "%s · Atalaya",
  },
  description:
    "Atalaya es la plataforma de mando de crisis para ayuntamientos y servicios de emergencia: la IA propone decisiones con datos reales, el responsable aprueba o corrige y el sistema ejecuta y aprende.",
  applicationName: "Atalaya",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1319" },
  ],
  colorScheme: "light dark",
};

// Aplica el tema guardado antes del primer pintado para que no haya parpadeo.
// El tema claro es el de marca; el oscuro solo si el usuario lo eligió
// (components/marca/SelectorTema.tsx guarda "atalaya.tema") o si la URL
// lleva ?tema=dark|light (enlaces de demo), que además se guarda.
const SCRIPT_TEMA = `try{var q=new URLSearchParams(location.search).get("tema");var t=q==="dark"||q==="light"?q:localStorage.getItem("atalaya.tema");if(q)localStorage.setItem("atalaya.tema",t);if(t==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${manrope.variable} ${jetbrains.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="h-full min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
