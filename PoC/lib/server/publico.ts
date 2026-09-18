// Vista pública para la ciudadanía: solo información oficial, verificada y sin
// datos internos (ni evidencia bruta, ni planes pendientes, ni doctrina).

import type { EstadoSistema, Incidente, TareaVoluntarios } from "../tipos-sistema";

export interface VistaPublica {
  organismo: EstadoSistema["organismo"];
  incidente: Pick<Incidente, "titulo" | "tipo" | "ubicacion" | "fase" | "activo" | "iniciadoEn">;
  situacionOperativa: 0 | 1 | 2 | 3; // Norma Básica RD 524/2023
  avisos: { id: string; titulo: string; texto: string; nivel: "informativo" | "aviso" | "alerta"; publicadoEn: string; zonas: string[] }[];
  recomendaciones: string[];
  noticiasVerificadas: { id: string; titulo: string; fuente: string; timestamp: string; verificado: true }[];
  bulosDesmentidos: { id: string; texto: string; desmentido: string }[];
  entorno: { viento: EstadoSistema["entorno"]["viento"]; aire?: EstadoSistema["entorno"]["aire"] };
  tareasVoluntarios: Pick<TareaVoluntarios, "id" | "titulo" | "descripcion" | "lugar" | "cupo" | "aceptados" | "estado">[];
  actualizadoEn: string;
}

const SITUACION: Record<Incidente["fase"], VistaPublica["situacionOperativa"]> = { deteccion: 0, respuesta: 1, escalada: 2, estabilizacion: 1, cierre: 0 };

/** Centroides aproximados de los distritos de Madrid (WGS84) para deducir zonas por posición, no por texto. */
const DISTRITOS: { nombre: string; lat: number; lon: number }[] = [
  { nombre: "Centro", lat: 40.4153, lon: -3.7074 }, { nombre: "Arganzuela", lat: 40.3986, lon: -3.6952 }, { nombre: "Retiro", lat: 40.4109, lon: -3.6747 },
  { nombre: "Salamanca", lat: 40.4298, lon: -3.6776 }, { nombre: "Chamartín", lat: 40.4621, lon: -3.6764 }, { nombre: "Tetuán", lat: 40.4606, lon: -3.6989 },
  { nombre: "Chamberí", lat: 40.4353, lon: -3.7031 }, { nombre: "Fuencarral-El Pardo", lat: 40.5194, lon: -3.7458 }, { nombre: "Moncloa-Aravaca", lat: 40.4437, lon: -3.7508 },
  { nombre: "Latina", lat: 40.3893, lon: -3.7614 }, { nombre: "Carabanchel", lat: 40.3733, lon: -3.7308 }, { nombre: "Usera", lat: 40.3810, lon: -3.7061 },
  { nombre: "Puente de Vallecas", lat: 40.3897, lon: -3.6620 }, { nombre: "Moratalaz", lat: 40.4065, lon: -3.6446 }, { nombre: "Ciudad Lineal", lat: 40.4487, lon: -3.6503 },
  { nombre: "Hortaleza", lat: 40.4746, lon: -3.6413 }, { nombre: "Villaverde", lat: 40.3459, lon: -3.7095 }, { nombre: "Villa de Vallecas", lat: 40.3628, lon: -3.6087 },
  { nombre: "Vicálvaro", lat: 40.3976, lon: -3.6003 }, { nombre: "San Blas-Canillejas", lat: 40.4297, lon: -3.6126 }, { nombre: "Barajas", lat: 40.4735, lon: -3.5795 },
];
const dist2 = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => (a.lat - b.lat) ** 2 + ((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180)) ** 2;
export function distritoDe(p: { lat: number; lon: number }): string {
  return DISTRITOS.reduce((m, d) => (dist2(p, d) < dist2(p, m) ? d : m)).nombre;
}
const ETIQUETA_FUENTE: Record<string, string> = { Exa: "Medios y redes (verificado)", Prensa: "Prensa", Organismo: "Aviso oficial", FalAI: "Imagen verificada", HappyRobot: "Línea ciudadana", CamaraTrafico: "Cámara de tráfico", Periferico: "Periférico verificado" };
const FUENTES_OFICIALES = new Set<string>(["Exa", "FalAI", "OpenMeteo", "REE", "IGN", "AEMET", "MadridTrafico", "HappyRobot", "Organismo", "Prensa", "CamaraTrafico"]);

