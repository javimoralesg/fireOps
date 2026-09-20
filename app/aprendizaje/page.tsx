// Página /aprendizaje — ejecuciones, métricas y lecciones. DUEÑO: constructor C.
import type { Metadata } from "next";
import { PaginaAprendizaje } from "@/components/aprendizaje/PaginaAprendizaje";

export const metadata: Metadata = {
  title: "Aprendizaje · Atalaya",
  description: "Qué ha aprendido el sistema de lo que el mando corrigió y de lo que no funcionó.",
};

export const dynamic = "force-dynamic";

export default function Pagina() {
  return <PaginaAprendizaje />;
}
