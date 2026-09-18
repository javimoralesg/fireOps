import type { Metadata, Viewport } from "next";

// Layout anidado de la pantalla móvil (poc-07, subagente B): solo ajusta el
// viewport para móvil (sin zoom y con el notch cubierto) y el título. La
// cabecera de la consola no se monta aquí: el móvil va a pantalla completa.

export const metadata: Metadata = {
  title: { absolute: "Atalaya · Periférico" },
  description: "Convierte tu móvil en un periférico del centro de mando: cámara, voz, publicaciones y posición en tiempo real.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function LayoutPeriferico({ children }: LayoutProps<"/periferico">) {
  return <div className="flex min-h-[100dvh] flex-col">{children}</div>;
}
