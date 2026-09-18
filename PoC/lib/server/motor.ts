// Motor del sistema: orquesta escenario, datos reales, grafo, proponente,
// doctrina, informes y ejecución. Todas las mutaciones pasan por conBloqueo().

import type { AristaGrafo, EventoIngesta, NodoGrafo } from "../types";
import { ARISTAS, NODOS } from "../mock-data";
import type { CondicionesEntorno, Decision, EstadoSistema, Evidencia, ResultadoAccion, Rol } from "../tipos-sistema";
import { aireActual, evidenciaAire, evidenciaViento, meteoActual } from "./conectores/openMeteo";
import { evidenciaTrafico, sensoresCercanos } from "./conectores/madridTrafico";
import { demandaActual, evidenciaDemanda } from "./conectores/ree";
import { crearRegla, marcarAplicadas, normalizarSinLLM, reglasActivas } from "./doctrina";
import { ejecutarDecision, llamarCargo, proveedorDisponible } from "./ejecutor";
import { GUION, INCIDENTE_BASE, TICK_MAX } from "./escenario";
import { cargarEstado, conBloqueo, dedupePorId, estadoActual, guardar, nuevoId, reemplazarEstado, registrar, versionEstado } from "./estado";
import type { ProveedorGrafo } from "./grafo";
import { proveedorGrafo } from "./grafoArango";
import { actaDecision, postMortem, sitrep } from "./informes";
import { lecciones } from "./lecciones";
import { TAREAS_GUION, simularAceptaciones } from "./voluntarios";
import { procesarEvento } from "./router";
import { generarAudios } from "./audio";
import { normalizarRol } from "../roles";
import { detalleConectores, estadoConectores, protocoloAplicable, protocolosDisponibles } from "./conectores";
import { elevenlabsDisponible } from "./audio";
import { happyrobotDisponible } from "./conectores/happyrobot";
import { estadoSimulacion } from "./simulacion";
import { penacho as calcularPenacho, rumboEntre } from "./geo/penacho";
import { poisCercanos } from "./geo/overpass";
import { ruta as rutaOsrm } from "./geo/osrm";
import type { MapaEstado, RutaDecision } from "../tipos-sistema";
import { COORDS_OSM } from "./geo/nodos-osm";
import { reproyectarNodos } from "./geo/index";
import { esCategoriaId, evaluarCompetencia } from "../politica-autonomia";
import { politicaActual } from "./politica";
import { FOCOS_POR_TIPO, clasificarEmergencia, focoSiguiente, plantillaPorTipo, type TipoEmergencia } from "./plantillas";
import { asignarIncidente, coordsEvento } from "./incidentes";
import { construirGrafoReal } from "./grafo-real";
import { geocodificarInverso } from "./geo/nominatim";
import { tituloIncidente } from "./incidentes";
import { publicarComunicado } from "./perifericos/publicaciones";
import type { Incidente } from "../tipos-sistema";
import { iaDisponible, normalizarRegla, proponer } from "./proponente";

// El grafo va detrás de la interfaz: ArangoDB (query AQL de la spec) si está
// configurado y responde; si no, GrafoMemoria con el mismo BFS.
async function grafo(e: EstadoSistema): Promise<ProveedorGrafo> {
  const { grafo: g, origen } = await proveedorGrafo(e.nodos, e.aristas, e.incidente.id);
  e.origenGrafo = origen;
  return g;
}

const ahora = () => new Date().toISOString();
const min = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

// ---------------------------------------------------------------------------
// Entorno (datos reales) y evidencia
// ---------------------------------------------------------------------------
async function refrescarEntorno(e: EstadoSistema, forzarViento?: { direccionGrados: number; velocidadKmh: number; motivo: string }) {
  const { lat, lon } = e.incidente.ubicacion;
  let reales = 0;
  let intentos = 0;
  const ev: Evidencia[] = [];

  intentos++;
  try {
    const m = await conLimite(meteoActual(lat, lon), 8000, "open-meteo");
    reales++;
    if (!forzarViento && !e.entorno.viento.fuente.startsWith("Escenario")) {
      e.entorno.viento = { velocidadKmh: m.vientoKmh, direccionGrados: m.direccionGrados, direccionTexto: m.direccionTexto, fuente: "OpenMeteo", timestamp: m.timestamp };
    }
    ev.push(evidenciaViento(m));
  } catch (err) {
    console.warn("[entorno] meteo:", err instanceof Error ? err.message : err);
  }
  if (forzarViento) {
    const { gradosATexto } = await import("./conectores/geo");
    e.entorno.viento = { velocidadKmh: forzarViento.velocidadKmh, direccionGrados: forzarViento.direccionGrados, direccionTexto: gradosATexto(forzarViento.direccionGrados), fuente: "Escenario", timestamp: ahora() };
    ev.push({ id: "ev-viento-giro", fuente: "Escenario", descripcion: `Viento forzado por el guion: ${forzarViento.velocidadKmh} km/h del ${e.entorno.viento.direccionTexto}. ${forzarViento.motivo}`, valor: forzarViento.velocidadKmh, unidad: "km/h", timestamp: ahora(), confianza: 1 });
  }

  intentos++;
  try {
    const a = await conLimite(aireActual(lat, lon), 8000, "open-meteo-aire");
    reales++;
    e.entorno.aire = { pm25: a.pm25, pm10: a.pm10, co: a.co, timestamp: a.timestamp };
    ev.push(evidenciaAire(a));
  } catch (err) {
    console.warn("[entorno] aire:", err instanceof Error ? err.message : err);
  }

  intentos++;
  try {
    const { sensores, fechaHora } = await conLimite(sensoresCercanos(lat, lon, 1500, 12), 12000, "trafico-madrid");
    reales++;
    const cargaMedia = sensores.length ? Math.round(sensores.reduce((s, x) => s + x.carga, 0) / sensores.length) : 0;
    const peor = sensores[0];
    e.entorno.trafico = { sensoresCercanos: sensores.length, cargaMedia, sensorPeor: peor ? { id: peor.id, descripcion: peor.etiqueta, carga: peor.carga } : null, timestamp: fechaHora };
    for (const s of sensores.slice(0, 3)) ev.push(evidenciaTrafico(s, fechaHora));
    e.mapa = { ...(e.mapa ?? { centro: e.incidente.ubicacion, pois: [] }), centro: { lat: e.incidente.ubicacion.lat, lon: e.incidente.ubicacion.lon }, sensores: sensores.map((s) => ({ id: s.id, descripcion: s.etiqueta, lat: s.lat, lon: s.lon, carga: s.carga, nivelServicio: s.nivelServicio, intensidad: s.intensidad, timestamp: fechaHora })), actualizadoEn: ahora() };
  } catch (err) {
    console.warn("[entorno] tráfico:", err instanceof Error ? err.message : err);
  }

  actualizarPenacho(e);
  await actualizarMapa(e);

  intentos++;
  try {
    const d = await conLimite(demandaActual(), 8000, "ree");
    reales++;
    e.entorno.demandaElectricaMW = { valor: d.valorMW, timestamp: d.timestamp };
    ev.push(evidenciaDemanda(d));
  } catch (err) {
    console.warn("[entorno] ree:", err instanceof Error ? err.message : err);
  }

  e.modoDatos = reales === intentos ? "real" : reales > 0 ? "mixto" : "sin_datos";
  await nombrarIncidentesSinLugar(e);
  return ev;
}

