"use client";
// Sala de mando: mapa a pantalla completa + panel de decisiones.
// DUEÑO: constructor E.
//
// Aquí viven el estado de la pantalla (modo declarar, pestaña activa, panel
// plegado), los atajos de teclado y el aviso de los eventos críticos. Todo lo
// que se ve sale del Snapshot que llega por SSE: si el servidor no responde, la
// pantalla lo dice y sigue siendo navegable.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PauseOctagon, Play, WifiOff } from "lucide-react";
import type { Poblacion, Punto, Unidad } from "@/lib/dominio/tipos";
import { useEstado } from "@/lib/cliente/useEstado";
import { conModificadores, escribiendo } from "@/lib/cliente/teclado";
import { filtrarSnapshotPorZona, guardarZona, leerZonaGuardada, type ZonaSeleccion } from "@/lib/cliente/zona";
import {
  actualizarFoco,
  ajustarReloj,
  avisarPoblacion,
  declararFoco,
  mensajeDeError,
  ordenarUnidad,
  retirarUnidad,
  vigilarCamara,
} from "@/lib/cliente/api";
import { Boton } from "@/components/ui/Boton";
import { Mapa, type PeticionEncuadre } from "@/components/mapa/Mapa";
import { BarraSuperior } from "@/components/sala/BarraSuperior";
import { DialogoAtajos } from "@/components/sala/DialogoAtajos";
import { DialogoDeclararFoco } from "@/components/sala/DialogoDeclararFoco";
import { DialogoMovil } from "@/components/sala/DialogoMovil";
import { PanelDerecho, type ClavePestana } from "@/components/sala/PanelDerecho";
import { SeparadorPaneles } from "@/components/sala/SeparadorPaneles";
import { QUIEN, type ObjetivoAccion } from "@/components/sala/TarjetaDecision";
import { aprobarDecision } from "@/lib/cliente/api";
import { useToast } from "@/components/ui/Toast";
import { enEspana } from "@/lib/dominio/espana";

/**
 * RENDIMIENTO (constructor R): el mapa monta ~2000 capas de Leaflet. Envuelto en
 * `memo`, un cambio de estado de la sala (pestaña, panel plegado, diálogo
 * abierto) ya no lo re-renderiza: sus props son las mismas referencias porque
 * todos los callbacks de abajo son `useCallback`. Solo vuelve a pintarse cuando
 * cambia de verdad algo suyo (snapshot nuevo, foco resaltado, encuadre, modo).
 * No cambia la firma de `MapaProps` (dueño: constructor B).
 */
const MapaMemo = memo(Mapa);

