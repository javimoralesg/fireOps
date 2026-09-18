import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Supervisión de la IA",
  description: "Interroga a los agentes de Atalaya y audita sus trazas: evidencia, doctrina, modelo y supervisión humana (Reglamento UE 2024/1689, art. 14).",
};

export default function LayoutAuditoria({ children }: { children: React.ReactNode }) {
  return children;
}
