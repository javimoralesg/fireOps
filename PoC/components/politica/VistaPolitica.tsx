"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Repeat2, ShieldAlert } from "lucide-react";
import { Logo } from "@/components/marca/Logo";
import { api } from "@/lib/api-cliente";
import { catalogoEfectivo, resumenPolitica } from "@/lib/politica-autonomia";
import { puede, ROLES_LISTA } from "@/lib/roles";
import { useEstado, type Conexion } from "@/lib/useEstado";
import { useRol } from "@/lib/useRol";
import { ControlUmbral } from "./ControlUmbral";
import { DecisionesBajoPolitica } from "./DecisionesBajoPolitica";
import { HistorialPolitica } from "./HistorialPolitica";
import { MatrizCompetencias } from "./MatrizCompetencias";
import { MODO_UI } from "./ui";
import { usePolitica } from "./usePolitica";

/**
 * Superficie /politica: qué puede gestionar la IA sola, qué propone para que lo
 * firme una persona y qué queda reservado a personas, con el umbral de autonomía.
 * La ve todo rol con `ver_mando`; la edita solo quien tiene `fijar_umbral`.
 */
export function VistaPolitica() {
  const { rol, definicion } = useRol();
  const { estado, conexion, accion } = useEstado();
  const { politica, umbralServidor, cargando, error, sinBackend, guardando, ajustar, restablecer } = usePolitica();

  const editable = puede(rol, "fijar_umbral");
  const umbral = estado?.umbralAutonomia ?? umbralServidor ?? 20;
  const catalogo = useMemo(() => (politica ? catalogoEfectivo(politica) : []), [politica]);
  const resumen = useMemo(() => (politica ? resumenPolitica(politica, umbral) : null), [politica, umbral]);

  const cambiarUmbral = useCallback((u: number) => accion(() => api.config({ umbralAutonomia: u })), [accion]);

  const puedeVer = puede(rol, "ver_mando");

  return (
    <div className="flex min-h-screen flex-col">
      <BarraSuperior nombreRol={definicion.nombre} iniciales={definicion.iniciales} conexion={conexion} organismo={estado?.organismo?.nombre} />

      {!puedeVer ? (
        <SinAcceso nombreRol={definicion.nombre} />
      ) : (
        <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
          {/* Los tres modos, con recuento */}
          <section className="grid gap-3 md:grid-cols-3">
            {(Object.keys(MODO_UI) as (keyof typeof MODO_UI)[]).map((m) => {
              const M = MODO_UI[m];
              const Icono = M.icono;
              const n = resumen?.[m] ?? 0;
              return (
                <div key={m} className={`superficie rounded-2xl border bg-panel p-4 ${M.tinte}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`flex items-center gap-2 text-[13px] font-semibold ${M.color}`}>
                      <Icono className="size-4" aria-hidden /> {M.etiqueta}
                    </span>
                    <span className="font-mono text-lg font-semibold leading-none text-foreground">{n}</span>
                  </div>
                  <p className="mt-1 text-[12.5px] font-medium text-foreground">{M.titulo}</p>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted">
                    {M.descripcion}
                    {m === "autonoma" && resumen ? ` Con el umbral actual, ${resumen.bajoUmbral} de ${n} caen por debajo.` : ""}
                  </p>
                </div>
              );
            })}
          </section>

          {!editable && (
            <p className="flex items-center gap-2 rounded-xl border border-panel-border bg-panel-2 px-3 py-2 text-[12px] text-muted">
              <ShieldAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
              Estás viendo la política como <span className="text-foreground">{definicion.nombre}</span>. Solo{" "}
              {ROLES_LISTA.filter((r) => puede(r.id, "fijar_umbral"))
                .map((r) => r.nombre)
                .join(" y ")}{" "}
              puede modificarla.
            </p>
          )}
          {sinBackend && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning" role="alert">
              El servidor no responde: se muestra el catálogo por defecto y no se puede editar.
            </p>
          )}

          <ControlUmbral umbral={umbral} editable={editable && !sinBackend} catalogo={catalogo} onUmbral={cambiarUmbral} />

          {politica && (
            <MatrizCompetencias
              catalogo={catalogo}
              politica={politica}
              umbral={umbral}
              editable={editable && !sinBackend}
              guardando={guardando}
              error={error ? `${error.mensaje}${error.escalarA ? ` · Escalar a ${ROLES_LISTA.find((r) => r.id === error.escalarA)?.nombre ?? error.escalarA}` : ""}` : null}
              onAjustar={ajustar}
              onRestablecer={restablecer}
            />
          )}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
            {politica && <DecisionesBajoPolitica decisiones={estado?.decisiones ?? []} politica={politica} umbral={umbral} cargando={!estado || cargando} />}
            {politica && <HistorialPolitica politica={politica} />}
          </div>
        </main>
      )}
    </div>
  );
}

const CONEXION_UI: Record<Conexion, { texto: string; punto: string }> = {
  conectando: { texto: "Conectando", punto: "bg-subtle" },
  en_vivo: { texto: "En vivo", punto: "bg-success" },
  fixture: { texto: "Datos de demostración", punto: "bg-warning" },
};

function BarraSuperior({ nombreRol, iniciales, conexion, organismo }: { nombreRol: string; iniciales: string; conexion: Conexion; organismo?: string }) {
  const c = CONEXION_UI[conexion];
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-panel-border bg-panel/80 px-3 py-2.5 backdrop-blur sm:px-4">
      <Link href="/" aria-label="Atalaya, volver a la consola" className="shrink-0">
        <Logo descriptor={false} />
      </Link>
      <div className="hidden h-7 w-px bg-panel-border sm:block" />
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold leading-tight text-foreground">Política de autonomía de la IA</h1>
        <p className="truncate text-[11px] text-muted">{organismo ? `${organismo} · ` : ""}Qué gestiona la IA sola, qué firma una persona y qué queda reservado</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-md border border-panel-border px-2 py-1 text-[11px] text-muted md:flex">
          <span className={`size-1.5 rounded-full ${c.punto}`} /> {c.texto}
        </span>
        <Link href="/auditoria" className="rounded-md px-2 py-1 text-[12px] text-muted transition hover:bg-panel-2 hover:text-foreground">
          Supervisión
        </Link>
        <Link href="/" className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted transition hover:bg-panel-2 hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Volver a la consola
        </Link>
        <div className="flex items-center gap-2 rounded-lg border border-panel-border bg-panel-2/60 py-1 pl-1 pr-1">
          <span className="flex size-6 items-center justify-center rounded-md bg-accent/20 font-mono text-[10px] font-semibold text-accent">{iniciales}</span>
          <span className="max-w-[180px] truncate text-[12px] text-foreground">{nombreRol}</span>
          <Link href="/acceso" title="Cambiar perfil" className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-panel-border hover:text-foreground">
            <Repeat2 className="size-3.5" /> <span className="hidden xl:inline">Cambiar perfil</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function SinAcceso({ nombreRol }: { nombreRol: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="superficie w-full max-w-xl rounded-xl border border-panel-border bg-panel p-6 sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-xl border border-warning/40 bg-warning/10 text-warning">
          <ShieldAlert className="size-5" />
        </span>
        <h2 className="mt-4 text-[20px] font-semibold text-foreground">Esta política es interna del centro de mando</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Has entrado como <span className="text-foreground">{nombreRol}</span>. La ciudadanía ve las decisiones ya tomadas en el portal público; la política de autonomía la consultan los perfiles con acceso a la consola.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/acceso" className="boton boton-primario">
            Cambiar perfil
          </Link>
          <Link href="/ciudadano" className="boton boton-secundario">
            Ir al portal ciudadano
          </Link>
        </div>
      </div>
    </div>
  );
}