const PESO_SEVERIDAD = { critica: 4, alta: 3, media: 2, baja: 1 } as const;
/** Incidente activo más grave (a igualdad, el más reciente); undefined si no queda ninguno activo. */
function elegirIncidenteActivo(e: EstadoSistema): Incidente | undefined {
  return [...(e.incidentes ?? [e.incidente])]
    .filter((i) => i.activo && i.fase !== "cierre")
    .sort((a, b) => PESO_SEVERIDAD[b.severidad ?? "media"] - PESO_SEVERIDAD[a.severidad ?? "media"] || (b.ultimoEventoEn ?? b.iniciadoEn).localeCompare(a.ultimoEventoEn ?? a.iniciadoEn))[0];
}

const ES_COORDENADA = /^-?\d+[.,]\d+,\s*-?\d+[.,]\d+$/;
/** Incidentes cuyo "lugar" son solo coordenadas: nombre de calle y distrito por Nominatim inverso (máx. 2 por pasada). */
async function nombrarIncidentesSinLugar(e: EstadoSistema) {
  const pendientes = (e.incidentes ?? [e.incidente]).filter((i) => ES_COORDENADA.test(i.ubicacion.nombre)).slice(0, 2);
  for (const i of pendientes) {
    try {
      const nombre = await conLimite(geocodificarInverso(i.ubicacion.lat, i.ubicacion.lon), 5000, "nominatim-inverso");
      i.ubicacion.nombre = nombre;
      i.titulo = tituloIncidente(i.tipo, nombre);
      if (e.incidente.id === i.id) {
        e.incidente.ubicacion.nombre = nombre;
        e.incidente.titulo = i.titulo;
      }
    } catch (err) {
      console.warn("[incidente] geocodificación inversa:", err instanceof Error ? err.message : err);
    }
  }
}

/** Vértice del grafo al que se refiere una ubicación de texto (para resaltar nodos con dato real). */
function nodoDeUbicacion(nodos: NodoGrafo[], ubicacion?: string): string | undefined {
  if (!ubicacion) return undefined;
  const u = ubicacion.toLowerCase();
  const reglas: [RegExp, string][] = [
    [/gregorio|hospital/, "Infraestructuras/hosp-gregorio"],
    [/m-?30/, "Infraestructuras/m30-sur"],
    [/r-?3|evacuaci/, "Infraestructuras/ruta-evac-3"],
    [/subestaci/, "Infraestructuras/subest-arganzuela"],
    [/112|comunicaciones/, "Infraestructuras/cecom-112"],
    [/m[eé]ndez [aá]lvaro 5[0-9]|nave/, "Incidencias/inc-2049"],
    [/m[eé]ndez [aá]lvaro/, "Infraestructuras/via-mendez-alvaro"],
  ];
  const id = reglas.find(([re]) => re.test(u))?.[1];
  return id && nodos.some((n) => n.id === id) ? id : undefined;
}

/** Límite duro para llamadas externas dentro del bloqueo: si tardan más, se sigue sin ese dato. */
function conLimite<T>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${etiqueta}: más de ${ms} ms`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/** Cono de humo en metros con la misma fórmula para mapa, grafo y decisiones. */
function actualizarPenacho(e: EstadoSistema) {
  const conCoords = e.nodos.filter((n) => typeof n.lat === "number" && typeof n.lon === "number").map((n) => ({ id: n.id, lat: n.lat!, lon: n.lon! }));
  const p = calcularPenacho({ velocidadKmh: e.entorno.viento.velocidadKmh, direccionGrados: e.entorno.viento.direccionGrados }, e.incidente.ubicacion, conCoords);
  e.entorno.penacho = { rumboGrados: Math.round(p.rumboGrados), longitudM: Math.round(p.longitudM), semianguloGrados: p.semianguloGrados, afectados: p.afectados };
}

/** POIs reales de OpenStreetMap alrededor del incidente (una consulta, cacheada en overpass.ts). */
async function actualizarMapa(e: EstadoSistema) {
  const centro = { lat: e.incidente.ubicacion.lat, lon: e.incidente.ubicacion.lon };
  const base: MapaEstado = e.mapa ?? { centro, sensores: [], pois: [], actualizadoEn: ahora() };
  if (!base.pois.length) {
    try {
      const pois = await conLimite(poisCercanos(centro.lat, centro.lon, 2000), 6000, "overpass");
      base.pois = pois.map((p) => ({ id: p.id, tipo: p.tipo, nombre: p.nombre, lat: p.lat, lon: p.lon, url: p.url, fuente: "Overpass" as const, distanciaM: p.distanciaM }));
    } catch (err) {
      console.warn("[mapa] overpass:", err instanceof Error ? err.message : err);
    }
  }
  // Sin Overpass (caído o sin red): los equipamientos del grafo real (snapshot OSM de poc-07) hacen de POIs.
  if (!base.pois.length) {
    const TIPO_POI: Partial<Record<NodoGrafo["tipo"], string>> = { Hospital: "hospital", Bomberos: "bomberos", Policia: "policia", Sanitarios: "centro_salud", Colegio: "colegio", Residencia: "residencia", Refugio: "refugio", Estacion: "estacion", Subestacion: "subestacion", Gasolinera: "gasolinera" };
    base.pois = e.nodos
      .filter((n) => typeof n.lat === "number" && typeof n.lon === "number" && TIPO_POI[n.tipo])
      .map((n) => ({ id: n.osmId ?? n.id, tipo: TIPO_POI[n.tipo]!, nombre: n.nombre, lat: n.lat!, lon: n.lon!, url: n.osmId ? `https://www.openstreetmap.org/${n.osmId}` : "", fuente: "OSM" as const }));
  }
  e.mapa = { ...base, centro, actualizadoEn: ahora() };
}