export default function SalaDeMando() {
  const router = useRouter();
  const { snapshot, conectado, error, cargando, refrescar } = useEstado();
  const toast = useToast();

  const [pestana, setPestana] = useState<ClavePestana>("decisiones");
  const [plegado, setPlegado] = useState(false);
  /** Panel a pantalla completa: el mapa se oculta y las secciones se reparten en columnas. */
  const [ampliado, setAmpliado] = useState(false);
  const [declarando, setDeclarando] = useState(false);
  const [puntoFoco, setPuntoFoco] = useState<Punto | null>(null);
  const [declarandoFoco, setDeclarandoFoco] = useState(false);
  const [atajos, setAtajos] = useState(false);
  const [movil, setMovil] = useState(false);
  const [seleccionado, setSeleccionado] = useState<string>();
  const [centrarEn, setCentrarEn] = useState<PeticionEncuadre>();
  /** Unidad a la que se le está eligiendo destino con un clic en el mapa. */
  const [unidadOrdenando, setUnidadOrdenando] = useState<Unidad>();

  /**
   * Filtro por zona: un recuadro o un lazo dibujado sobre el mapa. El snapshot
   * completo sigue llegando por SSE; aquí se recorta (lib/cliente/zona.ts) y
   * el mapa y el panel reciben SOLO lo que cae dentro. La zona se guarda en
   * localStorage y sobrevive a recargas: solo se va con "Quitar filtro".
   */
  const [zona, setZona] = useState<ZonaSeleccion | null>(null);
  useEffect(() => {
    // localStorage no existe en el render del servidor: se lee tras hidratar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZona(leerZonaGuardada());
  }, []);
  const fijarZona = useCallback((z: ZonaSeleccion) => {
    guardarZona(z);
    setZona(z);
  }, []);
  const quitarZona = useCallback(() => {
    guardarZona(null);
    setZona(null);
  }, []);
  const snapshotZona = useMemo(() => filtrarSnapshotPorZona(snapshot, zona), [snapshot, zona]);
  /** Focos que cuentan (ni descartados ni absorbidos): para "N de M en la zona". */
  const focosTotales = useMemo(
    () => (snapshot?.incendios ?? []).filter((i) => i.estado !== "descartado" && i.estado !== "fusionado").length,
    [snapshot?.incendios],
  );
  const focosEnZona = useMemo(
    () => (snapshotZona?.incendios ?? []).filter((i) => i.estado !== "descartado" && i.estado !== "fusionado").length,
    [snapshotZona?.incendios],
  );
  const filtroZona = useMemo(() => (zona ? { dentro: focosEnZona, total: focosTotales } : undefined), [zona, focosEnZona, focosTotales]);

  const pausado = Boolean(snapshot?.reloj.pausado);

  // Con una zona puesta, los atajos A/D actúan sobre lo que se ve, no sobre lo oculto.
  const pendientes = useMemo(
    () =>
      (snapshotZona?.decisiones ?? [])
        .filter((d) => d.estado === "pendiente_humano" || d.estado === "escalada")
        .sort((a, b) => a.prioridad - b.prioridad || a.creadaEn.localeCompare(b.creadaEn)),
    [snapshotZona?.decisiones],
  );

  // --- Eventos críticos: también se anuncian como toast (una sola vez) -------
  const vistos = useRef<Set<string>>(new Set());
  const primeraVez = useRef(true);
  useEffect(() => {
    const eventos = snapshot?.eventos ?? [];
    if (primeraVez.current) {
      // Al cargar no se anuncia el histórico: solo lo que pase a partir de ahora.
      for (const e of eventos) vistos.current.add(e.id);
      primeraVez.current = false;
      return;
    }
    for (const e of eventos) {
      if (vistos.current.has(e.id)) continue;
      vistos.current.add(e.id);
      if (e.nivel === "critico") toast.aviso(e.mensaje, e.agenteId ? `Agente: ${e.agenteId}` : undefined);
    }
  }, [snapshot?.eventos, toast]);

  // --- Acciones -------------------------------------------------------------
  //
  // Todos los manejadores que bajan a los hijos memoizados son estables: si
  // fueran flechas en línea, cada render de la sala les cambiaría las props y
  // `memo` no serviría de nada (el mapa volvería a pintar sus 2000 capas).

  const alternarDeclarar = useCallback(() => setDeclarando((v) => !v), []);
  const abrirAtajos = useCallback(() => setAtajos(true), []);
  const cerrarAtajos = useCallback(() => setAtajos(false), []);
  const abrirMovil = useCallback(() => setMovil(true), []);
  const cerrarMovil = useCallback(() => setMovil(false), []);
  const alternarPlegado = useCallback(() => setPlegado((v) => !v), []);
  const alternarAmpliado = useCallback(() => {
    setAmpliado((v) => !v);
    setPlegado(false);
  }, []);
  const cerrarPuntoFoco = useCallback(() => setPuntoFoco(null), []);
  const ordenarUnidad_ = useCallback((u: Unidad) => setUnidadOrdenando(u), []);

  /** Clic en un foco del mapa: lo selecciona y abre la pestaña "Focos". */
  const seleccionarDesdeMapa = useCallback((id: string) => {
    setSeleccionado(id);
    setPestana("focos");
    setPlegado(false);
  }, []);

  const centrarIncendio = useCallback(
    (id: string) => {
      const inc = snapshot?.incendios.find((i) => i.id === id);
      if (!inc) return;
      setSeleccionado(id);
      setAmpliado(false); // "Ver en el mapa" solo tiene sentido con el mapa a la vista
      setCentrarEn({ lat: inc.centro.lat, lon: inc.centro.lon, sello: Date.now() });
    },
    [snapshot?.incendios],
  );

  /** "Ver en el mapa" desde una decisión: centra en la unidad desplegada. */
  const centrarUnidad = useCallback(
    (id: string) => {
      const u = snapshot?.unidades.find((x) => x.id === id);
      if (!u) {
        toast.aviso("Esa unidad ya no está en el mapa", "Puede que haya vuelto a su base o que la ejecución sea otra.");
        return;
      }
      setAmpliado(false);
      // La unidad viaja con la petición: el mapa la pinta y la resalta aunque
      // siga en su base (el filtro "solo las desplegadas" la ocultaría) o quede
      // fuera de la zona. Zoom mínimo 13: un parque a 8 km del foco se distingue.
      setCentrarEn({ lat: u.posicion.lat, lon: u.posicion.lon, sello: Date.now(), zoomMinimo: 13, unidad: u });
    },
    [snapshot?.unidades, toast],
  );

  /**
   * "Centrar en el mapa" desde una decisión SIN foco (o desde una acción): lleva
   * el mapa al pueblo avisado, a la cámara, a la unidad o al punto de la acción.
   */
  const centrarObjetivo = useCallback(
    (o: ObjetivoAccion) => {
      // Una unidad va por su camino: se pinta y se resalta aunque esté en base.
      if (!o.punto && !o.poblacionId && !o.camaraId && o.unidadId) return centrarUnidad(o.unidadId);
      const punto =
        o.punto ??
        (o.poblacionId ? snapshot?.poblaciones.find((p) => p.id === o.poblacionId)?.centro : undefined) ??
        (o.camaraId ? snapshot?.camaras.find((c) => c.id === o.camaraId)?.punto : undefined) ??
        (o.unidadId ? snapshot?.unidades.find((u) => u.id === o.unidadId)?.posicion : undefined);
      if (!punto) {
        toast.aviso("Ese punto ya no está en el mapa", "Puede que el pueblo, la cámara o la unidad ya no formen parte de la ejecución.");
        return;
      }
      setAmpliado(false);
      setCentrarEn({ lat: punto.lat, lon: punto.lon, sello: Date.now() });
    },
    [snapshot?.poblaciones, snapshot?.camaras, snapshot?.unidades, toast, centrarUnidad],
  );

  /**
   * Llegada desde el visor de incidencia (/incidencias/[id] → "/?foco=<id>").
   * La URL solo se puede mirar DESPUÉS de hidratar: leerla en el render haría
   * que el servidor y el navegador pintaran cosas distintas. Una vez leída, el
   * foco queda resaltado y el mapa lo encuadra sin robarle el mapa al usuario.
   */
  const [focoDeLaUrl, setFocoDeLaUrl] = useState("");
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("foco");
    if (!id) return;
    // Sincronización con un sistema externo (la barra de direcciones), que no
    // existe durante el render del servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocoDeLaUrl(id);
    setPestana("focos");
  }, []);
  const centrarPorUrl = useMemo(() => {
    if (!focoDeLaUrl) return undefined;
    const inc = snapshot?.incendios.find((i) => i.id === focoDeLaUrl);
    // `sello: 1` = se aplica una sola vez; cualquier encuadre posterior del
    // usuario llega con Date.now() y manda sobre este.
    return inc ? { lat: inc.centro.lat, lon: inc.centro.lon, sello: 1 } : undefined;
  }, [focoDeLaUrl, snapshot?.incendios]);
  const centrarEfectivo = centrarEn ?? centrarPorUrl;
  const focoResaltado = seleccionado ?? (centrarPorUrl ? focoDeLaUrl : undefined);

  const cambiarEstadoFoco = useCallback(
    async (id: string, estado: "confirmado" | "descartado") => {
      try {
        await actualizarFoco(id, { estado });
        toast.exito(estado === "confirmado" ? "Foco confirmado" : "Foco descartado", estado === "confirmado" ? "Los agentes ya pueden desplegar medios." : undefined);
        await refrescar();
      } catch (e) {
        toast.error("No se ha podido cambiar el estado del foco", mensajeDeError(e));
      }
    },
    [refrescar, toast],
  );

  /** Destino elegido con un clic en el mapa para la unidad en curso. */
  const confirmarDestinoUnidad = useCallback(
    async (u: Unidad, punto: Punto) => {
      const incendioId = u.incendioId ?? seleccionado ?? snapshot?.incendios.find((i) => !["extinguido", "descartado"].includes(i.estado))?.id;
      if (!incendioId) {
        toast.aviso("Falta el foco", "Una orden manual se anota sobre un incendio: declara o selecciona uno antes.");
        return;
      }
      try {
        await ordenarUnidad(u.id, { destino: { lat: punto.lat, lon: punto.lon }, incendioId, sector: u.sector, quien: QUIEN });
        toast.exito(`${u.nombre} en camino`, "Ruta real por carretera calculada con OSRM.");
        await refrescar();
      } catch (e) {
        toast.error(`No se ha podido ordenar el movimiento de ${u.nombre}`, mensajeDeError(e));
      }
    },
    [refrescar, seleccionado, snapshot?.incendios, toast],
  );

  /**
   * Un clic en el mapa sirve para dos cosas según el modo: declarar un foco o
   * fijar el destino de la unidad que se está ordenando.
   */
  const clicEnMapa = useCallback(
    (p: Punto) => {
      if (!enEspana(p)) {
        toast.aviso("Ese punto está fuera de España", "El sistema solo trabaja con el territorio español: elige un punto dentro.");
        return;
      }
      if (unidadOrdenando) {
        const u = unidadOrdenando;
        setUnidadOrdenando(undefined);
        void confirmarDestinoUnidad(u, p);
        return;
      }
      setPuntoFoco(p);
    },
    [confirmarDestinoUnidad, toast, unidadOrdenando],
  );

  const retirar = useCallback(
    async (u: Unidad) => {
      try {
        await retirarUnidad(u.id, { quien: QUIEN, motivo: "Retirada ordenada desde la sala de mando" });
        toast.exito(`${u.nombre} vuelve a ${u.base.nombre}`);
        await refrescar();
      } catch (e) {
        toast.error(`No se ha podido retirar ${u.nombre}`, mensajeDeError(e));
      }
    },
    [refrescar, toast],
  );

  const alternarPausa = useCallback(async () => {
    try {
      await ajustarReloj({ pausado: !pausado });
      toast.info(pausado ? "Mundo reanudado: los agentes vuelven a trabajar" : "TODO EN PAUSA: ningún agente trabaja");
      await refrescar();
    } catch (e) {
      toast.error("No se ha podido cambiar la pausa", mensajeDeError(e));
    }
  }, [pausado, refrescar, toast]);

  const confirmarFoco = useCallback(
    async (datos: { nombre?: string; notas?: string }) => {
      if (!puntoFoco) return;
      setDeclarandoFoco(true);
      try {
        const { incendio } = await declararFoco({ lat: puntoFoco.lat, lon: puntoFoco.lon, ...datos });
        toast.exito("Foco declarado", incendio?.nombre ? `${incendio.nombre}: los agentes ya están trabajando.` : undefined);
        setPuntoFoco(null);
        setDeclarando(false);
        if (incendio?.centro) setCentrarEn({ lat: incendio.centro.lat, lon: incendio.centro.lon, sello: Date.now() });
        await refrescar();
      } catch (e) {
        toast.error("No se ha podido declarar el foco", mensajeDeError(e));
      } finally {
        setDeclarandoFoco(false);
      }
    },
    [puntoFoco, refrescar, toast],
  );

  const avisar = useCallback(
    async (p: Poblacion) => {
      try {
        await avisarPoblacion(p.id, { quien: QUIEN });
        toast.exito(`Avisando a ${p.nombre}`, "La llamada o el mensaje se están ejecutando de verdad.");
        await refrescar();
      } catch (e) {
        toast.error(`No se ha podido avisar a ${p.nombre}`, mensajeDeError(e));
      }
    },
    [refrescar, toast],
  );

  const vigilar = useCallback(
    async (id: string, v: boolean) => {
      try {
        await vigilarCamara(id, v);
        toast.exito(v ? "Cámara en vigilancia" : "Cámara fuera de vigilancia");
        await refrescar();
      } catch (e) {
        toast.error("No se ha podido cambiar la vigilancia", mensajeDeError(e));
      }
    },
    [refrescar, toast],
  );

  // --- Atajos de teclado ----------------------------------------------------
  useEffect(() => {
    async function alTeclado(e: KeyboardEvent) {
      if (escribiendo() || conModificadores(e)) return;
      const tecla = e.key.toLowerCase();

      if (e.key === "Escape" && (declarando || unidadOrdenando)) {
        setDeclarando(false);
        setUnidadOrdenando(undefined);
        return;
      }
      // Los diálogos capturan su propio Esc antes de llegar aquí.
      if (e.key === "Escape" && ampliado) {
        setAmpliado(false);
        return;
      }
      if (tecla === "f") {
        e.preventDefault();
        setDeclarando((v) => !v);
      } else if (tecla === "?" || (e.shiftKey && tecla === "/")) {
        e.preventDefault();
        setAtajos(true);
      } else if (tecla === "g") {
        e.preventDefault();
        router.push("/agentes");
      } else if (tecla === "p") {
        e.preventDefault();
        alternarAmpliado();
      } else if (e.code === "Space") {
        e.preventDefault();
        await alternarPausa();
      } else if (tecla === "a" || tecla === "d") {
        const primera = pendientes[0];
        if (!primera) {
          toast.info("No hay ninguna decisión pendiente");
          return;
        }
        e.preventDefault();
        setPlegado(false);
        setPestana("decisiones");
        if (tecla === "a") {
          try {
            await aprobarDecision(primera.id, QUIEN);
            toast.exito("Decisión aprobada", primera.titulo);
            await refrescar();
          } catch (err) {
            toast.error("No se ha podido aprobar", mensajeDeError(err));
          }
        } else {
          // Denegar exige motivo: se lleva al usuario a la tarjeta, que abre su diálogo.
          toast.info("Escribe el motivo para denegar", primera.titulo);
          document.getElementById("panel-panel-decisiones")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    }
    document.addEventListener("keydown", alTeclado);
    return () => document.removeEventListener("keydown", alTeclado);
  }, [alternarAmpliado, alternarPausa, ampliado, declarando, pendientes, refrescar, router, toast, unidadOrdenando]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <BarraSuperior
        snapshot={snapshot}
        onRefrescar={refrescar}
        onDeclararFoco={alternarDeclarar}
        declarando={declarando}
        onAtajos={abrirAtajos}
        onUnirMovil={abrirMovil}
      />

      {/* PAUSA GLOBAL: banda a todo el ancho. Mientras esté, NINGÚN agente
          trabaja ni hay una sola llamada a la IA (lo impone el orquestador). */}
      {pausado ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-y-2 border-warning bg-warning/20 px-3 py-2 text-center"
        >
          <p className="flex items-center gap-2 text-[13.5px] font-bold uppercase tracking-wide text-warning">
            <PauseOctagon className="size-5 shrink-0 parpadeo" aria-hidden />
            Mundo en pausa · ningún agente trabaja
          </p>
          <span className="text-[12.5px] text-warning">Pulsa Reanudar o la barra espaciadora para que sigan.</span>
          <Boton variante="primario" tamano="sm" icono={<Play />} onClick={alternarPausa}>
            Reanudar (Espacio)
          </Boton>
        </div>
      ) : null}

      {!conectado ? (
        <p
          role="status"
          className="flex items-center justify-center gap-2 border-b border-warning/45 bg-warning/12 px-3 py-1.5 text-[12.5px] font-medium text-warning"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden />
          {cargando
            ? "Conectando con el servidor de Atalaya…"
            : `Sin conexión en vivo: la pantalla se refresca cada 5 s y puede estar desfasada.${error ? ` ${error}` : ""}`}
        </p>
      ) : null}

      <main className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className={ampliado ? "hidden" : "relative min-h-[45vh] flex-1 lg:min-h-0"}>
          <MapaMemo
            snapshot={snapshotZona}
            incendioSeleccionado={focoResaltado}
            onSeleccionarIncendio={seleccionarDesdeMapa}
            modoDeclarar={declarando}
            onClicMapa={clicEnMapa}
            onAvisarPoblacion={avisar}
            onVigilarCamara={vigilar}
            centrarEn={centrarEfectivo}
            unidadOrdenando={unidadOrdenando}
            onOrdenarUnidad={ordenarUnidad_}
            onRetirarUnidad={retirar}
            onCambiarEstadoFoco={cambiarEstadoFoco}
            onRefrescar={refrescar}
            zona={zona}
            focosTotales={focosTotales}
            focosEnZona={focosEnZona}
            onZonaDibujada={fijarZona}
            onQuitarZona={quitarZona}
          />
        </div>

        {/* SEPARADOR arrastrable mapa/panel: fija --ancho-panel en este <main>. Solo con panel abierto. */}
        {!ampliado && !plegado ? <SeparadorPaneles /> : null}

        <PanelDerecho
          snapshot={snapshotZona}
          activa={pestana}
          onCambiarPestana={setPestana}
          plegado={plegado}
          onPlegar={alternarPlegado}
          ampliado={ampliado}
          onAmpliar={alternarAmpliado}
          onRefrescar={refrescar}
          onCentrarIncendio={centrarIncendio}
          onCentrarUnidad={centrarUnidad}
          onCentrarObjetivo={centrarObjetivo}
          incendioSeleccionado={focoResaltado}
          filtroZona={filtroZona}
          onQuitarZona={quitarZona}
        />
      </main>

      <DialogoDeclararFoco punto={puntoFoco} onCerrar={cerrarPuntoFoco} onConfirmar={confirmarFoco} ocupado={declarandoFoco} />
      <DialogoAtajos abierto={atajos} onCerrar={cerrarAtajos} />
      <DialogoMovil abierto={movil} onCerrar={cerrarMovil} />
    </div>
  );
}
