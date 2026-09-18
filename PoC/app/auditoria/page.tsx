import { Suspense } from "react";
import { VistaAuditoria } from "@/components/auditoria/VistaAuditoria";

// VistaAuditoria lee ?decision= con useSearchParams: necesita un límite de Suspense.
export default function PaginaAuditoria() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-muted">Cargando supervisión de la IA…</div>}>
      <VistaAuditoria />
    </Suspense>
  );
}
