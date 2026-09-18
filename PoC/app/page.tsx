"use client";

// Consola de mando simplificada (dueño: poc-3a, por encargo de Javi).
// Tres bloques y nada más a la vista:
//   1. La decisión que hay que tomar ahora (izquierda, grande).
//   2. La situación: mapa/grafo local + 4 datos de entorno en una frase.
//   3. Los últimos acontecimientos, en lenguaje llano.
// Historial, doctrina, informes y voluntarios viven en un cajón lateral.
// El estado llega en tiempo real por SSE (lib/useEstado.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ColaDecisiones } from "@/components/ColaDecisiones";
import { PanelDoctrina } from "@/components/PanelDoctrina";
import { PanelInformes } from "@/components/PanelInformes";
import { PanelVoluntarios } from "@/components/PanelVoluntarios";
import { VisorInforme } from "@/components/VisorInforme";
import { Acontecimientos } from "@/components/consola/Acontecimientos";
import { BarraSuperior, type Panel } from "@/components/consola/BarraSuperior";
import { DecisionAhora } from "@/components/consola/DecisionAhora";
import { PanelSecundario } from "@/components/consola/PanelSecundario";
import { Situacion } from "@/components/consola/Situacion";
import { usePolitica } from "@/components/politica/usePolitica";
import { PanelPerifericos } from "@/components/perifericos/PanelPerifericos";
import { PanelSimulador } from "@/components/simulador/PanelSimulador";
import { usePerifericos } from "@/lib/usePerifericos";
import type { RutaMapa } from "@/components/mapa/tipos";
import { api } from "@/lib/api-cliente";
import { puede } from "@/lib/permisos";
import { ROLES } from "@/lib/roles";
import { useRol } from "@/lib/useRol";
import type { Decision, Urgencia } from "@/lib/tipos-sistema";
import { useAhora, useEstado } from "@/lib/useEstado";

const ORDEN_URGENCIA: Record<Urgencia, number> = { critica: 0, alta: 1, media: 2, baja: 3 };

const TITULO_PANEL: Record<Panel, { titulo: string; descripcion: string }> = {
  decisiones: { titulo: "Todas las decisiones", descripcion: "Pendientes de firma e historial de lo ya resuelto." },
  doctrina: { titulo: "Doctrina aprendida", descripcion: "Reglas que la IA aplica porque tú (o alguien de tu equipo) corrigió una propuesta." },
  informes: { titulo: "Informes", descripcion: "Actas de decisión, partes de situación y cierre del incidente." },
  voluntarios: { titulo: "Voluntarios", descripcion: "Tareas de bajo riesgo que la IA propone ofrecer a la ciudadanía." },
  simulacion: { titulo: "Simulador de eventos", descripcion: "Inyecta avisos en el escenario para ver cómo responde la IA." },
  perifericos: { titulo: "Periféricos en campo", descripcion: "Móviles y cámaras emparejados que envían fotos, voz y posición al centro de mando." },
};

/** Lee `?decision=<id>` de la URL (enlaces "Ver decisión" de otras vistas). */
function decisionDeUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("decision");
  } catch {
    return null;
  }
}

/** Pestaña del cajón: el hook de periféricos (con su polling) solo vive mientras está abierta. */
function PestanaPerifericos({ incidente }: { incidente: { lat: number; lon: number } }) {
  const sala = usePerifericos();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelPerifericos
        perifericos={sala.perifericos}
        incidente={incidente}
        cargando={sala.estadoPerifericos.cargando}
        ausente={sala.estadoPerifericos.ausente}
        error={sala.estadoPerifericos.error}
        onEliminar={sala.eliminarPeriferico}
        onCambiarModo={sala.cambiarModo}
        className="min-h-0 flex-1"
      />
      <p className="shrink-0 border-t border-panel-border px-4 py-2 text-xs text-muted">
        Sala completa (cámaras, publicaciones, emparejar móvil):{" "}
        <a href="/perifericos" className="font-medium text-brand hover:underline">
          /perifericos
        </a>
      </p>
    </div>
  );
}

