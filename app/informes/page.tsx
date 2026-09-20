// Página /informes — actas de auditoría de decisiones y acciones. DUEÑO: constructor C.
import type { Metadata } from "next";
import { PaginaInformes } from "@/components/informes/PaginaInformes";

export const metadata: Metadata = {
  title: "Informes · Atalaya",
  description: "Un acta por cada decisión y cada acción, con su huella SHA-256.",
};

export const dynamic = "force-dynamic";

export default function Pagina() {
  return <PaginaInformes />;
}
