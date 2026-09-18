// Fixture tipado de EstadoSistema para desarrollar la UI sin backend.
// useEstado lo usa como fallback cuando /api/estado no responde.
// Cubre todos los estados de decisión y los datos de las ideas de Javi
// (enrutador IA, anti-fake-news, audios multilingües, post-mortem, voluntarios).

import { ARISTAS, EVENTOS_INGESTA, IMPACTO_DOMINO, NODOS, TARJETA_INICIAL } from "../mock-data";
import type { EventoIngesta } from "../types";
import type { Decision, EstadoSistema, Evidencia } from "../tipos-sistema";

export function crearEstadoDemo(ahora: Date = new Date()): EstadoSistema {
  const t = (minutos: number) => new Date(ahora.getTime() + minutos * 60_000).toISOString();
  const inc = TARJETA_INICIAL.incidenteId;

  const evidenciaBase: Evidencia[] = [
    {
      id: "evd-trafico-3862",
      fuente: "MadridTrafico",
      descripcion: "Sensor 3862 M-30 sur (salida 12): carga 82 %, nivel de servicio 2",
      valor: 82,
      unidad: "%",
      timestamp: t(-1),
      url: "https://informo.madrid.es/informo/tmadrid/pm.xml",
      confianza: 0.95,
    },
    {
      id: "evd-viento",
      fuente: "OpenMeteo",
      descripcion: "Viento en Arganzuela: 23 km/h desde el SO (225°)",
      valor: 23,
      unidad: "km/h",
      timestamp: t(-2),
      url: "https://api.open-meteo.com/v1/forecast?latitude=40.39&longitude=-3.68&current=wind_speed_10m,wind_direction_10m",
      confianza: 0.9,
    },
    {
      id: "evd-aire",
      fuente: "OpenMeteoAire",
      descripcion: "PM2.5 a 1 km al NE del foco: 148 µg/m³ (umbral OMS 15)",
      valor: 148,
      unidad: "µg/m³",
      timestamp: t(-2),
      url: "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=40.40&longitude=-3.67&current=pm2_5",
      confianza: 0.8,
    },
    {
      id: "evd-vision",
      fuente: "FalAI",
      descripcion: "Imagen ciudadana: fuego activo 0.96, humo denso 0.93",
      valor: 0.96,
      timestamp: t(-6),
      confianza: 0.96,
    },
    {
      id: "evd-grafo",
      fuente: "Grafo",
      descripcion: "C/ Méndez Álvaro es ruta principal de abastecimiento del Hospital Gregorio Marañón",
      valor: "SUMINISTRA_A",
      timestamp: t(-5),
      confianza: 1,
    },
  ];

  const base: EventoIngesta[] = EVENTOS_INGESTA.map((e, i) => ({
      ...e,
      timestamp: t(-10 + i),
      verificacion: { estado: "verificado" as const },
      procesadoPor: [
        { modelo: "claude-haiku-4-5", latenciaMs: 180 + i * 37, tarea: "clasificacion" as const },
        ...(e.fuente === "FalAI" ? [{ modelo: "fal-ai/florence-2", latenciaMs: 410, tarea: "vision" as const }] : []),
      ],
    }));

  const nuevos: EventoIngesta[] = [
    {
      id: "ev-006",
      fuente: "HappyRobot",
      timestamp: t(-4),
      titulo: "Llamada ciudadana (agente de voz)",
      detalle:
        "Vecina de Méndez Álvaro 52: \"El humo está entrando por las ventanas, hay una persona mayor en el 3º que no puede bajar.\" Heridos: no. Movilidad reducida: 1.",
      confianza: 0.88,
      ubicacion: "C/ Méndez Álvaro 52",
      verificacion: { estado: "verificado" },
      procesadoPor: [
        { modelo: "claude-haiku-4-5", latenciaMs: 212, tarea: "extraccion_entidades" },
      ],
    },
    {
      id: "ev-007",
      fuente: "Ciudadano",
      timestamp: t(-3),
      titulo: "Reporte ciudadano con imagen",
      detalle: "\"Fuego enorme en la nave de Méndez Álvaro, mirad!!\"",
      confianza: 0.2,
      ubicacion: "C/ Méndez Álvaro",
      imagenUrl: "https://placehold.co/320x200/1f2a36/8b98a8?text=imagen+reportada",
      verificacion: {
        estado: "sospechoso",
        motivo: "Exa: la imagen coincide con un incendio en Getafe de agosto de 2021 (elmundo.es). Posible desinformación.",
      },
      procesadoPor: [
        { modelo: "fal-ai/florence-2", latenciaMs: 395, tarea: "vision" },
        { modelo: "exa-search", latenciaMs: 820, tarea: "verificacion" },
      ],
    },
    {
      id: "ev-008",
      fuente: "Ciudadano",
      timestamp: t(-2),
      titulo: "Reporte ciudadano",
      detalle: "\"Mucho humo negro por Méndez Álvaro, huele a plástico.\"",
      confianza: 0.7,
      ubicacion: "C/ Méndez Álvaro 60",
      verificacion: { estado: "duplicado", duplicaDe: "ev-001", motivo: "Misma ubicación y descripción que ev-001 (±150 m, 4 min)" },
      procesadoPor: [{ modelo: "claude-haiku-4-5", latenciaMs: 164, tarea: "clasificacion" }],
    },
    {
      id: "ev-009",
      fuente: "OpenMeteo",
      timestamp: t(-1),
      titulo: "Cambio de viento: SO → NO",
      detalle: "Dirección 225° → 315°, 31 km/h. El humo gira hacia el Hospital Gregorio Marañón.",
      confianza: 0.9,
      ubicacion: "Arganzuela, Madrid",
      verificacion: { estado: "verificado" },
    },
  ];
  const eventos = [...base, ...nuevos].reverse(); // más reciente primero

  const planSinHelicoptero = {
    ...TARJETA_INICIAL.plan,
    version: 2,
    razonamiento:
      "Plan v2 regenerado respetando la doctrina \"Sin medios aéreos con viento > 25 km/h\". Se retira el helicóptero y se compensa con una autobomba nodriza del Parque 4.",
    acciones: TARJETA_INICIAL.plan.acciones
      .filter((a) => !/helic/i.test(a.recurso))
      .concat({
        id: "a6",
        recurso: "Bomberos Parque 4",
        accion: "Refuerzo terrestre: autobomba nodriza para compensar la ausencia de medios aéreos.",
        eta: "10 min",
        prioridad: "alta",
      }),
    restricciones: ["No usar helicópteros con este viento"],
  };

  const decisiones: Decision[] = [
    {
      id: "dec-hospital",
      incidenteId: inc,
      foco: "hospital",
      creadaEn: t(-1),
      plazo: t(4),
      urgencia: "critica",
      riesgo: 85,
      costeDeNoActuar:
        "El humo alcanza el acceso sur del Gregorio Marañón en ~9 min: urgencias sin ventilación limpia y ambulancias sin ruta.",
      tarjeta: {
        ...TARJETA_INICIAL,
        titulo: "Proteger Hospital Gregorio Marañón ante giro de viento",
        resumen:
          "El viento ha girado a NO (315°, 31 km/h). El penacho de humo se desplaza hacia el Gregorio Marañón. C/ Méndez Álvaro es su ruta principal de abastecimiento: se propone redirigir tráfico de emergencia por Paseo de las Delicias.",
        domino: IMPACTO_DOMINO.slice(0, 2),
        plan: {
          version: 1,
          razonamiento:
            "Con el viento a NO, el hospital pasa a la zona de afectación directa. Prioridad: cerrar tomas de aire, desviar ambulancias por Delicias y preposicionar SAMUR en el acceso norte.",
          acciones: [
            { id: "h1", recurso: "Hospital Gregorio Marañón", accion: "Cerrar tomas de aire exterior del bloque de urgencias (llamada al jefe de guardia).", eta: "3 min", prioridad: "alta" },
            { id: "h2", recurso: "Policía Unidad 12", accion: "Redirigir tráfico de emergencia por Paseo de las Delicias.", eta: "5 min", prioridad: "alta" },
            { id: "h3", recurso: "SAMUR A3", accion: "Preposicionar 2 unidades en el acceso norte.", eta: "5 min", prioridad: "media" },
          ],
          mensajeAlerta:
            "Atención. El humo del incendio de Méndez Álvaro se desplaza hacia el entorno del Hospital Gregorio Marañón. Acceda a urgencias por la calle Doctor Esquerdo.",
          restricciones: [],
        },
      },
      evidencia: [evidenciaBase[1], evidenciaBase[2], evidenciaBase[4]],
      reglasAplicadas: ["regla-hospitales"],
      estado: "pendiente",
    },
    {
      id: "dec-evacuacion",
      incidenteId: inc,
      foco: "evacuacion",
      creadaEn: t(-3),
      plazo: t(11),
      urgencia: "alta",
      riesgo: 60,
      costeDeNoActuar: "Una persona con movilidad reducida expuesta a humo en Méndez Álvaro 52, 3º.",
      tarjeta: {
        ...TARJETA_INICIAL,
        titulo: "Evacuación asistida Méndez Álvaro 52",
        resumen:
          "Llamada ciudadana (HappyRobot) reporta una persona mayor con movilidad reducida en un 3º piso con humo entrando. PM2.5 148 µg/m³.",
        domino: [],
        plan: {
          version: 1,
          razonamiento: "Protocolo PEMAM-IND-04 §3: evacuación asistida si PM2.5 > 100 y persona vulnerable identificada.",
          acciones: [
            { id: "e1", recurso: "Bomberos Parque 7", accion: "Dotación de 2 efectivos con equipos ERA para evacuación asistida.", eta: "7 min", prioridad: "alta" },
            { id: "e2", recurso: "SAMUR Social", accion: "Recepción en Polideportivo Arganzuela.", eta: "12 min", prioridad: "media" },
          ],
          mensajeAlerta: "Vecinos de Méndez Álvaro 50 a 60: mantengan ventanas cerradas. Los bomberos están asistiendo a personas con movilidad reducida.",
          restricciones: [],
        },
      },
      evidencia: [evidenciaBase[2]],
      reglasAplicadas: [],
      estado: "pendiente",
    },
    {
      id: "dec-comunicado",
      incidenteId: inc,
      foco: "comunicado",
      creadaEn: t(-4),
      plazo: t(20),
      urgencia: "media",
      riesgo: 20,
      costeDeNoActuar: "Llamadas duplicadas al 112 y circulación de la imagen falsa de 2021.",
      tarjeta: {
        ...TARJETA_INICIAL,
        titulo: "Comunicado público y desmentido",
        resumen: "Aviso informativo a la población y desmentido de la imagen reciclada detectada por Exa.",
        domino: [],
        plan: {
          version: 1,
          razonamiento: "Riesgo bajo (20) ≤ umbral de autonomía (30): ejecutado sin firma humana.",
          acciones: [
            { id: "c1", recurso: "Gabinete de prensa", accion: "Publicar comunicado en redes del Ayuntamiento.", eta: "1 min", prioridad: "media" },
          ],
          mensajeAlerta: "Incendio controlado en Méndez Álvaro. La imagen que circula en redes corresponde a un incendio de 2021.",
          restricciones: [],
        },
      },
      evidencia: [evidenciaBase[3]],
      reglasAplicadas: [],
      estado: "auto",
      decididaPor: { rol: "jefe_sala_112", timestamp: t(-4), via: "panel" },
      resultadoEjecucion: [
        { accionId: "c1", canal: "interno", proveedor: "Cuaderno", ref: "post-8841", ok: true, detalle: "Publicado en @MADRID", timestamp: t(-4) },
      ],
    },
    {
      id: "dec-despliegue",
      incidenteId: inc,
      foco: "despliegue_inicial",
      creadaEn: t(-9),
      plazo: t(-4),
      urgencia: "critica",
      riesgo: 75,
      costeDeNoActuar: "Propagación a naves colindantes.",
      tarjeta: { ...TARJETA_INICIAL, plan: planSinHelicoptero },
      evidencia: [evidenciaBase[0], evidenciaBase[1], evidenciaBase[3], evidenciaBase[4]],
      reglasAplicadas: ["regla-aereos"],
      estado: "ejecutada",
      decididaPor: { rol: "director_tecnico", timestamp: t(-7), via: "panel" },
      resultadoEjecucion: [
        { accionId: "a1", canal: "voz", proveedor: "HappyRobot", ref: "call_7f3a91", ok: true, detalle: "Parque 7 confirma salida de 2 autobombas + escala", timestamp: t(-7) },
        { accionId: "a2", canal: "sms", proveedor: "Twilio", ref: "SM2b8e4c0d91", ok: true, detalle: "SMS a Policía Unidad 12 entregado", timestamp: t(-7) },
        { accionId: "a4", canal: "email", proveedor: "HappyRobot", ref: "em_55c2", ok: false, detalle: "Iberdrola no confirma; reintento en 2 min", timestamp: t(-6) },
      ],
      audiosAlerta: [
        { idioma: "es", texto: TARJETA_INICIAL.plan.mensajeAlerta, url: "", destino: "radio_efectivos", duracionSeg: 14 },
        { idioma: "en", texto: "Attention. Active industrial fire at Méndez Álvaro 56. The M-30 south is closed between exits 11 and 13. Avoid the area and keep windows closed.", url: "", destino: "megafonia", duracionSeg: 12 },
        { idioma: "de", texto: "Achtung. Industriebrand in Méndez Álvaro 56. Die M-30 Süd ist zwischen den Ausfahrten 11 und 13 gesperrt.", url: "", destino: "push", duracionSeg: 11 },
        { idioma: "fr", texto: "Attention. Incendie industriel en cours à Méndez Álvaro 56. La M-30 sud est fermée entre les sorties 11 et 13.", url: "", destino: "push", duracionSeg: 11 },
      ],
      informeId: "inf-acta-1",
    },
    {
      id: "dec-corte-m30",
      incidenteId: inc,
      foco: "corte_m30",
      creadaEn: t(-8),
      plazo: t(-2),
      urgencia: "alta",
      riesgo: 55,
      costeDeNoActuar: "Visibilidad reducida en M-30 sur.",
      tarjeta: TARJETA_INICIAL,
      evidencia: [evidenciaBase[0]],
      reglasAplicadas: [],
      estado: "invalidada",
      motivoInvalidacion: "El viento giró a NO (315°): el humo ya no cruza la M-30. Se sustituye por dec-hospital.",
    },
    {
      id: "dec-helicoptero",
      incidenteId: inc,
      foco: "despliegue_inicial",
      creadaEn: t(-10),
      plazo: t(-5),
      urgencia: "critica",
      riesgo: 75,
      costeDeNoActuar: "Propagación a naves colindantes.",
      tarjeta: TARJETA_INICIAL,
      evidencia: [evidenciaBase[1], evidenciaBase[3]],
      reglasAplicadas: [],
      estado: "denegada",
      decididaPor: { rol: "director_tecnico", timestamp: t(-9), via: "panel" },
      feedback: "No usar helicópteros con este viento, es peligroso",
    },
  ];

  return {
    serverTime: ahora.toISOString(),
    actualizadoEn: ahora.toISOString(),
    incidente: {
      id: inc,
      titulo: TARJETA_INICIAL.titulo,
      tipo: "incendio_industrial",
      ubicacion: { nombre: "C/ Méndez Álvaro 56, Madrid", lat: 40.3965, lon: -3.6781 },
      iniciadoEn: t(-11),
      tick: 7,
      fase: "escalada",
      activo: true,
    },
    entorno: {
      viento: { velocidadKmh: 31, direccionGrados: 315, direccionTexto: "NO", fuente: "OpenMeteo", timestamp: t(-1) },
      aire: { pm25: 148, pm10: 210, co: 1840, timestamp: t(-2) },
      trafico: {
        sensoresCercanos: 37,
        cargaMedia: 64,
        sensorPeor: { id: "3862", descripcion: "M-30 sur, salida 12", carga: 82 },
        timestamp: t(-1),
      },
      demandaElectricaMW: { valor: 29_412, timestamp: t(-5) },
    },
    eventos,
    nodos: NODOS,
    aristas: ARISTAS,
    decisiones,
    doctrina: [
      {
        id: "regla-aereos",
        texto: "No usar helicópteros con este viento, es peligroso",
        reglaNormalizada: "No proponer medios aéreos cuando el viento supere 25 km/h.",
        ambito: "global",
        origen: { decisionId: "dec-helicoptero", rol: "director_tecnico", timestamp: t(-9) },
        activa: true,
        vecesAplicada: 2,
      },
      {
        id: "regla-hospitales",
        texto: "Los hospitales van siempre antes que el tráfico",
        reglaNormalizada: "Priorizar la protección y accesos de hospitales sobre la fluidez del tráfico.",
        ambito: "global",
        origen: { decisionId: "dec-previa-2025", rol: "director_plan", timestamp: t(-60 * 24 * 30) },
        activa: true,
        vecesAplicada: 5,
      },
      {
        id: "regla-m30",
        texto: "No cortar la M-30 entera en hora punta",
        reglaNormalizada: "Entre 7-10 h y 17-20 h, preferir cortes parciales de la M-30 a cortes totales.",
        ambito: "incidente",
        origen: { decisionId: "dec-corte-m30", rol: "director_tecnico", timestamp: t(-8) },
        activa: false,
        vecesAplicada: 0,
      },
    ],
    informes: [
      {
        id: "inf-acta-1",
        tipo: "acta_decision",
        incidenteId: inc,
        decisionId: "dec-despliegue",
        generadoEn: t(-7),
        titulo: "Acta de decisión — Despliegue inicial (plan v2)",
        markdown: `# Acta de decisión

**Incidente:** ${TARJETA_INICIAL.titulo}
**Decisión:** Despliegue inicial, plan v2
**Firmada por:** Director de Emergencias, vía panel
**Hora:** ${new Date(t(-7)).toLocaleTimeString("es-ES")}

## Evidencia considerada

| Fuente | Dato | Confianza |
|---|---|---|
| MadridTrafico | Sensor 3862 M-30 sur: carga 82 % | 95 % |
| OpenMeteo | Viento 23 km/h desde el SO | 90 % |
| FalAI | Fuego activo 0.96 | 96 % |

## Alternativas descartadas

- **Plan v1 (con helicóptero):** denegado por el Director de Emergencias: *"No usar helicópteros con este viento, es peligroso"*. Convertido en regla de doctrina global.

## Acciones ejecutadas

1. Bomberos Parque 7: llamada HappyRobot \`call_7f3a91\`, **confirmada**.
2. Policía Unidad 12: SMS Twilio \`SM2b8e4c0d91\`, **entregado**.
3. Iberdrola: email \`em_55c2\`, **sin confirmar**, reintento programado.
`,
      },
      {
        id: "inf-sitrep-3",
        tipo: "sitrep",
        incidenteId: inc,
        generadoEn: t(-1),
        titulo: "SITREP #3 — T+10 min",
        markdown: `# SITREP #3

- **Situación:** incendio activo, perímetro establecido. El viento gira a NO (315°, 31 km/h).
- **Riesgo emergente:** penacho hacia el Hospital Gregorio Marañón.
- **Decisiones pendientes:** 2 (1 crítica).
- **Recursos desplegados:** Bomberos P7 y P4, Policía U12, SAMUR A3.
- **Desinformación:** 1 imagen reciclada detectada y desmentida.
`,
      },
    ],
    timeline: [
      { id: "tl9", timestamp: t(-1), tick: 7, tipo: "invalidada", texto: "Decisión corte M-30 invalidada: el viento giró a NO", ref: "dec-corte-m30" },
      { id: "tl8", timestamp: t(-1), tick: 7, tipo: "propuesta", texto: "Nueva propuesta crítica: proteger Hospital Gregorio Marañón", ref: "dec-hospital" },
      { id: "tl7", timestamp: t(-3), tick: 6, tipo: "evento", texto: "Imagen sospechosa filtrada (coincide con incendio de 2021)", ref: "ev-007" },
      { id: "tl6", timestamp: t(-4), tick: 5, tipo: "auto", texto: "Comunicado público ejecutado automáticamente (riesgo 20 ≤ 30)", ref: "dec-comunicado" },
      { id: "tl5", timestamp: t(-4), tick: 5, tipo: "evento", texto: "Llamada HappyRobot: persona con movilidad reducida en Méndez Álvaro 52", ref: "ev-006" },
      { id: "tl4", timestamp: t(-7), tick: 3, tipo: "ejecutada", texto: "Despliegue inicial v2 ejecutado (3 acciones, 1 pendiente de confirmación)", ref: "dec-despliegue" },
      { id: "tl3", timestamp: t(-9), tick: 2, tipo: "regla", texto: "Nueva regla de doctrina: sin medios aéreos con viento > 25 km/h", ref: "regla-aereos" },
      { id: "tl2", timestamp: t(-9), tick: 2, tipo: "denegada", texto: "Despliegue inicial v1 denegado por Director de Emergencias", ref: "dec-helicoptero" },
      { id: "tl1", timestamp: t(-10), tick: 1, tipo: "evento", texto: "Incidente detectado: fuego activo confirmado por visión", ref: "ev-002" },
    ],
    tareasVoluntarios: [
      {
        id: "tv-mantas",
        incidenteId: inc,
        titulo: "Llevar mantas y agua al Polideportivo Arganzuela",
        descripcion: "Punto de acogida para vecinos evacuados de Méndez Álvaro 50-60.",
        lugar: "Polideportivo Arganzuela, Paseo de la Chopera 6",
        cupo: 20,
        aceptados: 14,
        estado: "abierta",
        creadaEn: t(-3),
        riesgo: "bajo",
      },
      {
        id: "tv-traduccion",
        incidenteId: inc,
        titulo: "Intérpretes de inglés/francés en el punto de acogida",
        descripcion: "Apoyo a turistas alojados en hoteles de Atocha.",
        lugar: "Polideportivo Arganzuela",
        cupo: 4,
        aceptados: 4,
        estado: "cubierta",
        creadaEn: t(-5),
        riesgo: "bajo",
      },
      {
        id: "tv-avisos",
        incidenteId: inc,
        titulo: "Avisar puerta a puerta a vecinos mayores (bloques 40-48)",
        descripcion: "Fuera del perímetro de humo. Solo avisar, no entrar en viviendas.",
        lugar: "C/ Méndez Álvaro 40-48",
        cupo: 8,
        aceptados: 0,
        estado: "propuesta",
        creadaEn: t(-1),
        riesgo: "bajo",
      },
    ],
    umbralAutonomia: 30,
    autoAvance: true,
    intervaloSeg: 20,
    proveedorEjecucion: "HappyRobot",
    iaDisponible: true,
    rolActivo: "director_tecnico",
    modoDatos: "mixto",
    organismo: { nombre: "Ayuntamiento de Madrid", servicio: "Emergencias Madrid · SAMUR-PC", municipio: "Madrid" },
    origenGrafo: "memoria",
  };
}