export default function Consola() {
  const { estado, conexion, desfaseMs, accion, refrescar } = useEstado();
  const ahora = useAhora(desfaseMs);
  const { rol } = useRol();
  const { politica } = usePolitica();
  const router = useRouter();
  const veMando = puede(rol, "ver_mando");

  useEffect(() => {
    if (!veMando) router.replace(ROLES[rol].vistaInicial);
  }, [veMando, rol, router]);

  const [seleccionId, setSeleccionId] = useState<string | null>(decisionDeUrl);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [informeAbiertoId, setInformeAbiertoId] = useState<string | null>(null);

  const decisiones = useMemo(() => estado?.decisiones ?? [], [estado]);
  const pendientes = useMemo(
    () =>
      decisiones
        .filter((d) => d.estado === "pendiente")
        .sort((a, b) => ORDEN_URGENCIA[a.urgencia] - ORDEN_URGENCIA[b.urgencia] || a.plazo.localeCompare(b.plazo)),
    [decisiones],
  );
  const seleccionada: Decision | undefined = decisiones.find((d) => d.id === seleccionId) ?? pendientes[0] ?? decisiones[0];

  // Cuando aparece una propuesta nueva y lo que se está viendo ya no está pendiente
  // (p. ej. tras denegar), se salta a la nueva sin que nadie tenga que buscarla.
  const conocidas = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nuevas = pendientes.filter((d) => !conocidas.current.has(d.id));
    for (const d of decisiones) conocidas.current.add(d.id);
    if (nuevas.length === 0) return;
    const actual = decisiones.find((d) => d.id === seleccionId);
    if (!actual || actual.estado !== "pendiente") setSeleccionId(nuevas[0].id);
  }, [pendientes, decisiones, seleccionId]);

  const seleccionar = useCallback((id: string) => {
    setSeleccionId(id);
    setPanel(null);
  }, []);

  const cerrarPanel = useCallback(() => setPanel(null), []);

  if (!veMando) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted">Abriendo tu vista…</div>;
  }
  if (!estado) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted">Conectando con el centro de mando…</div>;
  }

  const tareas = estado.tareasVoluntarios ?? [];
  const informeAbierto = estado.informes.find((i) => i.id === informeAbiertoId) ?? null;
  const rutas = (seleccionada as (Decision & { rutas?: RutaMapa[] }) | undefined)?.rutas;

  const irARef = (ref: string) => {
    if (decisiones.some((d) => d.id === ref)) seleccionar(ref);
    else if (estado.informes.some((i) => i.id === ref)) setInformeAbiertoId(ref);
    else if (estado.doctrina.some((r) => r.id === ref)) setPanel("doctrina");
    else if (tareas.some((t) => t.id === ref)) setPanel("voluntarios");
  };

  const contadores: Partial<Record<Panel, number>> = {
    decisiones: pendientes.length,
    doctrina: estado.doctrina.filter((r) => r.activa).length,
    informes: estado.informes.length,
    voluntarios: tareas.filter((t) => t.estado === "abierta" || t.estado === "propuesta").length,
    // Simulador: eventos ya inyectados en la reproducción en curso (0 si no hay ninguna).
    simulacion: estado.simulacion?.activa ? estado.simulacion.indice : 0,
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <BarraSuperior
        estado={estado}
        conexion={conexion}
        ahora={ahora}
        rol={rol}
        panel={panel}
        contadores={contadores}
        onPanel={setPanel}
        onAutoAvance={(a) => accion(() => api.config({ autoAvance: a }))}
        onTick={() => accion(api.tick)}
        onReset={() => {
          setSeleccionId(null);
          conocidas.current.clear();
          void accion(api.reset);
        }}
        onUmbral={(u) => accion(() => api.config({ umbralAutonomia: u }))}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.9fr)] lg:overflow-hidden">
        {/* 1. La decisión */}
        <section className="superficie min-h-[520px] overflow-hidden rounded-xl border border-panel-border bg-panel lg:min-h-0">
          <DecisionAhora
            decision={seleccionada}
            pendientes={pendientes}
            doctrina={estado.doctrina}
            rol={rol}
            ahora={ahora}
            umbralAutonomia={estado.umbralAutonomia}
            politica={politica}
            onSeleccionar={seleccionar}
            onAprobar={() => accion(() => api.aprobar(seleccionada!.id))}
            onDenegar={(feedback, ambito) => accion(() => api.denegar(seleccionada!.id, feedback, ambito))}
            onEscalar={(a) => accion(() => api.escalar(seleccionada!.id, a))}
            onVerInforme={setInformeAbiertoId}
            onVerHistorial={() => setPanel("decisiones")}
          />
        </section>

        {/* 2 y 3. Situación y acontecimientos */}
        <aside className="grid min-h-0 grid-rows-[minmax(360px,1.15fr)_minmax(260px,1fr)] gap-3 lg:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="superficie min-h-0 overflow-hidden rounded-xl border border-panel-border bg-panel">
            <Situacion estado={estado} domino={seleccionada?.tarjeta.domino} rutas={rutas} />
          </div>
          <div className="superficie min-h-0 overflow-hidden rounded-xl border border-panel-border bg-panel">
            <Acontecimientos timeline={estado.timeline} ahora={ahora} onIr={irARef} />
          </div>
        </aside>
      </main>

      <PanelSecundario abierto={panel !== null} titulo={panel ? TITULO_PANEL[panel].titulo : ""} descripcion={panel ? TITULO_PANEL[panel].descripcion : undefined} onCerrar={cerrarPanel}>
        {panel === "decisiones" && (
          <ColaDecisiones decisiones={decisiones} ahora={ahora} seleccionadaId={seleccionada?.id ?? null} onSeleccionar={seleccionar} umbralAutonomia={estado.umbralAutonomia} />
        )}
        {panel === "doctrina" && (
          <PanelDoctrina
            doctrina={estado.doctrina}
            onToggle={puede(rol, "editar_doctrina") ? (id, activa) => accion(() => api.toggleRegla(id, activa)) : undefined}
            onEliminar={puede(rol, "editar_doctrina") ? (id) => accion(() => api.eliminarRegla(id)) : undefined}
          />
        )}
        {panel === "informes" && (
          <PanelInformes
            informes={estado.informes}
            incidenteActivo={estado.incidente.activo}
            onAbrir={setInformeAbiertoId}
            onCerrarIncidente={puede(rol, "firmar_informes") ? () => accion(api.cerrarIncidente) : undefined}
          />
        )}
        {panel === "voluntarios" && (
          <PanelVoluntarios
            tareas={tareas}
            onPublicar={puede(rol, "gestionar_voluntarios") ? (id) => accion(() => api.publicarTarea(id)) : undefined}
            onCancelar={puede(rol, "gestionar_voluntarios") ? (id) => accion(() => api.cancelarTarea(id)) : undefined}
          />
        )}
        {panel === "simulacion" && (
          <PanelSimulador
            simulacion={estado.simulacion}
            puedeControlar={rol === "director_plan" || puede(rol, "controlar_simulacion")}
            centro={estado.incidente.ubicacion}
            onCambio={refrescar}
            onSeleccionarDecision={seleccionar}
            eventos={estado.eventos}
            iaDisponible={estado.iaDisponible}
          />
        )}
        {panel === "perifericos" && <PestanaPerifericos incidente={estado.incidente.ubicacion} />}
      </PanelSecundario>

      <VisorInforme informe={informeAbierto} onCerrar={() => setInformeAbiertoId(null)} />
    </div>
  );
}
