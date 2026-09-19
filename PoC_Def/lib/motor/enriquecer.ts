// =====================================================================
// ATALAYA INCENDIOS · Enriquecimiento de un foco con datos reales
// ---------------------------------------------------------------------
// Propósito: en cuanto se declara un incendio, rellenarlo con datos de
// fuentes REALES (Nominatim, Overpass, Open-Meteo, cámaras DGT) y crear
// las entidades operativas (poblaciones, unidades, hospitales, cámaras).
// DUEÑO: constructor A. Dependencias externas: lib/fuentes/* (constructor B).
//
// Reglas: cada paso es independiente y tolerante. Si una fuente falla, se
// marca en rojo en la barra de servicios (estado.marcarServicio) y se sigue
// con el resto: nunca se inventa un valor.
// =====================================================================

import type {
  Combustible,
  Hospital,
  Incendio,
  Poblacion,
  Punto,
  Trazado,
  Unidad,
} from "../dominio/tipos";
import type { Estado } from "./estado";
import { fuenteActiva } from "../dominio/fuentes-deteccion";
import { municipioDe } from "../fuentes/nominatim";
import { combustibleCercano, mediosCercanos, poblacionesCercanas, type BaseMedios, type PoblacionBase } from "../fuentes/overpass";
import { elevacion, meteoActual } from "../fuentes/openMeteo";
import { calcularPeligro } from "../fuentes/peligro";
import { listarCamaras } from "../fuentes/dgtCamaras";
import { riesgoPorDistancia } from "../simulacion/propagacion";

// ---------------------------------------------------------------------
// Geometría (compartida con el orquestador)
// ---------------------------------------------------------------------

const RADIO_TIERRA_KM = 6371.0088;

export function distanciaKm(a: Punto, b: Punto): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rumbo (0-360) desde `a` hacia `b`, 0 = norte. */
export function rumboGrados(a: Punto, b: Punto): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const ROSA = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

export function rumboTexto(grados: number): string {
  return ROSA[Math.round(((grados % 360) + 360) % 360 / 22.5) % 16];
}

/** Polígono circular cerrado alrededor de un punto (para el perímetro inicial). */
export function circulo(centro: Punto, radioM: number, vertices = 24): Trazado {
  const puntos: Trazado = [];
  const cosLat = Math.max(0.01, Math.cos((centro.lat * Math.PI) / 180));
  for (let i = 0; i < vertices; i++) {
    const a = (2 * Math.PI * i) / vertices;
    puntos.push([
      centro.lat + (radioM * Math.cos(a)) / 111_320,
      centro.lon + (radioM * Math.sin(a)) / (111_320 * cosLat),
    ]);
  }
  puntos.push(puntos[0]);
  return puntos;
}

/** Hectáreas de un círculo de radio dado en metros. */
export function areaHaCirculo(radioM: number): number {
  return Number(((Math.PI * radioM * radioM) / 10_000).toFixed(2));
}

/**
 * Riesgo inicial de una población por distancia al foco, hasta que el analista
 * de propagación calcule el tiempo de llegada del frente.
 * MODIFICADO (sesión riesgo-fundado, 2026-09-19): aquí decía "< 3 km inminente,
 * < 8 alto, < 15 medio". Como el analista solo refina los focos OPERATIVOS, un
 * píxel de satélite SIN CONFIRMAR dejaba decenas de pueblos en "Riesgo
 * inminente" sin frente, sin meteo y sin nada que lo sustentara (lo vio Javi en
 * Tarragona: 59 "pueblos en peligro" de una refinería). Ahora es el MISMO
 * criterio de proximidad del modelo (`lib/simulacion/propagacion.ts`: < 1 km
 * alto, < 3 km medio, resto bajo): "inminente" solo lo pone el analista con un
 * tiempo de llegada < 60 min o el frente encima.
 */
export { riesgoPorDistancia };

/** Frase provisional que ve el usuario hasta que el analista recalcule el riesgo. */
function motivoProvisional(km: number, incendio: Incendio): string {
  const base = `Riesgo provisional por distancia (a ${km.toFixed(1)} km del foco), todavía sin análisis de propagación`;
  return incendio.estado === "detectado"
    ? `${base}. El foco está SIN CONFIRMAR (una sola fuente): no se avisa a nadie hasta que otra fuente o el mando lo confirme.`
    : `${base}; el analista lo recalcula con viento, humedad, pendiente y combustible en cuanto tenga la meteo del foco.`;
}