/** Rutas reales (OSRM) para las acciones de una decisión, según su foco. */
async function rutasParaDecision(e: EstadoSistema, foco: string): Promise<RutaDecision[]> {
  const nodo = (id: string) => e.nodos.find((n) => n.id === id && typeof n.lat === "number" && typeof n.lon === "number");
  const inc = e.incidente.ubicacion;
  const planes: { id: string; nombre: string; tipo: RutaDecision["tipo"]; desde?: { lat: number; lon: number }; hasta?: { lat: number; lon: number } }[] = [];
  const hosp = nodo("Infraestructuras/hosp-gregorio");
  const evac = nodo("Infraestructuras/ruta-evac-3");
  const bomberos = nodo("Efectivos/bomberos-p7");
  const samur = nodo("Efectivos/samur-a3");
  if (/hospital|replanificacion|observacion/.test(foco) && hosp) planes.push({ id: "amb-hosp", nombre: "Ambulancias: incidente → Gregorio Marañón", tipo: "ambulancia", desde: inc, hasta: { lat: hosp.lat!, lon: hosp.lon! } });
  if (/evacu|replanificacion/.test(foco) && evac) planes.push({ id: "evac-r3", nombre: "Evacuación: incidente → punto de reunión R-3", tipo: "evacuacion", desde: inc, hasta: { lat: evac.lat!, lon: evac.lon! } });
  if (/despliegue|corte|observacion|activacion/.test(foco) && bomberos) planes.push({ id: "acc-bomberos", nombre: "Acceso Bomberos Parque 7 → incidente", tipo: "acceso", desde: { lat: bomberos.lat!, lon: bomberos.lon! }, hasta: inc });
  if (/hospital/.test(foco) && samur && hosp) planes.push({ id: "samur-hosp", nombre: "SAMUR → Gregorio Marañón (preposicionamiento)", tipo: "ambulancia", desde: { lat: samur.lat!, lon: samur.lon! }, hasta: { lat: hosp.lat!, lon: hosp.lon! } });
  const out: RutaDecision[] = [];
  for (const p of planes.slice(0, 2)) {
    if (!p.desde || !p.hasta) continue;
    try {
      const r = await conLimite(rutaOsrm([p.desde, p.hasta]), 8000, "osrm");
      out.push({ id: p.id, nombre: p.nombre, tipo: p.tipo, coords: r.coords, distanciaM: Math.round(r.distanciaM), duracionS: Math.round(r.duracionS), fuente: "OSRM" });
    } catch (err) {
      console.warn("[osrm]", p.id, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

function distanciaIncidentes(e: EstadoSistema, incidenteId: string, otro: Incidente): number {
  const a = (e.incidentes ?? [e.incidente]).find((i) => i.id === incidenteId) ?? (incidenteId === e.incidente.id ? e.incidente : undefined);
  if (!a) return Infinity;
  const R = 6371000;
  const dLat = ((otro.ubicacion.lat - a.ubicacion.lat) * Math.PI) / 180;
  const dLon = ((otro.ubicacion.lon - a.ubicacion.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.ubicacion.lat * Math.PI) / 180) * Math.cos((otro.ubicacion.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function sensorDe(x: EventoIngesta): { magnitud: string; valor: number; unidad: string } | undefined {
  const m = x.detalle.match(/\[([a-z_]+):\s*([\d.,]+)\s*([^\]]+)\]/i);
  return m ? { magnitud: m[1], valor: Number(m[2].replace(",", ".")), unidad: m[3].trim() } : undefined;
}

function evidenciaDeEventos(eventos: EventoIngesta[], nodos: NodoGrafo[]): Evidencia[] {
  return eventos.slice(0, 6).map((x) => ({
    nodoId: nodoDeUbicacion(nodos, x.ubicacion),
    id: `ev-src-${x.id}`,
    fuente: x.fuente,
    descripcion: `${x.titulo}: ${x.detalle}`,
    valor: x.confianza,
    unidad: "confianza",
    timestamp: x.timestamp,
    confianza: x.confianza,
  }));
}

// ---------------------------------------------------------------------------
// Decisiones
// ---------------------------------------------------------------------------
async function crearDecision(e: EstadoSistema, foco: { clave: string; descripcion: string }, evidenciaEntorno: Evidencia[], anterior?: Decision, feedback?: string, origenDomino?: string, inc?: Incidente): Promise<Decision | null> {
  const incidente = inc ?? e.incidente;
  if (!incidente.activo || incidente.fase === "cierre") {
    registrar(e, "sistema", `No se propone "${foco.clave}": el incidente ${incidente.titulo} está cerrado.`, incidente.id);
    return null;
  }
  const g = await grafo(e);
  const domino = g.impactoDomino(origenDomino ?? incidente.nodoId ?? incidente.id);
  const evidencia: Evidencia[] = [
    ...evidenciaEntorno,
    ...evidenciaDeEventos(e.eventos, e.nodos),
    ...domino.slice(0, 3).map((d, i) => ({ id: `ev-grafo-${i}`, fuente: "Grafo" as const, descripcion: `Efecto dominó: ${d.ruta.join(" → ")} (riesgo ${d.riesgo}/100)`, valor: d.riesgo, unidad: "riesgo", timestamp: ahora(), confianza: 0.8, nodoId: e.nodos.find((n) => n.nombre === d.infraestructura)?.id })),
  ];
  const doctrina = reglasActivas(e);
  const eventosInc = incidente.eventosIds?.length ? e.eventos.filter((x) => incidente.eventosIds!.includes(x.id)) : e.eventos;
  const ctx = { incidente, entorno: e.entorno, eventos: eventosInc, domino, doctrina, evidencia, foco: foco.clave, descripcionFoco: foco.descripcion, planAnterior: anterior?.tarjeta.plan, feedback };
  // Con IA: Claude (cualquier tipo de emergencia). Sin IA o si Claude falla: plantilla determinista POR TIPO (lib/server/plantillas.ts).
  let p: Awaited<ReturnType<typeof proponer>> | null = null;
  if (iaDisponible()) {
    try {
      p = await conLimite(proponer(ctx), Number(process.env.LLM_TIMEOUT_MS ?? 45000), "proponer");
    } catch (err) {
      console.warn("[motor] proponer falló, uso plantilla por tipo:", err instanceof Error ? err.message : err);
    }
  }
  if (!p || p.generadaPor === "plantilla") {
    const t0 = Date.now();
    // Focos del pipeline de periféricos (obs_<categoria>) y "desmentido" se traducen al foco equivalente del tipo para la plantilla.
    const tipo = (incidente.tipo in FOCOS_POR_TIPO ? incidente.tipo : "otro") as TipoEmergencia;
    const focoPlantilla = foco.clave.startsWith("obs_") ? FOCOS_POR_TIPO[tipo][0].clave : foco.clave === "desmentido" ? "comunicado" : foco.clave;
    // Ubicaciones de eventos sin coordenadas ni sufijos "· a N m de …" para que los títulos citen un lugar legible.
    const limpiarLugar = (u?: string) => u?.replace(/\s*\(?-?\d{1,2}[.,]\d+\s*,\s*-?\d{1,3}[.,]\d+\)?/g, "").split(" · ")[0].replace(/[\s,;:-]+$/, "").trim() || undefined;
    const eventosLimpios = eventosInc.map((x) => ({ ...x, ubicacion: limpiarLugar(x.ubicacion) ?? x.ubicacion }));
    const pl = plantillaPorTipo(tipo, focoPlantilla, { ...ctx, eventos: eventosLimpios, incidente: { ...incidente, ubicacion: { ...incidente.ubicacion, nombre: limpiarLugar(incidente.ubicacion.nombre) ?? incidente.ubicacion.nombre } }, version: (anterior?.tarjeta.plan.version ?? 0) + 1 });
    if (foco.clave.startsWith("obs_")) {
      // "<Categoría> en <lugar>: <dato>" para respuestas a observaciones de periféricos
      const ETIQUETA: Record<string, string> = { incendio: "Incendio", humo: "Humo", inundacion: "Inundación", accidente: "Accidente", derrumbe: "Derrumbe", aglomeracion: "Aglomeración", persona_en_peligro: "Persona en peligro", vertido: "Vertido", corte_electrico: "Corte eléctrico", explosion: "Explosión", fuga_gas: "Fuga de gas", terremoto: "Terremoto", ola_calor: "Ola de calor", nevada: "Nevada", accidente_ferroviario: "Accidente ferroviario", amenaza: "Amenaza" };
      const cat = foco.clave.slice(4);
      const lugar = limpiarLugar(eventosInc[0]?.ubicacion) ?? limpiarLugar(incidente.ubicacion.nombre) ?? "ubicación por confirmar";
      const dato = pl.tarjeta.titulo.includes(": ") ? pl.tarjeta.titulo.slice(pl.tarjeta.titulo.lastIndexOf(": ") + 2) : "";
      pl.tarjeta.titulo = `${ETIQUETA[cat] ?? cat.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())} en ${lugar}: primera respuesta${dato ? ` · ${dato}` : ""}`;
    }
    p = { ...pl, modelo: "plantilla-determinista", latenciaMs: Date.now() - t0 };
  }
  // QuiverAI (RAG de protocolos): si responde, su protocolo sustituye al de la propuesta y se cita como evidencia.
  if (protocolosDisponibles()) {
    try {
      const pr = await protocoloAplicable(`${p.tarjeta.titulo}. ${p.tarjeta.resumen}`);
      if (pr) {
        p.tarjeta.protocolo = { codigo: pr.codigo, nombre: pr.nombre };
        const fuente = (pr.fuente === "QuiverAI" ? "QuiverAI" : "Normativa") as Evidencia["fuente"];
        evidencia.push({ id: `ev-quiver-${pr.codigo}`, fuente, descripcion: `Protocolo ${pr.codigo} · ${pr.nombre} (${pr.fuente}): ${pr.extracto.slice(0, 200)}`, valor: pr.codigo, timestamp: ahora(), confianza: 0.85, url: (pr as { url?: string }).url });
        p.evidenciaIds.push(`ev-quiver-${pr.codigo}`);
      }
    } catch (err) {
      console.warn("[quiver]", err instanceof Error ? err.message : err);
    }
  }
  const usada = evidencia.filter((x) => p.evidenciaIds.includes(x.id));
  const d: Decision = {
    id: nuevoId("dec"),
    incidenteId: incidente.id,
    foco: foco.clave,
    creadaEn: ahora(),
    plazo: min(p.plazoMinutos),
    urgencia: p.urgencia,
    riesgo: p.riesgo,
    costeDeNoActuar: p.costeDeNoActuar,
    tarjeta: p.tarjeta,
    evidencia: usada.length ? usada : evidencia,
    reglasAplicadas: doctrina.map((r) => r.id),
    estado: "pendiente",
    procesadoPor: [{ modelo: p.modelo, latenciaMs: p.latenciaMs, tarea: "plan" }],
    alternativasDescartadas: p.alternativasDescartadas,
    categorias: (p as { categorias?: string[] }).categorias?.filter(esCategoriaId),
    rutas: await rutasParaDecision(e, foco.clave),
  };
  marcarAplicadas(e, d.reglasAplicadas);
  if (e.decisiones.some((x) => x.id === d.id)) throw new Error(`Decisión duplicada ${d.id}`);
  e.decisiones.unshift(d);
  incidente.focosPropuestos = Array.from(new Set([...(incidente.focosPropuestos ?? []), foco.clave]));
  registrar(e, "propuesta", `Propuesta ${p.generadaPor === "claude" ? "(Claude)" : p.generadaPor === "ollama" ? "(Ollama local)" : "(plantilla)"}: ${d.tarjeta.titulo} · urgencia ${d.urgencia}, riesgo ${d.riesgo}`, d.id);

  // Política de autonomía (qué puede gestionar la IA y qué exige firma humana): lib/politica-autonomia.ts
  const v = evaluarCompetencia(d, await politicaActual(), e.umbralAutonomia);
  d.competencia = v;
  d.riesgo = v.riesgoEfectivo; // max(riesgo IA, suelo de la categoría más grave): exigirDecidir/escalarA siguen valiendo
  registrar(e, "propuesta", v.motivo, d.id);

  if (v.modo === "autonoma") {
    d.estado = "ejecutando";
    d.resultadoEjecucion = await ejecutarDecision(d);
    d.estado = "auto";
    d.decididaPor = { rol: e.rolActivo, timestamp: ahora(), via: "panel" };
    registrar(e, "auto", `Ejecutada automáticamente (riesgo ${d.riesgo} ≤ umbral ${e.umbralAutonomia}): ${d.tarjeta.titulo}`, d.id);
    actaDecision(e, d);
  }
  return d;
}

async function aplicarPaso(e: EstadoSistema, tick: number) {
  const paso = GUION.find((p) => p.tick === tick);
  let giro = paso?.giroViento;
  if (giro) {
    // Con coordenadas reales, el viento se fuerza DESDE el rumbo opuesto al hospital para que el humo lo alcance.
    const hosp = e.nodos.find((n) => n.id === "Infraestructuras/hosp-gregorio" && typeof n.lat === "number" && typeof n.lon === "number");
    if (hosp) giro = { ...giro, direccionGrados: Math.round((rumboEntre(e.incidente.ubicacion, { lat: hosp.lat!, lon: hosp.lon! }) + 180) % 360) };
  }
  const evidenciaEntorno = await refrescarEntorno(e, giro);
  if (!paso) return;
  if (paso.fase) e.incidente.fase = paso.fase;
  if (paso.eventos) {
    const nuevos = paso.eventos(ahora());
    for (const x of nuevos) {
      await procesarEvento(x, e.eventos);
      e.eventos.unshift(x);
      registrar(e, "evento", `[${x.fuente}] ${x.titulo}${x.verificacion && x.verificacion.estado !== "verificado" ? ` (${x.verificacion.estado})` : ""}`, x.id);
    }
  }
  if (paso.giroViento) {
    registrar(e, "sistema", `Cambio de condiciones: el viento rola a ${e.entorno.viento.direccionTexto} (${paso.giroViento.velocidadKmh} km/h) y el humo avanza hacia el Hospital Gregorio Marañón. Revisión de planes.`);
    for (const d of e.decisiones) {
      if (d.estado === "pendiente" && paso.invalidarFocos?.includes(d.foco)) {
        d.estado = "invalidada";
        d.motivoInvalidacion = `El viento ha rolado a ${e.entorno.viento.direccionTexto} (${e.entorno.viento.velocidadKmh} km/h) y el humo avanza hacia el Hospital Gregorio Marañón; las hipótesis de esta propuesta ya no se cumplen.`;
        registrar(e, "invalidada", `Propuesta invalidada por cambio de viento: ${d.tarjeta.titulo}`, d.id);
      }
    }
  }
  if (paso.foco) await crearDecision(e, paso.foco, evidenciaEntorno);
  // Civilian tasking: tareas de bajo riesgo para voluntarios, propuestas por la IA
  e.tareasVoluntarios = e.tareasVoluntarios ?? [];
  for (const t of TAREAS_GUION.filter((x) => x.tick === tick)) {
    const tarea = { ...t.tarea, id: nuevoId("tv"), incidenteId: e.incidente.id, aceptados: 0, estado: "propuesta" as const, creadaEn: ahora(), riesgo: "bajo" as const };
    e.tareasVoluntarios.push(tarea);
    registrar(e, "propuesta", `Tarea para voluntarios propuesta: ${tarea.titulo} (cupo ${tarea.cupo})`, tarea.id);
  }
  for (const msg of simularAceptaciones(e.tareasVoluntarios)) registrar(e, "sistema", msg);
  if (paso.sitrep) sitrep(e);
}

// ---------------------------------------------------------------------------
// Estado inicial / API pública del motor
// ---------------------------------------------------------------------------
/** Grafo base de la spec con coordenadas reales de OSM (lib/server/geo/nodos-osm.ts) y x,y reproyectados. Lo sustituye construirGrafoReal() cuando poc-07 lo aplique. */
function nodosBaseConCoordenadas(): NodoGrafo[] {
  try {
    const centro = { lat: COORDS_OSM["Incidencias/inc-2049"].lat, lon: COORDS_OSM["Incidencias/inc-2049"].lon };
    const conCoords = NODOS.map((n) => {
      const c = COORDS_OSM[n.id];
      return c ? { ...n, lat: c.lat, lon: c.lon, osmId: c.osmId, origen: "OSM" as const, detalle: c.nombreOsm } : n;
    });
    // El Centro 112 (Pozuelo, a 10 km) arrastraría la escala: se reproyecta el resto y el 112 se fija en el borde ONO del lienzo.
    const LEJANOS = new Set(["Infraestructuras/cecom-112"]);
    const coordsCercanas = Object.fromEntries(Object.entries(COORDS_OSM).filter(([id]) => !LEJANOS.has(id)));
    const reproyectados = reproyectarNodos(conCoords.filter((n) => !LEJANOS.has(n.id)), coordsCercanas, centro);
    const lejanos = conCoords.filter((n) => LEJANOS.has(n.id)).map((n) => ({ ...n, x: 8, y: 30 }));
    return [...reproyectados, ...lejanos];
  } catch (err) {
    console.warn("[grafo] coordenadas OSM no aplicadas:", err instanceof Error ? err.message : err);
    return NODOS;
  }
}

async function fabricaInicial(): Promise<EstadoSistema> {
  const e: EstadoSistema = {
    organismo: organismo(),
    incidente: { ...INCIDENTE_BASE, iniciadoEn: ahora(), tick: 0, fase: "deteccion", activo: true },
    entorno: { viento: { velocidadKmh: 12, direccionGrados: 225, direccionTexto: "SO", fuente: "Escenario", timestamp: ahora() } },
    eventos: [],
    nodos: nodosBaseConCoordenadas(),
    aristas: ARISTAS,
    decisiones: [],
    doctrina: [],
    informes: [],
    timeline: [],
    umbralAutonomia: 20,
    // La demo vive sola: el escenario avanza cada 40 s (Pausa/Reanudar en la barra superior).
    autoAvance: true,
    intervaloSeg: 40,
    rolActivo: "director_tecnico",
    modoDatos: "sin_datos",
    proveedorEjecucion: proveedorDisponible(),
    iaDisponible: iaDisponible(),
    actualizadoEn: ahora(),
    serverTime: ahora(),
  };
  // El viento inicial se sustituye por el real en refrescarEntorno (fuente "Escenario" solo si falla).
  e.entorno.viento.fuente = "OpenMeteo";
  registrar(e, "sistema", "Centro de mando inicializado. Escenario: incendio industrial Méndez Álvaro 56.");
  // Grafo real de la ciudad (OpenStreetMap, poc-07): nunca lanza; si falla se mantienen los nodos base con coordenadas OSM.
  try {
    const m = await meteoActual(e.incidente.ubicacion.lat, e.incidente.ubicacion.lon).catch(() => null);
    const g = await construirGrafoReal(e.incidente.ubicacion, { incidente: { id: INCIDENTE_BASE.id, nombre: INCIDENTE_BASE.titulo }, viento: m ? { direccionGrados: m.direccionGrados, velocidadKmh: m.vientoKmh } : undefined });
    if (g?.nodos?.length) {
      e.nodos = g.nodos;
      e.aristas = g.aristas;
      registrar(e, "sistema", `Grafo real cargado: ${g.nodos.length} vértices, ${g.aristas.length} aristas (origen ${g.origen})`);
    }
  } catch (err) {
    console.warn("[grafo-real]", err instanceof Error ? err.message : err);
  }
  await aplicarPaso(e, 0);
  return e;
}

export function organismo() {
  const env = (k: string, def: string) => process.env[k]?.trim() || def;
  return { nombre: env("ORGANISMO_NOMBRE", "Ayuntamiento de Madrid"), servicio: env("ORGANISMO_SERVICIO", "Emergencias Madrid · SAMUR-PC"), municipio: env("ORGANISMO_MUNICIPIO", "Madrid") };
}

/** Devuelve un SNAPSHOT clonado y normalizado: la respuesta HTTP nunca comparte referencia con el estado vivo. */
function decorar(vivo: EstadoSistema): EstadoSistema {
  const e = structuredClone(vivo);
  e.serverTime = ahora();
  e.version = versionEstado();
  e.rolActivo = normalizarRol(e.rolActivo);
  e.organismo = organismo();
  e.decisiones = dedupePorId(e.decisiones);
  e.eventos = dedupePorId(e.eventos);
  e.informes = dedupePorId(e.informes);
  e.doctrina = dedupePorId(e.doctrina);
  if (e.tareasVoluntarios) e.tareasVoluntarios = dedupePorId(e.tareasVoluntarios);
  e.proveedorEjecucion = proveedorDisponible();
  e.iaDisponible = iaDisponible();
  e.conectores = { ...estadoConectores(), elevenlabs: elevenlabsDisponible(), happyrobot: happyrobotDisponible() };
  e.conectoresDetalle = detalleConectores();
  e.incidentes = e.incidentes?.length ? e.incidentes : [e.incidente];
  e.simulacion = estadoSimulacion(e.incidente.tick);
  return e;
}

export async function obtenerEstado(): Promise<EstadoSistema> {
  // Las lecturas NO esperan al bloqueo: si el estado ya está cargado se sirve un clon inmediato
  // (una mutación larga en curso —LLM, OSRM— no debe congelar /api/estado ni el stream).
  let snapshot: EstadoSistema;
  try {
    snapshot = decorar(estadoActual());
  } catch {
    snapshot = await conBloqueo(async () => decorar(await cargarEstado(fabricaInicial)));
  }
  asegurarTemporizador();
  return snapshot;
}

export async function avanzar(): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    if (e.incidente.tick >= TICK_MAX) {
      e.incidente.activo = false;
      await guardar();
      return decorar(e);
    }
    const objetivo = e.incidente.tick + 1;
    e.incidente.tick = objetivo;
    await aplicarPaso(e, objetivo);
    await guardar();
    return decorar(e);
  });
}

export async function reiniciar(): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const nuevo = await fabricaInicial();
    reemplazarEstado(nuevo);
    await guardar();
    return decorar(nuevo);
  });
}

