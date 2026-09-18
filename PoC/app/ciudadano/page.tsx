import type { Metadata } from "next";
import { PortalCiudadano } from "@/components/ciudadano/PortalCiudadano";

export const metadata: Metadata = {
  title: "Información ciudadana",
  description: "Avisos oficiales, qué hacer ahora, calidad del aire y bulos desmentidos durante una emergencia, en tiempo real.",
};

export default function PaginaCiudadano() {
  return <PortalCiudadano />;
}