// ---------------------------------------------------------------------
// Caché en memoria de la lista completa de cámaras (la fuente pide no abusar)
// ---------------------------------------------------------------------

const CACHE_CAMARAS_MS = 10 * 60 * 1000;
let cacheCamaras: { en: number; lista: Awaited<ReturnType<typeof listarCamaras>> } | undefined;

async function camarasCacheadas() {
  if (cacheCamaras && Date.now() - cacheCamaras.en < CACHE_CAMARAS_MS) return cacheCamaras.lista;
  const lista = await listarCamaras();
  cacheCamaras = { en: Date.now(), lista };
  return lista;
}

// ---------------------------------------------------------------------
// Enriquecimiento
// ---------------------------------------------------------------------

/** Distancia máxima a la que una cámara pasa a vigilarse por un foco. */
export const RADIO_CAMARAS_KM = 25;

function telefonoDemo(): string | undefined {
  const t = process.env.DESTINO_DEMO?.trim();
  return t ? t : undefined;
}

/** true si la unidad/población ya está comprometida con otro incendio vivo. */
function ocupadaPorOtroFoco(estado: Estado, incendioId?: string): boolean {
  if (!incendioId) return false;
  const i = estado.incendios.get(incendioId);
  return !!i && !["extinguido", "descartado", "controlado"].includes(i.estado);
}

function crearUnidadesDeParque(base: BaseMedios): Unidad[] {
  const comun = {
    base: { nombre: base.nombre, punto: base.punto, osmId: base.id },
    posicion: base.punto,
    estado: "disponible" as const,
    telefono: base.telefono ?? telefonoDemo(),
    fuente: "OpenStreetMap (Overpass)",
  };
  return [
    {
      ...comun,
      id: `${base.id}:BUL`,
      nombre: `${base.nombre} · BUL`,
      tipo: "bomberos",
      velocidadKmh: 70,
      dotacion: { personas: 5, vehiculos: 1, descripcion: "Autobomba urbana ligera" },
    },
    {
      ...comun,
      id: `${base.id}:BRP`,
      nombre: `${base.nombre} · BRP`,
      tipo: "bomberos",
      velocidadKmh: 70,
      dotacion: { personas: 4, vehiculos: 1, descripcion: "Autobomba rural pesada" },
    },
  ];
}

function crearPatrulla(base: BaseMedios): Unidad {
  return {
    id: `${base.id}:PAT`,
    nombre: `${base.nombre} · Patrulla`,
    tipo: base.tipo === "guardia_civil" || base.tipo === "policia" ? base.tipo : "policia",
    base: { nombre: base.nombre, punto: base.punto, osmId: base.id },
    posicion: base.punto,
    estado: "disponible",
    velocidadKmh: 90,
    dotacion: { personas: 2, vehiculos: 1, descripcion: "Patrulla de orden público y cortes de vía" },
    telefono: base.telefono ?? telefonoDemo(),
    fuente: "OpenStreetMap (Overpass)",
  };
}

function crearAmbulancia(hospital: Hospital): Unidad {
  return {
    id: `${hospital.id}:AMB`,
    nombre: `${hospital.nombre} · Ambulancia`,
    tipo: "ambulancia",
    base: { nombre: hospital.nombre, punto: hospital.punto, osmId: hospital.id },
    posicion: hospital.punto,
    estado: "disponible",
    velocidadKmh: 90,
    dotacion: { personas: 2, vehiculos: 1, descripcion: "Soporte vital básico" },
    telefono: hospital.telefono ?? telefonoDemo(),
    fuente: "OpenStreetMap (Overpass)",
  };
}

function crearPoblacion(base: PoblacionBase, incendio: Incendio): Poblacion {
  const km = distanciaKm(incendio.centro, base.centro);
  const demo = telefonoDemo();
  const telefono = base.telefono ?? demo;
  return {
    id: base.id,
    nombre: base.nombre,
    centro: base.centro,
    tipo: base.tipo,
    habitantes: base.habitantes,
    municipio: base.municipio,
    incendioId: incendio.id,
    distanciaKm: Number(km.toFixed(2)),
    rumboDesdeFuegoGrados: Math.round(rumboGrados(incendio.centro, base.centro)),
    riesgo: riesgoPorDistancia(km),
    motivoRiesgo: motivoProvisional(km, incendio),
    estadoAviso: "sin_avisar",
    telefono,
    telefonoEsDemo: !base.telefono && !!demo,
    email: base.email,
  };
}