export async function aprobar(id: string, rol: Rol, via: "panel" | "voz" = "panel"): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    const d = e.decisiones.find((x) => x.id === id);
    if (!d) throw new Error(`Decisión ${id} no encontrada`);
    if (d.estado !== "pendiente") throw new Error(`La decisión está en estado ${d.estado}`);
    d.estado = "ejecutando";
    d.decididaPor = { rol, timestamp: ahora(), via };
    registrar(e, "aprobada", `${rol} aprueba: ${d.tarjeta.titulo}`, d.id);
    await guardar();
    d.resultadoEjecucion = await ejecutarDecision(d);
    if (/comunicado|desmentido/.test(d.foco)) {
      try {
        await publicarComunicado(d.tarjeta.plan.mensajeAlerta, e.organismo.servicio);
        registrar(e, "ejecutada", "Comunicado oficial publicado en el muro y en el portal ciudadano", d.id);
      } catch (err) {
        console.warn("[comunicado]", err instanceof Error ? err.message : err);
      }
    }
    d.audiosAlerta = await generarAudios(d);
    if (d.audiosAlerta.length) registrar(e, "ejecutada", `Alertas de voz generadas en ${d.audiosAlerta.map((a) => a.idioma).join("/")} (ElevenLabs)`, d.id);
    d.estado = "ejecutada";
    const ok = d.resultadoEjecucion.filter((r) => r.ok && r.canal !== "interno").length;
    registrar(e, "ejecutada", `Ejecutada (${ok} acción(es) externa(s) vía ${proveedorDisponible()}): ${d.tarjeta.titulo}`, d.id);
    actaDecision(e, d);
    await guardar();
    return decorar(e);
  });
}

