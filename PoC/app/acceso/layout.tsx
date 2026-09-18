import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acceso",
};

export default function AccesoLayout({ children }: LayoutProps<"/acceso">) {
  return children;
}