/**
 * Enriquece un foco recién declarado. Se llama SIN await desde declararFoco:
 * el incendio ya está en el estado y la pantalla lo ve; esto lo va rellenando.
 */
export async function enriquecerIncendio(estado: Estado, incendioId: string, intento = 0): Promise<void> {
  const inicial = estado.incendios.get(incendioId);
  if (!inicial) return;
  const centro = inicial.centro;
  let combustible: Combustible | undefined;
  let pueblosCreados = 0;
  let unidadesCreadas = 0;
  let camarasVigiladas = 0;
  /** Colegios, residencias y campings: salen de la consulta de medios y se cuelgan del pueblo más cercano tras la tanda. */
  let vulnerablesPendientes: { tipo: string; nombre: string; punto: Punto }[] = [];
  /** Pasos de Overpass que han fallado: deciden si hay reintento y lo dicen en el evento final. */
  const fallos: string[] = [];

  const vivo = () => estado.incendios.get(incendioId);

  // ---------------------------------------------------------------------
  // EN PARALELO (constructor M, 2026-09-19). Antes los seis pasos iban EN
  // SERIE y el foco tardaba lo que tardaban todos sumados. MEDIDO hoy con
  // overpass-api.de caído: Nominatim 0,3 s, medios 7-19 s, pueblos 7-10 s,
  // elevación 0,3 s, meteo 0,5 s, cámaras 1-3 s → 20-35 s en serie, y la
  // prueba (a) exige el entorno en 30 s. Son fuentes DISTINTAS (Nominatim,
  // Overpass, Open-Meteo, DGT), así que no compiten entre ellas.
  // Solo quedan fuera de la tanda:
  //   · el combustible (Overpass otra vez: se lanza después para no ocupar dos
  //     ranuras del mismo espejo a la vez, que es lo que provoca los 429),
  //   · los vulnerables, que necesitan los pueblos Y los medios a la vez.
  // ---------------------------------------------------------------------
  await Promise.allSettled([
    (async () => {
    // ---- (a) municipio / provincia / comunidad -------------------------
    try {
      const lugar = await municipioDe(centro);
      const actual = vivo();
      const nombreProvisional = !actual?.nombre || /^Incendio en /.test(actual.nombre);
      estado.actualizar(estado.incendios, incendioId, {
        municipio: lugar.municipio,
        provincia: lugar.provincia,
        comunidad: lugar.comunidad,
        nombre: nombreProvisional && lugar.municipio ? `Incendio de ${lugar.municipio}` : actual?.nombre,
        actualizadoEn: estado.reloj.ahoraMundo,
      });
      estado.marcarServicio("Nominatim", true, lugar.municipio);
    } catch (e) {
      estado.marcarServicio("Nominatim", false, mensajeDe(e));
    }

    })(),
    (async () => {
    // ---- (b) entorno OSM, en TRES pasos independientes -------------------
    // MOTIVO (constructor M, 2026-09-19): antes era una sola llamada a
    // `entornoIncendio`. Cuando Overpass se caía (hoy overpass-api.de rechaza la
    // conexión) el foco se quedaba a la vez sin unidades, sin pueblos y sin
    // combustible, y con ello se caían las pruebas (a), (b), (f) y (g). Ahora:
    //   b1) MEDIOS   → unidades. Es lo que necesita el ataque inicial, así que va
    //                  primero y en cuanto termina se emite "Entorno cargado".
    //   b2) PUEBLOS  → poblaciones (avisos a la población).
    //   b3) COMBUSTIBLE → nunca bloquea: si falla, el foco sigue sin él.
    // Cada paso falla por su cuenta y se reintenta en el siguiente ciclo.
    // OJO (constructor T, 2026-09-19): aquí había un `const fallos` propio que
    // TAPABA al de la función. Los fallos de medios y de pueblos se anotaban en
    // el array interno, que moría con la función flecha: el evento de cierre
    // decía "Entorno cargado" y NUNCA se programaba el reintento, justo en el
    // caso para el que se escribió. Ahora se usa el `fallos` exterior.

    // ---- (b1) medios: parques, policía, hospitales → UNIDADES -----------
    try {
      const radio = vivo()?.radioOperativoKm ?? 30;
      const medios = await mediosCercanos(centro, radio);

      const nuevasUnidades: Unidad[] = [
        ...medios.parquesBomberos.flatMap((b) => crearUnidadesDeParque(b)),
        ...medios.policia.map((b) => crearPatrulla(b)),
        ...medios.hospitales.map((h) => crearAmbulancia(h)),
      ];
      // Las unidades forman un POOL compartido: `incendioId` solo lo fija el coordinador/despachador
      // al asignarlas (contrato: incendioId = incendio al que está asignada, no "está en su radio").
      for (const u of nuevasUnidades) {
        if (estado.unidades.has(u.id)) continue; // ya existe (de otro foco o de antes): no se toca
        estado.guardar(estado.unidades, u);
        unidadesCreadas += 1;
      }

      // Hospitales
      for (const h of medios.hospitales) {
        const previo = estado.hospitales.get(h.id);
        estado.guardar(estado.hospitales, {
          ...h,
          distanciaKm: Number(distanciaKm(centro, h.punto).toFixed(2)),
          incendioId: previo?.incendioId ?? incendioId,
        });
      }
      vulnerablesPendientes = medios.vulnerables;
      estado.marcarServicio("Overpass medios", true, `${medios.parquesBomberos.length} parques, ${medios.policia.length} policía, ${medios.hospitales.length} hospitales`);

      // Aviso temprano: con unidades en el pool el coordinador ya puede ordenar el
      // ataque inicial; no tiene por qué esperar a los pueblos ni al combustible.
      if (unidadesCreadas > 0 || [...estado.unidades.values()].length > 0) {
        estado.registrarEvento(
          "incendio_actualizado",
          `Entorno cargado: ${unidadesCreadas} unidades disponibles (${medios.parquesBomberos.length} parques de bomberos)`,
          { incendioId, nivel: "info", datos: { fase: "medios", unidades: unidadesCreadas, parques: medios.parquesBomberos.length } },
        );
      }
    } catch (e) {
      fallos.push(`medios: ${mensajeDe(e)}`);
      estado.marcarServicio("Overpass medios", false, mensajeDe(e));
    }

    })(),
    (async () => {
    // ---- (b2) pueblos → POBLACIONES -------------------------------------
    try {
      const radio = vivo()?.radioOperativoKm ?? 30;
      const { poblaciones } = await poblacionesCercanas(centro, radio);

      const poblacionesDelFoco: Poblacion[] = [];
      for (const base of poblaciones) {
        const previa = estado.poblaciones.get(base.id);
        if (previa && ocupadaPorOtroFoco(estado, previa.incendioId) && previa.incendioId !== incendioId) {
          poblacionesDelFoco.push(previa);
          continue; // ya la lleva otro foco: no se le reasigna
        }
        const actualIncendio = vivo();
        if (!actualIncendio) return;
        const pob = crearPoblacion(base, actualIncendio);
        estado.guardar(estado.poblaciones, previa ? { ...previa, ...pob, estadoAviso: previa.estadoAviso } : pob);
        poblacionesDelFoco.push(pob);
        pueblosCreados += 1;
      }

      // Los vulnerables se cuelgan DESPUÉS de la tanda: necesitan también los
      // medios, que se están pidiendo en paralelo con esta consulta.
      void poblacionesDelFoco;
      estado.marcarServicio("Overpass pueblos", true, `${poblaciones.length} pueblos`);
    } catch (e) {
      fallos.push(`pueblos: ${mensajeDe(e)}`);
      estado.marcarServicio("Overpass pueblos", false, mensajeDe(e));
    }

    })(),
    (async () => {
    // ---- (c) elevación --------------------------------------------------
    try {
      const m = await elevacion(centro);
      estado.actualizar(estado.incendios, incendioId, { elevacionM: Math.round(m) });
      estado.marcarServicio("Open-Meteo elevación", true, `${Math.round(m)} m`);
    } catch (e) {
      estado.marcarServicio("Open-Meteo elevación", false, mensajeDe(e));
    }

    })(),
    (async () => {
    // ---- (d) meteorología + índice de peligro ---------------------------
    try {
      const meteo = await meteoActual(centro);
      const peligro = calcularPeligro(meteo, combustible ?? vivo()?.combustible);
      estado.actualizar(estado.incendios, incendioId, { meteo, peligro, actualizadoEn: estado.reloj.ahoraMundo });
      estado.marcarServicio("Open-Meteo", true, `${Math.round(meteo.temperaturaC)} °C, viento ${Math.round(meteo.vientoKmh)} km/h`);
    } catch (e) {
      estado.marcarServicio("Open-Meteo", false, mensajeDe(e));
    }

    })(),
    (async () => {
    // ---- (e) cámaras a menos de 25 km pasan a vigiladas ------------------
    try {
      const lista = await camarasCacheadas();
      // Con las cámaras fijas apagadas por el escenario del mando, la cámara entra
      // en el estado (se ve en el mapa) pero SIN vigilancia: nadie la analizaría y
      // el anillo de "vigilada" mentiría. Las de móvil se vigilan siempre.
      const fijasActivas = fuenteActiva(estado.ejecucion, "camaras_fijas");
      for (const camara of lista) {
        const km = distanciaKm(centro, camara.punto);
        const previa = estado.camaras.get(camara.id);
        if (km <= RADIO_CAMARAS_KM) {
          const vigilada = fijasActivas || camara.fuente === "Movil";
          estado.guardar(estado.camaras, {
            ...camara,
            ...(previa ?? {}),
            id: camara.id,
            punto: camara.punto,
            urlImagen: camara.urlImagen,
            vigilada,
            incendioId: previa?.incendioId ?? incendioId,
            historial: previa?.historial ?? [],
          });
          if (vigilada) camarasVigiladas += 1;
        } else if (!previa && camara.fuente === "Movil") {
          // Las cámaras móviles (un teléfono compartiendo fotogramas) llegan ya
          // vigiladas y se respetan aunque estén lejos: las está sosteniendo alguien.
          estado.guardar(estado.camaras, { ...camara, historial: camara.historial ?? [] });
        }
        // Las demás cámaras lejanas NO entran en el estado: son miles y el
        // Snapshot viaja entero por SSE en cada cambio. La lista completa vive
        // en la caché de este módulo y se sirve desde /api/camaras (constructor B).
      }
      estado.marcarServicio(
        "Cámaras DGT",
        true,
        `${lista.length} cámaras, ${camarasVigiladas} vigiladas${fijasActivas ? "" : " (vigilancia de fijas apagada por el escenario)"}`,
      );
    } catch (e) {
      estado.marcarServicio("Cámaras DGT", false, mensajeDe(e));
    }

    })(),
  ]);

  // Vulnerables (colegios, residencias, campings): salen de la consulta de
  // MEDIOS y se cuelgan del pueblo más cercano, así que hay que esperar a las
  // dos consultas. Si una de las dos falló, no hay nada que colgar.
  for (const v of vulnerablesPendientes) {
    let mejor: Poblacion | undefined;
    let mejorKm = Infinity;
    for (const p of estado.poblacionesDe(incendioId)) {
      const km = distanciaKm(v.punto, p.centro);
      if (km < mejorKm) { mejorKm = km; mejor = p; }
    }
    if (!mejor) continue;
    const enEstado = estado.poblaciones.get(mejor.id);
    if (!enEstado) continue;
    if ((enEstado.vulnerables ?? []).some((x) => x.nombre === v.nombre && x.tipo === v.tipo)) continue;
    estado.actualizar(estado.poblaciones, mejor.id, { vulnerables: [...(enEstado.vulnerables ?? []), v] });
  }

  // ---- (b3) combustible (nunca bloquea) --------------------------------
  try {
    combustible = await combustibleCercano(centro);
    const conMeteo = vivo();
    // El índice de peligro se calculó en la tanda con el combustible que hubiera
    // (ninguno, en un foco nuevo). Ahora que se conoce, se recalcula: es el dato
    // que mueve al coordinador y al analista de propagación.
    const peligro = conMeteo?.meteo ? calcularPeligro(conMeteo.meteo, combustible) : conMeteo?.peligro;
    estado.actualizar(estado.incendios, incendioId, { combustible, ...(peligro ? { peligro } : {}), actualizadoEn: estado.reloj.ahoraMundo });
    estado.marcarServicio("Overpass combustible", true, combustible.dominante);
  } catch (e) {
    estado.marcarServicio("Overpass combustible", false, mensajeDe(e));
  }

  // Servicio consolidado «Overpass» (constructor T, 2026-09-19). Al partir la
  // consulta en tres, esta clave dejó de escribirse y con ella desapareció la
  // línea «Overpass» de la barra de estado y de /api/salud (la prueba (l) la
  // exige y la da por perdida). Los tres pasos se siguen marcando por separado
  // para el detalle; esta es el resumen: verde si el espejo contestó a lo que
  // hace falta para operar (medios y pueblos), rojo con el motivo si no.
  estado.marcarServicio(
    "Overpass",
    fallos.length === 0,
    fallos.length === 0 ? `${pueblosCreados} pueblos, ${unidadesCreadas} unidades` : fallos.join(" · "),
  );

  const final = vivo();
  // Evento de cierre: el entorno está COMPLETO (o completo con lo que Overpass
  // haya dado). `datos.fase = "completo"` es lo que mira `esperarEntornoCargado`
  // en las pruebas de integración para no exigir pueblos antes de tiempo.
  estado.registrarEvento(
    "incendio_actualizado",
    fallos.length
      ? `Entorno cargado con fallos: ${pueblosCreados} pueblos, ${unidadesCreadas} unidades, ${camarasVigiladas} cámaras · pendiente de reintento (${fallos.join(" · ")})`
      : `Entorno cargado: ${pueblosCreados} pueblos, ${unidadesCreadas} unidades, ${camarasVigiladas} cámaras`,
    {
      incendioId,
      nivel: fallos.length ? "aviso" : "info",
      datos: {
        fase: "completo",
        municipio: final?.municipio,
        pueblos: pueblosCreados,
        unidades: unidadesCreadas,
        camaras: camarasVigiladas,
        completo: fallos.length === 0,
        fallos,
      },
    },
  );

  // Si Overpass falló, se reintenta: un foco SIN unidades no puede recibir
  // ataque inicial, y eso no puede depender de que un espejo estuviera caído
  // tres segundos. El reintento es visible (evento) y se rinde tras MAX_REINTENTOS.
  if (fallos.length) programarReintento(estado, incendioId, intento);
}