export async function escalar(id: string, a: Rol, por: Rol): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    const d = e.decisiones.find((x) => x.id === id);
    if (!d) throw new Error(`Decisión ${id} no encontrada`);
    if (d.estado !== "pendiente") throw new Error(`La decisión está en estado ${d.estado}`);
    const { ROLES } = await import("../roles");
    d.escaladaA = { rol: a, por, timestamp: ahora(), via: "panel" };
    registrar(e, "sistema", `Escalada a ${ROLES[a].nombre} por ${ROLES[por].nombre}: ${d.tarjeta.titulo}`, d.id);
    if (proveedorDisponible() === "HappyRobot") {
      const r = await llamarCargo(d, a);
      d.escaladaA.via = "voz";
      d.escaladaA.ref = r.ref;
      registrar(e, "sistema", r.ok ? `HappyRobot llama a ${ROLES[a].nombre} para aprobación por voz (ref ${r.ref})` : `Fallo al llamar a ${ROLES[a].nombre}: ${r.detalle}`, d.id);
    }
    await guardar();
    return decorar(e);
  });
}

export async function denegar(id: string, feedback: string, rol: Rol, ambito: "incidente" | "global" = "global"): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    const d = e.decisiones.find((x) => x.id === id);
    if (!d) throw new Error(`Decisión ${id} no encontrada`);
    if (d.estado !== "pendiente") throw new Error(`La decisión está en estado ${d.estado}`);
    const texto = feedback.trim();
    if (!texto) throw new Error("El feedback es obligatorio al denegar");
    d.estado = "denegada";
    d.feedback = texto;
    d.decididaPor = { rol, timestamp: ahora(), via: "panel" };
    registrar(e, "denegada", `${rol} deniega "${d.tarjeta.titulo}": ${texto}`, d.id);
    const normalizada = await normalizarRegla(texto, normalizarSinLLM);
    crearRegla(e, d, texto, rol, normalizada, ambito);
    actaDecision(e, d);
    await guardar();
    // Nueva propuesta para el mismo foco, respetando la doctrina ampliada.
    const paso = GUION.find((p) => p.foco?.clave === d.foco);
    const evidenciaEntorno = await refrescarEntorno(e);
    await crearDecision(e, paso?.foco ?? { clave: d.foco, descripcion: d.tarjeta.titulo }, evidenciaEntorno, d, texto);
    await guardar();
    return decorar(e);
  });
}