/** Quita prefijos técnicos ("Visión:", "Exa:", "Agente de voz:") para el lenguaje del portal. */
function limpiarTitulo(t: string): string {
  return t.replace(/^(visi[oó]n|exa|falai|agente de voz|noticia local|llamada entrante|llamada al 112|llamada 112)\s*:\s*/i, "").replace(/^\w/, (c) => c.toUpperCase());
}

/** Rumbo opuesto al origen del viento, en 8 rumbos (hacia dónde va el humo). */
function destinoViento8(direccionGrados: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return dirs[Math.round((((direccionGrados + 180) % 360) + 360) % 360 / 45) % 8];
}

/** Distritos afectados, deducidos del punto del incidente y de los nodos bajo el penacho (nunca del texto). */
function zonasAfectadas(e: EstadoSistema): string[] {
  const zonas = new Set<string>([distritoDe(e.incidente.ubicacion)]);
  const afectados = new Set(e.entorno.penacho?.afectados ?? []);
  for (const n of e.nodos) if (afectados.has(n.id) && typeof n.lat === "number" && typeof n.lon === "number") zonas.add(distritoDe({ lat: n.lat, lon: n.lon }));
  return Array.from(zonas).slice(0, 3);
}

/** Recomendaciones por tipo de emergencia (solo los incendios hablan de humo y viento). */
function recomendacionesPorTipo(e: EstadoSistema, lugar: string): string[] {
  const v = e.entorno.viento;
  const humo = [
    "Cierra puertas y ventanas y apaga la ventilación exterior si notas olor a humo.",
    `El humo se desplaza hacia el ${destinoViento8(v.direccionGrados)} (viento de ${Math.round(v.velocidadKmh)} km/h del ${v.direccionTexto}); evita la zona de ${lugar}.`,
    ...(e.entorno.aire && e.entorno.aire.pm25 > 25 ? ["Si tienes problemas respiratorios, quédate en interiores."] : []),
  ];
  const porTipo: Record<string, string[]> = {
    incendio_industrial: humo,
    incendio_urbano: humo,
    incendio_forestal: [...humo, "Si estás en zona de interfaz urbano-forestal, prepara una bolsa con documentación y medicinas por si se ordena evacuar."],
    inundacion: ["No cruces calles anegadas ni pasos inferiores: 30 cm de agua arrastran un coche.", "Sube a plantas altas y no bajes a garajes ni sótanos.", `Evita la zona de ${lugar} y los márgenes del río.`, "Desconecta la electricidad si el agua entra en casa."],
    apagon: ["No uses ascensores y evita las velas: usa linternas.", "Si dependes de un aparato eléctrico (respirador, diálisis), llama al 112 e identifícate.", "Mantén cerrada la nevera; apaga los aparatos que estaban encendidos para evitar picos al volver la luz.", "Los semáforos pueden estar apagados: extrema la precaución al cruzar."],
    fuga_gas: [`Aléjate al menos 100 m de ${lugar}; no enciendas luces, mecheros ni uses el móvil dentro de la zona.`, "Si notas olor a gas en casa, abre ventanas, no accione interruptores y sal a la calle.", "Sigue las indicaciones de Bomberos y Policía Municipal para el perímetro."],
    accidente_trafico: [`Evita ${lugar} y sus accesos; usa rutas alternativas y transporte público.`, "No te detengas a mirar: dificultas el trabajo de las ambulancias.", "Si eres testigo y no estás herido, apártate a un lugar seguro y espera a los servicios de emergencia."],
    accidente_ferroviario: ["No accedas a las vías ni a la estación afectada.", "Consulta Metro/Cercanías para servicios alternativos.", `Evita ${lugar}; deja libres los accesos para los equipos de rescate.`],
    derrumbe: [`Aléjate de ${lugar}: puede haber nuevos desprendimientos.`, "No entres en edificios dañados a recoger objetos.", "Si conoces a alguien que podría estar dentro, avisa al 112 con su ubicación aproximada."],
    ola_calor: ["Bebe agua con frecuencia aunque no tengas sed y evita el sol entre las 12 y las 18 h.", "Consulta los refugios climáticos municipales abiertos.", "Presta atención a mayores, niños y personas con enfermedades crónicas."],
    nevada: ["Evita desplazamientos innecesarios; si conduces, lleva cadenas.", "Cuidado con el hielo en aceras: calzado con suela de goma.", "Ayuda a las personas sin hogar de tu zona a llegar a los refugios habilitados."],
    sismo: ["Si hay réplicas, protégete bajo una mesa resistente y aléjate de ventanas.", "No uses ascensores; sal a espacios abiertos por las escaleras.", "Revisa gas y electricidad antes de volver a usarlos."],
    aglomeracion: [`Evita ${lugar} y sus accesos; sigue las indicaciones de Policía Municipal.`, "Si estás dentro, no empujes: muévete en diagonal hacia los laterales.", "Fija un punto de encuentro con tu grupo por si os separáis."],
    vertido_quimico: [`Aléjate de ${lugar} en dirección contraria al viento y cierra ventanas.`, "No toques ni bebas agua de fuentes o ríos cercanos hasta nuevo aviso.", "Si notas picor de ojos o garganta, lávate con agua abundante y llama al 112."],
    persona_peligro: [`Deja libres los accesos a ${lugar} para los equipos de rescate.`, "Si tienes información útil, llama al 112: no publiques datos de la persona en redes."],
  };
  const base = porTipo[e.incidente.tipo] ?? [`Evita la zona de ${lugar} y sigue las indicaciones de los servicios de emergencia.`];
  return [...base, "No llames al 112 para pedir información: la línea es para emergencias. Consulta este portal.", "Si te indican evacuar, sigue la ruta señalada por Protección Civil y no uses el coche."];
}

