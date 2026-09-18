import type { Metadata } from "next";
import { VistaPolitica } from "@/components/politica/VistaPolitica";

export const metadata: Metadata = {
  title: "Política de autonomía de la IA · Atalaya",
  description: "Qué actuaciones gestiona la IA sola, cuáles propone para que las firme una persona y cuáles quedan reservadas a personas.",
};

export default function PaginaPolitica() {
  return <VistaPolitica />;
}