/**
 * Reintentos del enriquecimiento cuando Overpass falla. Retroceso 60 s, 180 s,
 * 540 s (más un 20 % de dispersión para que diez focos no reintenten a la vez).
 *
 * MOTIVO DEL CAMBIO (constructor T, 2026-09-19): eran 30/60/120 s, es decir los
 * tres reintentos dentro de los primeros 3,5 minutos. Como el cortacircuitos de
 * `lib/fuentes/overpass.ts` deja un espejo fuera 5 minutos, los tres caían en la
 * misma ventana y se gastaban sin llegar a preguntar. Con 60/180/540 s el
 * último intento cae ya fuera de esa ventana y tiene opciones reales; los dos
 * primeros, si el espejo sigue castigado, fallan al instante y no cuestan nada.
 */
const MAX_REINTENTOS = 3;
const ESPERA_REINTENTO_MS = 60_000;

function programarReintento(estado: Estado, incendioId: string, intento: number): void {
  if (intento >= MAX_REINTENTOS) {
    estado.registrarEvento(
      "sistema",
      `Entorno incompleto tras ${MAX_REINTENTOS} intentos: Overpass no responde. El foco seguirá sin los datos que falten hasta que la fuente vuelva.`,
      { incendioId, nivel: "critico", datos: { intentos: MAX_REINTENTOS } },
    );
    return;
  }
  const espera = Math.round(ESPERA_REINTENTO_MS * 3 ** intento * (0.9 + Math.random() * 0.2));
  estado.registrarEvento(
    "sistema",
    `Overpass falló: se reintenta el entorno de este foco en ${Math.round(espera / 1000)} s (intento ${intento + 2} de ${MAX_REINTENTOS + 1}).`,
    { incendioId, nivel: "aviso", datos: { enSegundos: Math.round(espera / 1000), intento: intento + 1 } },
  );
  const temporizador = setTimeout(() => {
    if (!estado.incendios.get(incendioId)) return; // el foco ya no existe
    void enriquecerIncendio(estado, incendioId, intento + 1).catch((e) =>
      estado.registrarEvento("sistema", `Reintento de entorno fallido: ${mensajeDe(e)}`, { incendioId, nivel: "aviso" }),
    );
  }, espera);
  // No mantiene vivo el proceso de Node si todo lo demás termina.
  (temporizador as unknown as { unref?: () => void }).unref?.();
}

export function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