export function vistaPublica(e: EstadoSistema): VistaPublica {
  const { titulo, tipo, ubicacion, fase, activo, iniciadoEn } = e.incidente;
  const ejecutadas = e.decisiones.filter((d) => (d.estado === "ejecutada" || d.estado === "auto") && ["comunicado", "evacuacion", "replanificacion_viento"].includes(d.foco));
  const avisos = ejecutadas.map((d) => ({
    id: d.id,
    titulo: d.tarjeta.titulo,
    texto: d.tarjeta.plan.mensajeAlerta,
    nivel: (d.urgencia === "critica" ? "alerta" : d.urgencia === "alta" ? "aviso" : "informativo") as "informativo" | "aviso" | "alerta",
    publicadoEn: d.decididaPor?.timestamp ?? d.creadaEn,
    zonas: zonasAfectadas(e),
  }));
  const lugar = (ubicacion.nombre.split(",")[0] || "la zona afectada").replace(/^-?\d+[.,]\d+.*$/, "la zona afectada");
  const recomendaciones = activo && fase !== "cierre" ? recomendacionesPorTipo(e, lugar) : ["La situación está resuelta. Si persisten daños o síntomas, llama al 112 solo si es urgente."];
  const bulos = e.eventos.filter((x) => x.verificacion?.estado === "sospechoso");
  const noticiasVerificadas = e.eventos
    .filter((x) => x.verificacion?.estado === "verificado" && FUENTES_OFICIALES.has(x.fuente) && !/sensor|demanda|tendencia en redes|menciones/i.test(x.titulo))
    .slice(0, 8)
    .map((x) => ({ id: x.id, titulo: limpiarTitulo(x.titulo), fuente: ETIQUETA_FUENTE[String(x.fuente)] ?? String(x.fuente), timestamp: x.timestamp, verificado: true as const }));
  const bulosDesmentidos = bulos.map((x) => ({ id: x.id, texto: limpiarTitulo(x.titulo), desmentido: limpiarTitulo(x.verificacion?.motivo ?? "No verificado por fuentes oficiales.") }));
  return {
    organismo: e.organismo,
    incidente: { titulo, tipo, ubicacion, fase, activo, iniciadoEn },
    situacionOperativa: activo && fase !== "cierre" ? (Math.max(1, SITUACION[fase]) as VistaPublica["situacionOperativa"]) : 0, // activo ⇒ mínimo 1; cierre ⇒ 0
    avisos,
    recomendaciones,
    noticiasVerificadas,
    bulosDesmentidos,
    entorno: { viento: e.entorno.viento, aire: e.entorno.aire },
    tareasVoluntarios: (e.tareasVoluntarios ?? []).filter((t) => t.estado === "abierta" || t.estado === "cubierta").map(({ id, titulo, descripcion, lugar, cupo, aceptados, estado }) => ({ id, titulo, descripcion, lugar, cupo, aceptados, estado })),
    actualizadoEn: e.serverTime,
  };
}
