import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { puede, ROLES_LISTA, type DefinicionRol } from "@/lib/roles";

export function AccesoDenegado({ definicion }: { definicion: DefinicionRol }) {
  const conPermiso = ROLES_LISTA.filter((r) => puede(r.id, "interrogar_ia"));
  const conTrazas = new Set(ROLES_LISTA.filter((r) => puede(r.id, "ver_trazas_ia")).map((r) => r.id));
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="superficie w-full max-w-xl rounded-xl border border-panel-border bg-panel p-6 sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-xl border border-warning/40 bg-warning/10 text-warning">
          <ShieldAlert className="size-5" />
        </span>
        <h1 className="mt-4 text-[20px] font-semibold text-foreground">Tu perfil no puede interrogar a la IA</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Has entrado como <span className="text-foreground">{definicion.nombre}</span>. La supervisión de los agentes (Reglamento UE 2024/1689, art. 14)
          está reservada a los perfiles con permiso <span className="font-mono text-foreground">interrogar_ia</span>.
        </p>
        <p className="etiqueta mt-6">Perfiles con acceso</p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {conPermiso.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg border border-panel-border bg-panel-2/50 px-2.5 py-1.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-panel-border-strong font-mono text-[10px] font-semibold text-foreground">
                {r.iniciales}
              </span>
              <span className="min-w-0 truncate text-[12.5px] text-foreground">{r.nombre}</span>
              {conTrazas.has(r.id) && <span className="ml-auto shrink-0 text-[10px] text-accent">+ trazas</span>}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/acceso"
            className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-background transition hover:bg-brand-2 hover:text-foreground"
          >
            Cambiar perfil
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-panel-border-strong px-3.5 py-2 text-[13px] text-muted transition hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Volver a la consola
          </Link>
        </div>
      </div>
    </div>
  );
}
