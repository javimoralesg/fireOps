import type { Metadata } from "next";
import { CentroAgentes } from "@/components/agentes/CentroAgentes";

export const metadata: Metadata = {
  title: "Agentes · Atalaya",
  description: "Centro operativo y de auditoría de los agentes de Atalaya.",
};

export default function PaginaAgentes() {
  return <CentroAgentes />;
}