/** Aplica un grafo (real, OSM) sin reset: conserva los vértices de incidencias creados por observaciones y sus aristas. */
export async function aplicarGrafo(nodos: NodoGrafo[], aristas: AristaGrafo[], origen = "OSM"): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    const ids = new Set(nodos.map((n) => n.id));
    const conservar = e.nodos.filter((n) => !ids.has(n.id) && (n.origen === "periferico" || /^Incidencias\/(per|obs|inc-mu)/.test(n.id)));
    const conservarIds = new Set(conservar.map((n) => n.id));
    const aristasConservadas = e.aristas.filter((a) => (conservarIds.has(a.from) || conservarIds.has(a.to)) && (ids.has(a.from) || conservarIds.has(a.from)) && (ids.has(a.to) || conservarIds.has(a.to)));
    e.nodos = dedupePorId([...nodos, ...conservar]);
    const clave = (a: AristaGrafo) => `${a.from}>${a.to}>${a.tipo}`;
    const vistas = new Set<string>();
    e.aristas = [...aristas, ...aristasConservadas].filter((a) => (vistas.has(clave(a)) ? false : (vistas.add(clave(a)), true)));
    const { arangoConfigurado, sembrarArango } = await import("./grafoArango");
    if (arangoConfigurado()) {
      try {
        await sembrarArango(e.nodos, e.aristas, { forzar: true });
      } catch (err) {
        console.warn("[aplicarGrafo] arango:", err instanceof Error ? err.message : err);
      }
    }
    actualizarPenacho(e);
    registrar(e, "sistema", `Grafo real aplicado: ${e.nodos.length} vértices, ${e.aristas.length} aristas (origen ${origen})`);
    await guardar();
    return decorar(e);
  });
}

export async function configurar(cambios: Partial<Pick<EstadoSistema, "umbralAutonomia" | "rolActivo" | "autoAvance" | "intervaloSeg">>): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    if (typeof cambios.umbralAutonomia === "number") e.umbralAutonomia = Math.max(0, Math.min(100, cambios.umbralAutonomia));
    if (cambios.rolActivo) e.rolActivo = normalizarRol(cambios.rolActivo);
    if (typeof cambios.autoAvance === "boolean") e.autoAvance = cambios.autoAvance;
    if (typeof cambios.intervaloSeg === "number") e.intervaloSeg = Math.max(10, cambios.intervaloSeg);
    registrar(e, "sistema", `Configuración: umbral ${e.umbralAutonomia}, rol ${e.rolActivo}, auto-avance ${e.autoAvance ? "ON" : "OFF"} cada ${e.intervaloSeg} s`);
    await guardar();
    return decorar(e);
  });
}

