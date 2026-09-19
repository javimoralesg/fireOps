// Página /conocimiento — documentos, grafo y buscador de protocolos. DUEÑO: constructor C.
import type { Metadata } from "next";
import { PaginaConocimiento } from "@/components/conocimiento/PaginaConocimiento";

export const metadata: Metadata = {
  title: "Conocimiento · Atalaya",
  description: "Normativa y protocolos con los que los agentes fundamentan cada decisión.",
};

export const dynamic = "force-dynamic";

export default function Pagina() {
  return <PaginaConocimiento />;
}