export async function desactivarRegla(id: string, activa = false): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    const r = e.doctrina.find((x) => x.id === id);
    if (!r) throw new Error(`Regla ${id} no encontrada`);
    r.activa = activa;
    registrar(e, "regla", `Regla ${activa ? "reactivada" : "desactivada"}: ${r.reglaNormalizada}`, r.id);
    await guardar();
    return decorar(e);
  });
}

export async function generarSitrep(): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    sitrep(e);
    await guardar();
    return decorar(e);
  });
}

/** Webhook de ingesta (HappyRobot u otro canal): crea evento y, si procede, una decisión. */
export async function ingestaExterna(p: { fuente?: EventoIngesta["fuente"]; titulo: string; detalle: string; ubicacion?: string; confianza?: number; pedirDecision?: boolean; foco?: string }): Promise<EstadoSistema> {
  const r = await ingestarObservacion({ id: nuevoId("ev"), fuente: p.fuente ?? "HappyRobot", timestamp: ahora(), titulo: p.titulo, detalle: p.detalle, confianza: p.confianza ?? 0.8, ubicacion: p.ubicacion }, { pedirDecision: p.pedirDecision || undefined, foco: p.foco });
  return r.estado;
}

/**
 * Ingesta de una observación completa (periféricos: móvil, cámara de tráfico, publicación).
 * Acepta el EventoIngesta ya construido (imagenUrl, geo, etiquetas, verificacion precalculada…),
 * puede añadir vértice/aristas al grafo, invalidar decisiones y pedir una decisión nueva.
 */
export async function ingestarObservacion(
  evento: EventoIngesta,
  opts: { pedirDecision?: boolean; foco?: string; descripcionFoco?: string; origenDomino?: string; nodoNuevo?: NodoGrafo; aristasNuevas?: AristaGrafo[]; invalidarFocos?: string[]; motivoInvalidacion?: string } = {},
): Promise<{ estado: EstadoSistema; eventoId: string; decisionId?: string }> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    const x: EventoIngesta = { ...evento, id: evento.id || nuevoId("ev"), timestamp: evento.timestamp || ahora() };
    // 1) grafo: vértice y aristas nuevas (dedupe)
    if (opts.nodoNuevo && !e.nodos.some((n) => n.id === opts.nodoNuevo!.id)) {
      e.nodos = [...e.nodos, opts.nodoNuevo];
      registrar(e, "sistema", `Nuevo vértice en el grafo: ${opts.nodoNuevo.nombre} (${opts.nodoNuevo.tipo})`, opts.nodoNuevo.id);
    }
    if (opts.aristasNuevas?.length) {
      const existentes = new Set(e.aristas.map((a) => `${a.from}>${a.to}>${a.tipo}`));
      e.aristas = [...e.aristas, ...opts.aristasNuevas.filter((a) => !existentes.has(`${a.from}>${a.to}>${a.tipo}`))];
    }
    // 2) router (respeta verificacion/procesadoPor que ya vengan) · 3) registro
    await procesarEvento(x, e.eventos);
    if (e.eventos.some((y) => y.id === x.id)) throw new Error(`Evento duplicado ${x.id}`);
    e.eventos.unshift(x);
    registrar(e, "evento", `[${x.fuente}] ${x.titulo}${x.verificacion && x.verificacion.estado !== "verificado" ? ` (${x.verificacion.estado})` : ""}`, x.id);
    // 4) invalidaciones
    if (opts.invalidarFocos?.length) {
      for (const d of e.decisiones) {
        if (d.estado === "pendiente" && opts.invalidarFocos.includes(d.foco)) {
          d.estado = "invalidada";
          d.motivoInvalidacion = opts.motivoInvalidacion ?? `Nueva observación: ${x.titulo}`;
          registrar(e, "invalidada", `Propuesta invalidada por nueva observación: ${d.tarjeta.titulo}`, d.id);
        }
      }
    }
    // 5) MOTOR POR EVENTOS: clasificar → asignar a incidente → siguiente foco del tipo → decisión nueva o confirmación de la pendiente
    let decisionId: string | undefined;
    const fiable = x.verificacion?.estado !== "sospechoso" && x.verificacion?.estado !== "duplicado";
    const cls = clasificarEmergencia({ titulo: x.titulo, detalle: x.detalle, categoria: x.categoria, etiquetas: x.etiquetas, sensor: sensorDe(x) });
    if (fiable && (cls.tipo !== "otro" || opts.pedirDecision)) {
      const nodoId = opts.nodoNuevo?.id ?? opts.origenDomino ?? nodoDeUbicacion(e.nodos, x.ubicacion);
      const coords = coordsEvento(x, e.nodos, nodoId);
      const severidad = /critic|explosi|atrapad|herid|muert/i.test(`${x.titulo} ${x.detalle}`) ? "critica" : x.confianza >= 0.85 ? "alta" : "media";
      const { incidente, nuevo } = asignarIncidente(e, x, cls.tipo, { coords, nodoId, severidad, simulacro: x.etiquetas?.includes("simulacro") });
      // Incidente nuevo sin nombre de lugar (solo coordenadas): geocodificación inversa (Nominatim, con límite de tiempo).
      if (coords && ES_COORDENADA.test(incidente.ubicacion.nombre)) {
        try {
          const nombre = await conLimite(geocodificarInverso(coords.lat, coords.lon), 5000, "nominatim-inverso");
          incidente.ubicacion.nombre = nombre;
          incidente.titulo = tituloIncidente(cls.tipo, nombre);
        } catch (err) {
          console.warn("[incidente] geocodificación inversa:", err instanceof Error ? err.message : err);
        }
      }
      if (x.geo && !x.ubicacion) x.ubicacion = incidente.ubicacion.nombre;
      const focoElegido = opts.foco ? { clave: opts.foco, descripcion: opts.descripcionFoco ?? `${x.titulo}. ${x.detalle}` } : focoSiguiente(cls.tipo, incidente.focosPropuestos ?? [], x);
      // Una sola propuesta pendiente por (incidente, foco); también se evita repetir un título idéntico pendiente en cualquier incidente.
      const pendienteMismoFoco = focoElegido
        ? e.decisiones.find((d) => d.estado === "pendiente" && ((d.incidenteId === incidente.id && d.foco === focoElegido.clave) || (d.foco === focoElegido.clave && incidente.tipo === (e.incidentes?.find((i) => i.id === d.incidenteId)?.tipo ?? e.incidente.tipo) && distanciaIncidentes(e, d.incidenteId, incidente) < 1500)))
        : undefined;
      const pedir = opts.pedirDecision ?? (nuevo || cls.confianza >= 0.5);
      if (pendienteMismoFoco) {
        // Confirma/agrava la propuesta pendiente: se añade la nueva evidencia sin duplicar la decisión.
        pendienteMismoFoco.evidencia = [...evidenciaDeEventos([x], e.nodos), ...pendienteMismoFoco.evidencia].slice(0, 20);
        registrar(e, "sistema", `Evento confirma la propuesta pendiente "${pendienteMismoFoco.tarjeta.titulo}" (${cls.tipo}, ${Math.round(cls.confianza * 100)} %)`, pendienteMismoFoco.id);
        decisionId = pendienteMismoFoco.id;
      } else if (pedir && focoElegido) {
        const evidenciaEntorno = await refrescarEntorno(e);
        const d = await crearDecision(e, focoElegido, evidenciaEntorno, undefined, undefined, opts.origenDomino, incidente);
        decisionId = d?.id;
      } else {
        registrar(e, "sistema", `Evento registrado en ${incidente.titulo} (${cls.tipo}, ${Math.round(cls.confianza * 100)} %): ${cls.motivo}`, x.id);
      }
    }
    // 6) persistir
    await guardar();
    return { estado: decorar(e), eventoId: x.id, decisionId };
  });
}

/** Webhook de resultado (HappyRobot devuelve el resultado de una llamada/mensaje). */
export async function resultadoExterno(p: { decisionId: string; accionId: string; ref: string; ok: boolean; detalle: string; canal?: ResultadoAccion["canal"] }): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    const d = e.decisiones.find((x) => x.id === p.decisionId);
    if (!d) throw new Error(`Decisión ${p.decisionId} no encontrada`);
    d.resultadoEjecucion = d.resultadoEjecucion ?? [];
    const prev = d.resultadoEjecucion.find((r) => r.accionId === p.accionId);
    const r: ResultadoAccion = { accionId: p.accionId, canal: p.canal ?? prev?.canal ?? "voz", proveedor: "HappyRobot", ref: p.ref, ok: p.ok, detalle: p.detalle, timestamp: ahora() };
    if (prev) Object.assign(prev, r);
    else d.resultadoEjecucion.push(r);
    registrar(e, "ejecutada", `Resultado HappyRobot (${r.canal}) para "${d.tarjeta.titulo}": ${p.detalle}`, d.id);
    await guardar();
    return decorar(e);
  });
}

export async function tareaVoluntarios(id: string, accion: "publicar" | "cancelar" | "aceptar"): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    const t = e.tareasVoluntarios?.find((x) => x.id === id);
    if (!t) throw new Error(`Tarea ${id} no encontrada`);
    if (accion === "aceptar") {
      if (t.estado !== "abierta") throw new Error(t.estado === "cubierta" ? "La tarea ya tiene el cupo completo" : `La tarea no está abierta (${t.estado})`);
      t.aceptados += 1;
      if (t.aceptados >= t.cupo) {
        t.estado = "cubierta";
        registrar(e, "sistema", `Tarea cubierta: ${t.titulo} (${t.aceptados}/${t.cupo} voluntarios)`, t.id);
      } else {
        registrar(e, "sistema", `Un ciudadano se apunta a "${t.titulo}" (${t.aceptados}/${t.cupo})`, t.id);
      }
    } else if (accion === "publicar") {
      if (t.estado !== "propuesta") throw new Error(`La tarea está en estado ${t.estado}`);
      t.estado = "abierta";
      registrar(e, "aprobada", `Tarea publicada a voluntarios: ${t.titulo}`, t.id);
    } else {
      if (t.estado === "cubierta" || t.estado === "cancelada") throw new Error(`La tarea está en estado ${t.estado}`);
      const era = t.estado;
      t.estado = "cancelada";
      registrar(e, "denegada", `Tarea ${era === "propuesta" ? "descartada" : "cancelada"}: ${t.titulo}`, t.id);
    }
    await guardar();
    return decorar(e);
  });
}

export async function cerrarIncidente(id?: string): Promise<EstadoSistema> {
  return conBloqueo(async () => {
    const e = await cargarEstado(fabricaInicial);
    e.incidentes = e.incidentes?.length ? e.incidentes : [e.incidente];
    const inc = id ? e.incidentes.find((i) => i.id === id) : e.incidentes.find((i) => i.id === e.incidente.id) ?? e.incidente;
    if (!inc) throw new Error(`Incidente ${id} no encontrado`);
    if (!inc.activo) throw new Error("La incidencia ya está cerrada");
    inc.activo = false;
    inc.fase = "cierre";
    if (inc.id === e.incidente.id) {
      e.incidente.activo = false;
      e.incidente.fase = "cierre";
    }
    for (const d of e.decisiones) {
      if (d.estado === "pendiente" && d.incidenteId === inc.id) {
        d.estado = "invalidada";
        d.motivoInvalidacion = "Incidencia cerrada sin decisión.";
      }
    }
    registrar(e, "sistema", `Incidencia cerrada por el mando: ${inc.titulo}. Generando post-mortem.`, inc.id);
    // El incidente "activo" de la UI pasa al siguiente más grave; si no queda ninguno, se detiene el auto-avance.
    const siguiente = elegirIncidenteActivo(e);
    if (siguiente) e.incidente = siguiente;
    else e.autoAvance = false;
    const lec = await lecciones(e);
    postMortem(e, lec);
    await guardar();
    return decorar(e);
  });
}

// ---------------------------------------------------------------------------
// Auto-avance del escenario
// ---------------------------------------------------------------------------
type G = typeof globalThis & { __crisisTimer?: ReturnType<typeof setInterval>; __crisisUltimoTick?: number; __crisisTimerVersion?: number };
const VERSION_TIMER = Date.now(); // cambia en cada recarga del módulo (HMR): el temporizador se recrea con el código nuevo
function asegurarTemporizador() {
  const g = globalThis as G;
  if (g.__crisisTimer && g.__crisisTimerVersion === VERSION_TIMER) return;
  if (g.__crisisTimer) clearInterval(g.__crisisTimer);
  g.__crisisTimerVersion = VERSION_TIMER;
  g.__crisisUltimoTick = Date.now();
  g.__crisisTimer = setInterval(async () => {
    try {
      const e = estadoActual();
      // Mantenimiento: incidentes que aún muestran coordenadas reciben nombre de lugar (Nominatim inverso).
      if ((e.incidentes ?? [e.incidente]).some((i) => ES_COORDENADA.test(i.ubicacion.nombre))) {
        await conBloqueo(async () => {
          await nombrarIncidentesSinLugar(estadoActual());
          await guardar();
        });
      }
      if (!e.autoAvance || !e.incidente.activo) return;
      if (Date.now() - (g.__crisisUltimoTick ?? 0) < e.intervaloSeg * 1000) return;
      g.__crisisUltimoTick = Date.now();
      await avanzar();
    } catch (err) {
      console.error("[auto-avance]", err instanceof Error ? err.message : err);
    }
  }, 5000);
}
