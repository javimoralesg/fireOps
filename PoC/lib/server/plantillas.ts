// Plantillas deterministas multi-emergencia (sin LLM).
//
// El sistema pasa a estar dirigido por eventos: cualquier evento (periférico,
// sensor, visión, llamada, dato abierto) puede abrir un incidente de cualquier
// tipo. Cuando no hay ANTHROPIC_API_KEY el proponente necesita redactar una
// decisión creíble para CUALQUIER emergencia municipal, no solo para el
// incendio industrial del guion. Este módulo aporta:
//   - clasificarEmergencia(): de qué va el evento (léxico ES + etiquetas EN + categoría + sensor).
//   - FOCOS_POR_TIPO / focoSiguiente(): qué hay que decidir y en qué orden.
//   - plantillaPorTipo(): la propuesta completa, interpolando datos reales.
//
// Nada de efectos de servidor: solo tipos y funciones puras.

import type { AccionPlan, EventoIngesta, ImpactoDomino, PlanPropuesto, TarjetaDecision } from "../types";
import type { CondicionesEntorno, Evidencia, ReglaDoctrina, Urgencia } from "../tipos-sistema";
import type { CategoriaObservacion } from "../tipos-perifericos";
import { destinoViento } from "./conectores/geo";

// ---------------------------------------------------------------------------
// 1. Tipos de emergencia
// ---------------------------------------------------------------------------

export type TipoEmergencia =
  | "incendio_industrial"
  | "incendio_urbano"
  | "incendio_forestal"
  | "inundacion"
  | "accidente_trafico"
  | "accidente_ferroviario"
  | "fuga_gas"
  | "derrumbe"
  | "apagon"
  | "ola_calor"
  | "nevada"
  | "sismo"
  | "aglomeracion"
  | "vertido_quimico"
  | "persona_peligro"
  | "otro";

export const TIPOS_EMERGENCIA: TipoEmergencia[] = [
  "incendio_industrial", "incendio_urbano", "incendio_forestal", "inundacion",
  "accidente_trafico", "accidente_ferroviario", "fuga_gas", "derrumbe",
  "apagon", "ola_calor", "nevada", "sismo", "aglomeracion", "vertido_quimico",
  "persona_peligro", "otro",
];

// ---------------------------------------------------------------------------
// 2. Clasificador heurístico
// ---------------------------------------------------------------------------

/** Minúsculas y sin tildes: los patrones se escriben ya normalizados. */
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface ClaveLexica { tipo: TipoEmergencia; re: RegExp; peso: number; etiqueta: string }

const CLAVES: ClaveLexica[] = [
  // --- familia fuego: el término genérico reparte, el modificador decide ---
  { tipo: "incendio_urbano", re: /incendio|fuego|llamas|ardiendo|arde\b|conato|fire\b|flames/, peso: 2, etiqueta: "fuego" },
  { tipo: "incendio_urbano", re: /vivienda|edificio|piso\b|atico|portal|bloque|garaje|hotel|colegio|building_fire|apartment|house_fire/, peso: 2, etiqueta: "edificio residencial" },
  { tipo: "incendio_urbano", re: /humo|smoke/, peso: 1, etiqueta: "humo" },
  { tipo: "incendio_industrial", re: /incendio|fuego|llamas|fire\b/, peso: 1, etiqueta: "fuego" },
  { tipo: "incendio_industrial", re: /nave\b|naves\b|industrial|poligono|almacen|fabrica|deposito|warehouse|factory|industrial_building/, peso: 3, etiqueta: "instalación industrial" },
  { tipo: "incendio_forestal", re: /incendio|fuego|llamas|fire\b/, peso: 1, etiqueta: "fuego" },
  { tipo: "incendio_forestal", re: /forestal|monte\b|pinar|matorral|vegetacion|bosque|pastos|dehesa|casa de campo|wildfire|brush|forest/, peso: 3, etiqueta: "masa forestal" },
  // --- agua ---
  { tipo: "inundacion", re: /inundacion|inundad|riada|desbordamiento|desbordad|anegad|crecida|tromba|dana\b|paso inferior|nivel del rio|flood|flooding|standing_water/, peso: 3, etiqueta: "inundación" },
  { tipo: "inundacion", re: /lluvia|precipitacion|mm\/h|tormenta|granizo|agua\b|rain|water/, peso: 1, etiqueta: "lluvia" },
  // --- tráfico ---
  { tipo: "accidente_trafico", re: /accidente|colision|choque|atropello|vuelco|salida de via|alcance multiple|crash|car_crash|collision|vehicle/, peso: 2, etiqueta: "accidente de tráfico" },
  { tipo: "accidente_trafico", re: /m-?30|a-\d|autovia|autopista|calzada|carril|rotonda|coche|camion|motorista|turismo/, peso: 1, etiqueta: "vía urbana" },
  { tipo: "accidente_ferroviario", re: /tren\b|ferroviario|cercanias|convoy|vagon|descarril|adif|renfe|anden|catenaria|metro de madrid|railway|train|derailment/, peso: 3, etiqueta: "ferrocarril" },
  // --- gas ---
  { tipo: "fuga_gas", re: /fuga de gas|olor a gas|escape de gas|butano|propano|metano|monoxido|bombona|gas_leak|lpg|glp/, peso: 3, etiqueta: "fuga de gas" },
  { tipo: "fuga_gas", re: /\bgas\b|gasoducto|nedgia|explosion/, peso: 2, etiqueta: "gas" },
  // --- estructuras ---
  { tipo: "derrumbe", re: /derrumbe|colapso|desplome|hundimiento|forjado|medianera|escombros|collapse|building_collapse|rubble/, peso: 3, etiqueta: "derrumbe" },
  { tipo: "derrumbe", re: /grieta|fisura|apuntalam|andamio/, peso: 1, etiqueta: "daño estructural" },
  // --- energía ---
  { tipo: "apagon", re: /apagon|corte de luz|sin luz|sin suministro electrico|cero energetico|blackout|power_outage|power cut/, peso: 3, etiqueta: "apagón" },
  { tipo: "apagon", re: /subestacion|iberdrola|\bufd\b|red electrica|semaforos apagados|ascensores parados|tension de red/, peso: 2, etiqueta: "red eléctrica" },
  // --- meteorología ---
  { tipo: "ola_calor", re: /ola de calor|calor extremo|golpe de calor|aviso rojo por calor|deshidratacion|heatwave|heat_wave/, peso: 3, etiqueta: "ola de calor" },
  { tipo: "ola_calor", re: /calor\b|temperatura|grados/, peso: 1, etiqueta: "temperatura" },
  { tipo: "nevada", re: /nevada|nieve|nevando|placas de hielo|helada|temporal de nieve|filomena|snow|blizzard|black_ice/, peso: 3, etiqueta: "nieve o hielo" },
  { tipo: "sismo", re: /sismo|seismo|terremoto|temblor|richter|replica|earthquake|seismic|\bpga\b/, peso: 3, etiqueta: "movimiento sísmico" },
  // --- multitudes ---
  { tipo: "aglomeracion", re: /aglomeracion|avalancha|multitud|gentio|estampida|masificacion|aforo|crowd|stampede|crowd_crush/, peso: 3, etiqueta: "aglomeración" },
  { tipo: "aglomeracion", re: /concierto|manifestacion|cabalgata|partido|fiesta|cola de/, peso: 1, etiqueta: "evento multitudinario" },
  // --- química ---
  { tipo: "vertido_quimico", re: /vertido|derrame|sustancia peligrosa|quimic|toxic|acido|amoniaco|cloro|hidrocarburo|cisterna|spill|chemical|hazmat/, peso: 3, etiqueta: "vertido químico" },
  // --- personas ---
  { tipo: "persona_peligro", re: /persona atrapada|personas atrapadas|desaparecid|ahogamiento|precipitado|persona en peligro|rescate de una persona|person_in_danger|drowning|missing_person/, peso: 3, etiqueta: "persona en peligro" },
  { tipo: "persona_peligro", re: /herido grave|inconsciente|balcon|tejado|pozo\b/, peso: 1, etiqueta: "riesgo para una persona" },
];

// Partial: CategoriaObservacion crece con la capa de periféricos; las categorías
// no mapeadas simplemente no suman puntos.
const CATEGORIA_PESOS: Partial<Record<CategoriaObservacion, { tipo: TipoEmergencia; peso: number }[]>> = {
  incendio: [{ tipo: "incendio_urbano", peso: 3 }, { tipo: "incendio_industrial", peso: 2 }, { tipo: "incendio_forestal", peso: 2 }],
  humo: [{ tipo: "incendio_urbano", peso: 2 }, { tipo: "incendio_industrial", peso: 2 }, { tipo: "incendio_forestal", peso: 1 }],
  inundacion: [{ tipo: "inundacion", peso: 4 }],
  accidente: [{ tipo: "accidente_trafico", peso: 3 }, { tipo: "accidente_ferroviario", peso: 1 }],
  derrumbe: [{ tipo: "derrumbe", peso: 4 }],
  aglomeracion: [{ tipo: "aglomeracion", peso: 4 }],
  persona_en_peligro: [{ tipo: "persona_peligro", peso: 4 }],
  vertido: [{ tipo: "vertido_quimico", peso: 4 }],
  corte_electrico: [{ tipo: "apagon", peso: 4 }],
  explosion: [{ tipo: "fuga_gas", peso: 3 }, { tipo: "incendio_industrial", peso: 2 }, { tipo: "derrumbe", peso: 1 }],
  fuga_gas: [{ tipo: "fuga_gas", peso: 4 }],
  terremoto: [{ tipo: "sismo", peso: 4 }],
  ola_calor: [{ tipo: "ola_calor", peso: 4 }],
  nevada: [{ tipo: "nevada", peso: 4 }],
  accidente_ferroviario: [{ tipo: "accidente_ferroviario", peso: 4 }],
  amenaza: [{ tipo: "aglomeracion", peso: 1 }],
  sin_novedad: [],
  otro: [],
};

function pesosDeSensor(s: { magnitud: string; valor: number; unidad: string }): { tipo: TipoEmergencia; peso: number; etiqueta: string }[] {
  const m = normalizar(s.magnitud);
  const u = normalizar(s.unidad || "");
  const et = `sensor ${s.magnitud} = ${s.valor} ${s.unidad}`.trim();
  if (/nivel_rio|nivel de rio|nivel_agua|caudal|pluviom|precipit|lluvia/.test(m) || /mm\/h/.test(u))
    return [{ tipo: "inundacion", peso: 5, etiqueta: et }];
  if (/aceleracion|pga|sismo|richter|magnitud_sismica/.test(m))
    return [{ tipo: "sismo", peso: 5, etiqueta: et }];
  if (/^co$|\bco\b|co2|gas|metano|monoxido|lpg|glp|butano|propano|voc/.test(m))
    return [{ tipo: "fuga_gas", peso: 5, etiqueta: et }];
  if (/tension|voltaje|demanda|frecuencia_red|potencia|carga_red/.test(m) || /\bkv\b|\bmw\b/.test(u))
    return [{ tipo: "apagon", peso: 5, etiqueta: et }];
  if (/temperatura|temp$/.test(m)) {
    if (s.valor >= 36) return [{ tipo: "ola_calor", peso: 5, etiqueta: et }];
    if (s.valor <= 0) return [{ tipo: "nevada", peso: 4, etiqueta: et }];
    return [];
  }
  if (/humo|pm25|pm10|particul|opacidad/.test(m))
    return [{ tipo: "incendio_urbano", peso: 3, etiqueta: et }, { tipo: "incendio_industrial", peso: 2, etiqueta: et }];
  return [];
}

/**
 * Heurística de clasificación: léxico en español, etiquetas de visión en inglés,
 * CategoriaObservacion de los periféricos (poc-07) y magnitudes de sensor.
 * Devuelve "otro" con confianza baja si no hay ninguna señal.
 */
export function clasificarEmergencia(x: {
  titulo: string;
  detalle: string;
  categoria?: string;
  etiquetas?: string[];
  sensor?: { magnitud: string; valor: number; unidad: string };
}): { tipo: TipoEmergencia; confianza: number; motivo: string } {
  const texto = normalizar(`${x.titulo ?? ""} ${x.detalle ?? ""} ${(x.etiquetas ?? []).join(" ")}`);
  const puntos: Partial<Record<TipoEmergencia, number>> = {};
  const razones: Partial<Record<TipoEmergencia, string[]>> = {};
  const suma = (tipo: TipoEmergencia, peso: number, etiqueta: string) => {
    puntos[tipo] = (puntos[tipo] ?? 0) + peso;
    (razones[tipo] = razones[tipo] ?? []).push(etiqueta);
  };

  for (const c of CLAVES) if (c.re.test(texto)) suma(c.tipo, c.peso, c.etiqueta);

  const cat = normalizar(x.categoria ?? "") as CategoriaObservacion;
  const porCategoria = CATEGORIA_PESOS[cat];
  if (porCategoria) for (const p of porCategoria) suma(p.tipo, p.peso, `categoría "${x.categoria}"`);

  if (x.sensor) for (const p of pesosDeSensor(x.sensor)) suma(p.tipo, p.peso, p.etiqueta);

  let mejor: TipoEmergencia = "otro";
  let pMejor = 0;
  let pSegundo = 0;
  for (const t of TIPOS_EMERGENCIA) {
    const p = puntos[t] ?? 0;
    if (p > pMejor) { pSegundo = pMejor; pMejor = p; mejor = t; }
    else if (p > pSegundo) pSegundo = p;
  }

  if (pMejor === 0) {
    return { tipo: "otro", confianza: 0.15, motivo: "Sin señal léxica, de categoría ni de sensor reconocible: se clasifica como emergencia genérica." };
  }
  const confianza = Math.round(Math.max(0.2, Math.min(0.95, 0.28 + 0.12 * pMejor - 0.06 * pSegundo)) * 100) / 100;
  const vistos = (razones[mejor] ?? []).filter((r, i, a) => a.indexOf(r) === i);
  return {
    tipo: mejor,
    confianza,
    motivo: `Señales detectadas: ${vistos.join(", ")} (${pMejor} pts frente a ${pSegundo} de la siguiente hipótesis).`,
  };
}

// ---------------------------------------------------------------------------
// 3. Focos de decisión por tipo
// ---------------------------------------------------------------------------

export interface FocoTipo {
  clave: string;
  descripcion: string;
  orden: number;
  /** Solo procede si el último evento lo justifica (se prueba contra `${titulo} ${detalle}`). */
  requiereEvento?: RegExp;
}

const f = (clave: string, descripcion: string, orden: number, requiereEvento?: RegExp): FocoTipo =>
  requiereEvento ? { clave, descripcion, orden, requiereEvento } : { clave, descripcion, orden };

export const FOCOS_POR_TIPO: Record<TipoEmergencia, FocoTipo[]> = {
  incendio_industrial: [
    f("despliegue_inicial", "Primera respuesta: qué medios enviar, perímetro y prioridad de protección. Aún no hay confirmación oficial de heridos.", 1),
    f("corte_m30", "El humo cruza la vía rápida. Decidir si se corta (total o parcial) usando la carga real de tráfico de los sensores municipales.", 2),
    f("hospital", "El grafo muestra que la vía bloqueada abastece a un hospital. Decidir protección del centro sanitario y preposicionamiento de SAMUR-PC.", 3),
    f("evacuacion", "Población vulnerable en el eje del humo (residencia de mayores, colegio). Decidir evacuación o confinamiento, destino y medios.", 4),
    f("replanificacion_viento", "El viento ha rolado y la columna de humo cambia de eje. Replanificar protección sanitaria, ruta de evacuación, corte de tráfico y posición de bomberos.", 5, /viento|rola|rolad|racha|meteo|direccion del humo|cambio brusco/i),
    f("comunicado", "Rumores en redes y presencia de prensa. Decidir comunicado oficial y alerta a la población.", 6),
  ],
  incendio_urbano: [
    f("despliegue_inicial", "Primera respuesta en incendio de edificio: medios, ataque y control de escalera y patios.", 1),
    f("evacuacion_edificio", "Decidir evacuación vertical del inmueble o confinamiento en viviendas con puerta estanca.", 2),
    f("corte_accesos", "Decidir corte de la calle y accesos para dar espacio a autoescalas y ambulancias.", 3),
    f("apoyo_sanitario", "Decidir despliegue sanitario: triaje en portal, intoxicados por humo y hospital de referencia.", 4),
    f("comunicado", "Decidir información a vecinos y medios: instrucciones de autoprotección y realojo.", 5),
  ],
  incendio_forestal: [
    f("despliegue_inicial", "Primera respuesta en incendio forestal: ataque directo, líneas de defensa y medios del operativo.", 1),
    f("defensa_interfaz", "Decidir la defensa de la interfaz urbano-forestal: viviendas, cámpines y polígonos en el flanco activo.", 2),
    f("evacuacion_preventiva", "Decidir evacuación preventiva de las urbanizaciones en la dirección de propagación.", 3),
    f("corte_carreteras", "Decidir corte de carreteras y caminos por humo y paso de medios.", 4),
    f("comunicado", "Decidir comunicado y alerta a la población de los municipios afectados.", 5),
  ],
  inundacion: [
    f("activacion_plan_inundacion", "Activación del plan de inundaciones: qué medios se movilizan y qué cuencas y puntos negros se vigilan.", 1),
    f("cierre_pasos_inferiores", "Decidir el cierre de pasos inferiores, túneles y vados inundables antes de que haya vehículos atrapados.", 2),
    f("evacuacion_zona_baja", "Decidir evacuación o confinamiento en altura de bajos, sótanos y garajes de la zona inundable.", 3),
    f("corte_suministro_electrico", "Decidir el corte preventivo de suministro eléctrico en cuadros y garajes anegados.", 4, /sotano|garaje|subestacion|electric|cuadro|transformador|agua en el portal|s[oó]tano|el[eé]ctric/i),
    f("refugios", "Decidir apertura de refugios y albergue temporal para los desalojados.", 5),
    f("comunicado", "Decidir comunicado y alerta a la población con instrucciones de autoprotección.", 6),
  ],
  accidente_trafico: [
    f("activacion_plan_accidente_trafico", "Activación de la respuesta al accidente: medios de rescate, sanitarios y balizamiento.", 1),
    f("rescate_atrapados", "Decidir la excarcelación de ocupantes atrapados y la estabilización de los vehículos.", 2),
    f("corte_via_desvio", "Decidir el corte de la vía y el itinerario de desvío con los datos reales de carga de tráfico.", 3),
    f("evacuacion_sanitaria", "Decidir el reparto de heridos entre hospitales y la necesidad de puesto médico avanzado.", 4),
    f("comunicado", "Decidir información al tráfico y a los medios sobre cortes y tiempos de restablecimiento.", 5),
  ],
  accidente_ferroviario: [
    f("activacion_plan_accidente_ferroviario", "Activación de la respuesta ferroviaria con Adif/Metro: acceso al punto kilométrico y seguridad de la vía.", 1),
    f("corte_circulacion_catenaria", "Decidir el corte de circulación y el descargo de catenaria antes de que entren los equipos de rescate.", 2),
    f("rescate_y_triaje", "Decidir el dispositivo de rescate en el convoy y el triaje de víctimas en andén o trinchera.", 3),
    f("transporte_alternativo", "Decidir el plan alternativo de transporte para los viajeros afectados.", 4, /pasajer|viajer|estacion|servicio|linea|and[eé]n|estaci[oó]n|l[ií]nea/i),
    f("comunicado", "Decidir comunicado conjunto con el operador ferroviario y teléfono de información a familiares.", 5),
  ],
  fuga_gas: [
    f("activacion_plan_fuga_gas", "Activación de la respuesta a fuga de gas: medición de atmósfera, ausencia de fuentes de ignición y zonificación.", 1),
    f("corte_suministro_gas", "Decidir el corte del suministro de gas en la acometida o el ramal afectado.", 2),
    f("perimetro_confinamiento", "Decidir el perímetro de seguridad y el confinamiento de los edificios dentro del radio.", 3),
    f("evacuacion_radio", "Decidir la evacuación del radio interior si la concentración medida no baja.", 4),
    f("comunicado", "Decidir aviso a la población: no accionar interruptores, no usar ascensores, ventilar.", 5),
  ],
  derrumbe: [
    f("activacion_plan_derrumbe", "Activación de la respuesta a derrumbe: rescate en estructuras colapsadas y seguridad de la zona cero.", 1),
    f("busqueda_y_rescate", "Decidir el dispositivo de búsqueda con unidades caninas, escucha y rescate técnico.", 2),
    f("apuntalamiento", "Decidir el apuntalamiento y la evaluación de los edificios contiguos y medianeras.", 3, /grieta|fisura|estructur|apuntal|contigu|medianer|edificio|colind/i),
    f("desalojo_manzana", "Decidir el desalojo preventivo de la manzana y el realojo de los afectados.", 4),
    f("comunicado", "Decidir comunicado, teléfono de familiares y punto de información a vecinos.", 5),
  ],
  apagon: [
    f("activacion_plan_apagon", "Activación del plan de apagón: alcance del corte, distribuidora y previsión de restablecimiento.", 1),
    f("prioridad_hospitales_generadores", "Decidir la prioridad de restablecimiento y el apoyo con grupos electrógenos a hospitales y residencias.", 2),
    f("semaforos_policia", "Decidir la regulación manual de tráfico en los cruces con semáforos apagados.", 3),
    f("rescate_ascensores", "Decidir el dispositivo de rescate de personas atrapadas en ascensores.", 4, /ascensor|atrapad|elevador|vecin/i),
    f("comunicado", "Decidir comunicado con la previsión de restablecimiento y recomendaciones de consumo.", 5),
  ],
  ola_calor: [
    f("activacion_plan_ola_calor", "Activación del plan de ola de calor: nivel de alerta, refuerzo sanitario y vigilancia de vulnerables.", 1),
    f("refugios_climaticos", "Decidir la apertura y ampliación de horario de los refugios climáticos municipales.", 2),
    f("aviso_vulnerables", "Decidir el aviso proactivo a mayores solos, residencias y personas sin hogar.", 3),
    f("horario_obras", "Decidir la restricción del horario de obras y trabajos al aire libre en las horas centrales.", 4),
    f("comunicado", "Decidir comunicado con recomendaciones de hidratación y teléfonos de atención.", 5),
  ],
  nevada: [
    f("activacion_plan_nevada", "Activación del plan de nevadas: turnos de quitanieves, salmuera y vías prioritarias.", 1),
    f("tratamiento_vias", "Decidir el tratamiento preventivo con fundentes en la red viaria prioritaria y accesos hospitalarios.", 2),
    f("restriccion_trafico", "Decidir la restricción de tráfico pesado y la obligación de cadenas o neumáticos de invierno.", 3),
    f("refugios_sin_hogar", "Decidir la campaña de frío: plazas de albergue y equipos de calle para personas sin hogar.", 4),
    f("comunicado", "Decidir comunicado con el estado de las vías y las recomendaciones de movilidad.", 5),
  ],
  sismo: [
    f("activacion_plan_sismo", "Activación del plan sísmico: reconocimiento rápido de daños y censo de edificios sensibles.", 1),
    f("busqueda_y_rescate", "Decidir el despliegue de rescate en los edificios con colapso o atrapados.", 2),
    f("evaluacion_estructural", "Decidir la inspección estructural y el semáforo de habitabilidad de los edificios afectados.", 3, /grieta|dano|estructur|edificio|replica|da[nñ]o|r[eé]plica/i),
    f("refugios_y_puntos_reunion", "Decidir la apertura de refugios y puntos de reunión al aire libre para la población desalojada.", 4),
    f("comunicado", "Decidir comunicado con instrucciones ante réplicas y puntos de información.", 5),
  ],
  aglomeracion: [
    f("activacion_plan_aglomeracion", "Activación del dispositivo de control de multitudes: mando único, aforo y vías de escape.", 1),
    f("control_aforo_accesos", "Decidir el cierre de accesos y el control de aforo para reducir la densidad de personas.", 2),
    f("pasillo_sanitario", "Decidir la apertura de un pasillo sanitario y el puesto de atención dentro del recinto.", 3),
    f("dispersion_ordenada", "Decidir la dispersión ordenada por rutas de salida y el refuerzo de transporte público.", 4),
    f("comunicado", "Decidir megafonía y comunicado con instrucciones de salida y accesos alternativos.", 5),
  ],
  vertido_quimico: [
    f("activacion_plan_vertido_quimico", "Activación de la respuesta NRBQ: identificación del producto, zonificación y equipos de protección.", 1),
    f("contencion_vertido", "Decidir la contención del vertido con barreras, absorbentes y sellado de imbornales.", 2),
    f("corte_captacion_agua", "Decidir el corte de captación y abastecimiento de agua aguas abajo del vertido.", 3),
    f("confinamiento_perimetro", "Decidir el confinamiento de la población del perímetro por vapores o riesgo de contacto.", 4),
    f("comunicado", "Decidir comunicado con instrucciones de no consumir agua y evitar la zona.", 5),
  ],
  persona_peligro: [
    f("activacion_plan_persona_peligro", "Activación del dispositivo de rescate: localización, medios especializados y seguridad de los intervinientes.", 1),
    f("localizacion_y_rescate", "Decidir la técnica de rescate y los medios especializados (altura, agua, espacio confinado).", 2),
    f("apoyo_sanitario", "Decidir la cobertura sanitaria y psicológica para la persona rescatada y su entorno.", 3),
    f("comunicado", "Decidir qué se comunica, preservando datos personales y la intimidad de la persona.", 4),
  ],
  otro: [
    f("activacion_plan_otro", "Activación de la respuesta genérica: valorar el aviso, asignar mando y decidir medios mínimos.", 1),
    f("valoracion_in_situ", "Decidir el reconocimiento sobre el terreno para confirmar la naturaleza y el alcance del suceso.", 2),
    f("medidas_de_proteccion", "Decidir las medidas de protección de la población compatibles con lo observado.", 3),
    f("comunicado", "Decidir si procede informar a la población y en qué términos.", 4),
  ],
};

/** Siguiente foco pendiente de un tipo, respetando el orden y requiereEvento. */
export function focoSiguiente(
  tipo: TipoEmergencia,
  focosYaPropuestos: string[],
  ultimoEvento?: EventoIngesta,
): FocoTipo | null {
  const focos = FOCOS_POR_TIPO[tipo] ?? FOCOS_POR_TIPO.otro;
  const hechos = new Set(focosYaPropuestos ?? []);
  const texto = ultimoEvento ? `${ultimoEvento.titulo ?? ""} ${ultimoEvento.detalle ?? ""}` : "";
  for (const foco of [...focos].sort((a, b) => a.orden - b.orden)) {
    if (hechos.has(foco.clave)) continue;
    if (foco.requiereEvento && !foco.requiereEvento.test(texto)) continue;
    return foco;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Contrato de la plantilla
// ---------------------------------------------------------------------------

/** Incidente mínimo que necesita la plantilla (compatible con `Incidente`). */
export interface IncidentePlantilla {
  id: string;
  titulo: string;
  tipo: string;
  ubicacion: { nombre: string; lat: number; lon: number };
}

export interface ContextoPlantilla {
  incidente: IncidentePlantilla;
  entorno: CondicionesEntorno;
  /** Eventos del incidente, el más reciente primero. */
  eventos: EventoIngesta[];
  domino: ImpactoDomino[];
  doctrina: ReglaDoctrina[];
  evidencia: Evidencia[];
  descripcionFoco: string;
  planAnterior?: PlanPropuesto;
  feedback?: string;
  version: number;
}

/** Exactamente `Omit<Propuesta, "modelo" | "latenciaMs">` de proponente.ts. */
export interface PropuestaPlantilla {
  tarjeta: TarjetaDecision;
  urgencia: Urgencia;
  riesgo: number;
  costeDeNoActuar: string;
  plazoMinutos: number;
  evidenciaIds: string[];
  alternativasDescartadas: { opcion: string; motivo: string }[];
  generadaPor: "plantilla";
}

type Accion = Omit<AccionPlan, "id">;
type Alternativa = { opcion: string; motivo: string };

interface Receta {
  titulo: string;
  resumen: string;
  severidad: TarjetaDecision["severidad"];
  protocolo: { codigo?: string; nombre: string };
  razonamiento: string;
  acciones: Accion[];
  mensajeAlerta: string;
  urgencia: Urgencia;
  riesgo: number;
  costeDeNoActuar: string;
  plazoMinutos: number;
  alternativas: Alternativa[];
}

type Generador = (d: Datos) => Receta;

const A = (recurso: string, accion: string, eta: string, prioridad: Accion["prioridad"] = "alta"): Accion => ({ recurso, accion, eta, prioridad });
const alt = (opcion: string, motivo: string): Alternativa => ({ opcion, motivo });
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)));

// Etiqueta legible, prefijo PEMAM y consigna de autoprotección por tipo.
interface PerfilTipo { etiqueta: string; prefijo: string; autoproteccion: string }

const PERFIL_TIPO: Record<TipoEmergencia, PerfilTipo> = {
  incendio_industrial: { etiqueta: "incendio industrial", prefijo: "IND", autoproteccion: "cierre ventanas, apague la climatización y evite la zona" },
  incendio_urbano: { etiqueta: "incendio urbano", prefijo: "INC", autoproteccion: "no use el ascensor, cierre puertas y espere indicaciones de los bomberos" },
  incendio_forestal: { etiqueta: "incendio forestal", prefijo: "FOR", autoproteccion: "no use los caminos forestales y siga las rutas de salida señalizadas" },
  inundacion: { etiqueta: "inundación", prefijo: "INU", autoproteccion: "no cruce pasos inferiores ni vados, suba a plantas altas y no baje al garaje" },
  accidente_trafico: { etiqueta: "accidente de tráfico", prefijo: "TRA", autoproteccion: "evite la zona y respete los desvíos señalizados" },
  accidente_ferroviario: { etiqueta: "accidente ferroviario", prefijo: "FER", autoproteccion: "no acceda a las vías y utilice el transporte alternativo habilitado" },
  fuga_gas: { etiqueta: "fuga de gas", prefijo: "GAS", autoproteccion: "no accione interruptores ni timbres, no use el ascensor y ventile" },
  derrumbe: { etiqueta: "derrumbe", prefijo: "DER", autoproteccion: "aléjese de fachadas y no acceda a la zona acordonada" },
  apagon: { etiqueta: "apagón", prefijo: "APA", autoproteccion: "no use los ascensores, limite el consumo y desconecte aparatos sensibles" },
  ola_calor: { etiqueta: "ola de calor", prefijo: "CAL", autoproteccion: "hidrátese, evite el exterior entre las 12 y las 19 h y vigile a mayores solos" },
  nevada: { etiqueta: "nevada", prefijo: "NEV", autoproteccion: "evite desplazamientos, use transporte público y lleve cadenas" },
  sismo: { etiqueta: "seísmo", prefijo: "SIS", autoproteccion: "salga a espacios abiertos, aléjese de fachadas y no use ascensores" },
  aglomeracion: { etiqueta: "aglomeración", prefijo: "AGL", autoproteccion: "no empuje, siga las salidas señalizadas y no acceda al recinto" },
  vertido_quimico: { etiqueta: "vertido químico", prefijo: "QUI", autoproteccion: "no consuma agua de la red hasta nuevo aviso y evite el contacto con el vertido" },
  persona_peligro: { etiqueta: "rescate de persona en peligro", prefijo: "PER", autoproteccion: "deje trabajar a los equipos y no se acerque al dispositivo" },
  otro: { etiqueta: "emergencia municipal", prefijo: "GEN", autoproteccion: "siga las indicaciones de los servicios de emergencia y evite la zona" },
};

// ---------------------------------------------------------------------------
// 5. Datos derivados del contexto (todo lo que interpolan las plantillas)
// ---------------------------------------------------------------------------

interface Restricciones {
  sinAereos: boolean;
  cortesParciales: boolean;
  prioridadSanidad: boolean;
  evitarEvacuacion: boolean;
  costeContenido: boolean;
  conVoluntarios: boolean;
  sinVoluntarios: boolean;
}

interface Datos {
  tipo: TipoEmergencia;
  foco: string;
  perfil: PerfilTipo;
  lugar: string;
  lugarCorto: string;
  v: CondicionesEntorno["viento"];
  hacia: string;
  dViento: string;
  dTrafico: string | null;
  dAire: string | null;
  dDemanda: string | null;
  dEvento: string | null;
  carga: number | null;
  pm25: number | null;
  demandaMW: number | null;
  ultimo?: EventoIngesta;
  ultimoTitulo: string;
  colaEvento: string;
  contextoEntorno: string;
  doctrinaTxt: string;
  feedbackTxt: string;
  restr: Restricciones;
  version: number;
  domino: ImpactoDomino[];
  dominoTop: string | null;
  descripcionFoco: string;
  tit(base: string, ...datos: (string | null | undefined)[]): string;
}

const RE_MAGNITUD = /(\d+(?:[.,]\d+)?)\s?(mm\/h|mm|km\/h|m\/s|ºc|°c|ppm|µg\/m³|ug\/m3|kv\b|mw\b|kw\b|%|m³\/s|cm|km|m\b)/i;

function magnitudDeTexto(txt: string): string | null {
  const m = RE_MAGNITUD.exec(txt);
  if (!m) return null;
  return `${m[1]} ${m[2].replace(/ºc/i, "°C").replace(/°c/i, "°C").replace(/ug\/m3/i, "µg/m³")}`;
}

function nombreCorto(nombre: string): string {
  const partes = (nombre || "").split(",").map((p) => p.trim()).filter(Boolean);
  const sinMadrid = partes.filter((p) => !/^madrid$/i.test(p));
  return sinMadrid[sinMadrid.length - 1] || partes[0] || "Madrid";
}

const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const recorta = (s: string, n: number) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || "");

function leerRestricciones(doctrina: ReglaDoctrina[], feedback?: string): Restricciones {
  const textos = [
    ...(doctrina ?? []).filter((r) => r.activa !== false).map((r) => `${r.reglaNormalizada ?? ""} ${r.texto ?? ""}`),
    feedback ?? "",
  ].filter((t) => t.trim().length > 0);
  const hay = (re: RegExp) => textos.some((t) => re.test(t));
  const negado = (re: RegExp) => textos.some((t) => re.test(t) && /\bno\b|nunca|evita|evitar|sin\s|prohib|jam[aá]s|[uú]ltimo recurso|solo si/i.test(t));
  const mencionaEvac = hay(/evacu/i);
  const mencionaVol = hay(/voluntari/i);
  return {
    sinAereos: hay(/a[eé]reo|helic[oó]pter|dron/i),
    cortesParciales: hay(/parcial/i) || hay(/no cort|sin cortar|no cerrar la v[ií]a/i),
    prioridadSanidad: hay(/hospital|sanitari|urgencias|samur|summa/i),
    evitarEvacuacion: mencionaEvac && negado(/evacu/i),
    costeContenido: hay(/coste|econ[oó]mic|presupuest|gasto|factura/i),
    conVoluntarios: mencionaVol && !negado(/voluntari/i),
    sinVoluntarios: mencionaVol && negado(/voluntari/i),
  };
}

function derivar(tipo: TipoEmergencia, foco: string, c: ContextoPlantilla): Datos {
  const perfil = PERFIL_TIPO[tipo] ?? PERFIL_TIPO.otro;
  const ultimo = (c.eventos ?? [])[0];
  const lugar = ultimo?.ubicacion || c.incidente.ubicacion?.nombre || "Madrid";
  const v = c.entorno.viento;
  const tr = c.entorno.trafico;
  const aire = c.entorno.aire;
  const dem = c.entorno.demandaElectricaMW;
  const carga = tr ? Math.round(tr.sensorPeor?.carga ?? tr.cargaMedia) : null;
  const hacia = destinoViento(v.direccionGrados);
  const version = c.version > 0 ? c.version : (c.planAnterior?.version ?? 0) + 1;
  const restr = leerRestricciones(c.doctrina ?? [], c.feedback);
  const reglas = (c.doctrina ?? []).filter((r) => r.activa !== false);
  const dominoTop = (c.domino ?? []).length
    ? `${c.domino[0].infraestructura} (riesgo ${c.domino[0].riesgo}/100 vía ${c.domino[0].ruta.join(" → ")})`
    : null;

  const d: Datos = {
    tipo,
    foco,
    perfil,
    lugar,
    lugarCorto: nombreCorto(lugar),
    v,
    hacia,
    dViento: `viento ${v.velocidadKmh} km/h del ${v.direccionTexto}`,
    dTrafico: carga !== null ? `tráfico al ${carga} %` : null,
    dAire: aire ? `PM2.5 ${aire.pm25} µg/m³` : null,
    dDemanda: dem ? `demanda ${miles(dem.valor)} MW` : null,
    dEvento: ultimo ? magnitudDeTexto(`${ultimo.titulo} ${ultimo.detalle}`) : null,
    carga,
    pm25: aire ? aire.pm25 : null,
    demandaMW: dem ? Math.round(dem.valor) : null,
    ultimo,
    ultimoTitulo: ultimo ? ultimo.titulo : "sin partes nuevos",
    colaEvento: ultimo
      ? ` Último parte [${ultimo.fuente}] "${ultimo.titulo}": ${recorta(ultimo.detalle, 180)} (confianza ${Math.round((ultimo.confianza ?? 0) * 100)} %).`
      : " No hay partes nuevos desde la última propuesta.",
    contextoEntorno: `Entorno real al proponer: viento ${v.velocidadKmh} km/h del ${v.direccionTexto} (deriva hacia el ${hacia}, fuente ${v.fuente})${
      tr ? `; ${tr.sensoresCercanos} sensores de tráfico en 1,5 km con carga media ${tr.cargaMedia} %${tr.sensorPeor ? ` y peor punto ${tr.sensorPeor.descripcion} al ${Math.round(tr.sensorPeor.carga)} %` : ""}` : ""
    }${aire ? `; aire PM2.5 ${aire.pm25} µg/m³, PM10 ${aire.pm10} µg/m³, CO ${aire.co}` : ""}${dem ? `; demanda eléctrica peninsular ${miles(dem.valor)} MW` : ""}.`,
    doctrinaTxt: reglas.length
      ? ` Doctrina activa: ${reglas.length} regla(s) del mando aplicadas (${reglas.slice(0, 3).map((r) => r.id).join(", ")}).${restr.costeContenido ? " Se elige la opción de menor coste compatible con la seguridad." : ""}`
      : " Sin reglas de doctrina activas.",
    feedbackTxt: c.feedback ? ` Plan v${version} regenerado tras la denegación: "${recorta(c.feedback, 160)}".` : "",
    restr,
    version,
    domino: c.domino ?? [],
    dominoTop,
    descripcionFoco: c.descripcionFoco ?? "",
    tit: () => "",
  };
  d.tit = (base: string, ...datos: (string | null | undefined)[]) => {
    const lista = (datos.length ? datos : [d.dEvento, d.dTrafico, d.dViento]).filter((x): x is string => Boolean(x));
    const unicos = lista.filter((x, i) => lista.indexOf(x) === i).slice(0, 2);
    return unicos.length ? `${base} en ${d.lugarCorto}: ${unicos.join(" y ")}` : `${base} en ${d.lugarCorto}`;
  };
  return d;
}

// ---------------------------------------------------------------------------
// 6. Aplicación de la doctrina sobre acciones y riesgo
// ---------------------------------------------------------------------------

function ajustarAcciones(acciones: Accion[], r: Restricciones): Accion[] {
  let out = acciones.map((a) => ({ ...a }));
  if (r.sinAereos) out = out.filter((a) => !/helic[oó]pter|a[eé]re|dron/i.test(`${a.recurso} ${a.accion}`));
  if (r.sinVoluntarios) out = out.filter((a) => !/voluntari/i.test(`${a.recurso} ${a.accion}`));
  if (r.cortesParciales) {
    out = out.map((a) => ({ ...a, accion: a.accion.replace(/(corte|cierre|clausura)\s+total/gi, (_m, p1: string) => `${p1} parcial`) }));
  }
  if (r.evitarEvacuacion) {
    out = out.map((a) =>
      /evacu/i.test(a.accion)
        ? { ...a, accion: `Preparar sin ejecutar (doctrina: evacuación solo con orden expresa del mando) — ${a.accion}`, prioridad: "media" as const }
        : a,
    );
  }
  if (r.prioridadSanidad) {
    const sanitaria = (a: Accion) => /samur|sanitari|hospital|urgencias|summa|m[eé]dic/i.test(`${a.recurso} ${a.accion}`);
    out = [...out.filter(sanitaria).map((a) => ({ ...a, prioridad: "alta" as const })), ...out.filter((a) => !sanitaria(a))];
  }
  if (r.conVoluntarios && out.length < 5 && !out.some((a) => /voluntari/i.test(a.recurso))) {
    out.push(A("Voluntarios de Protección Civil", "Activar la bolsa de voluntarios para tareas de bajo riesgo: apoyo logístico, reparto de agua y atención en refugios.", "20 min", "baja"));
  }
  if (out.length < 3) {
    out.push(A("Puesto de Mando Avanzado", "Constituir el PMA con mando único de Bomberos, Policía Municipal y SAMUR-PC, y abrir canal de radio común.", "10 min", "media"));
  }
  return out.slice(0, 5);
}

function ajustarRiesgo(riesgo: number, r: Restricciones): number {
  let n = riesgo;
  if (r.cortesParciales) n = Math.min(n, 55);
  if (r.evitarEvacuacion) n -= 8;
  return clamp(n, 5, 95);
}

function ordenDeFoco(tipo: TipoEmergencia, foco: string): number {
  const focos = FOCOS_POR_TIPO[tipo] ?? FOCOS_POR_TIPO.otro;
  const encontrado = focos.find((x) => x.clave === foco);
  return encontrado ? encontrado.orden : 9;
}

// ---------------------------------------------------------------------------
// 7. Entrada pública: plantillaPorTipo
// ---------------------------------------------------------------------------

/** Propuesta determinista para un (tipo, foco). Nunca lanza: cae a la plantilla genérica. */
export function plantillaPorTipo(tipo: TipoEmergencia, foco: string, c: ContextoPlantilla): PropuestaPlantilla {
  const tipoSeguro: TipoEmergencia = FOCOS_POR_TIPO[tipo] ? tipo : "otro";
  const d = derivar(tipoSeguro, foco, c);
  const r = generadorPara(tipoSeguro, foco)(d);

  const acciones = ajustarAcciones(r.acciones, d.restr);
  const plan: PlanPropuesto = {
    version: d.version,
    razonamiento: `${r.razonamiento}${d.descripcionFoco ? ` Foco de la decisión: ${d.descripcionFoco}` : ""} ${d.contextoEntorno}${d.doctrinaTxt}${d.feedbackTxt}`.trim(),
    acciones: acciones.map((a, i) => ({ id: `a${d.version}-${i + 1}`, ...a })),
    mensajeAlerta: r.mensajeAlerta,
    restricciones: [...(c.planAnterior?.restricciones ?? []), ...(c.feedback ? [c.feedback] : [])],
  };

  const alternativas = [...r.alternativas];
  while (alternativas.length < 2) {
    alternativas.push(alt("No actuar y seguir observando", `Los datos disponibles (${[d.dEvento, d.dTrafico, d.dViento].filter(Boolean).join("; ")}) ya justifican una medida: esperar solo traslada el coste al siguiente turno.`));
  }

  return {
    tarjeta: {
      incidenteId: c.incidente.id,
      titulo: r.titulo,
      resumen: `${r.resumen}${d.colaEvento}`,
      severidad: r.severidad,
      protocolo: {
        codigo: r.protocolo.codigo ?? `PEMAM-${d.perfil.prefijo}-${String(ordenDeFoco(tipoSeguro, foco)).padStart(2, "0")}`,
        nombre: r.protocolo.nombre,
      },
      domino: d.domino,
      plan,
    },
    urgencia: r.urgencia,
    riesgo: ajustarRiesgo(r.riesgo, d.restr),
    costeDeNoActuar: r.costeDeNoActuar,
    plazoMinutos: clamp(r.plazoMinutos, 3, 30),
    evidenciaIds: (c.evidencia ?? []).map((e) => e.id),
    alternativasDescartadas: alternativas.slice(0, 2),
    generadaPor: "plantilla",
  };
}

function generadorPara(tipo: TipoEmergencia, foco: string): Generador {
  const explicito = RECETAS[`${tipo}:${foco}`];
  if (explicito) return explicito;
  if (foco === "comunicado") return recetaComunicado;
  const focos = FOCOS_POR_TIPO[tipo] ?? FOCOS_POR_TIPO.otro;
  if (focos.length && focos[0].clave === foco) return RECETAS[`otro:activacion_plan_otro`];
  return recetaGenerica;
}

// ---------------------------------------------------------------------------
// 8. Recetas comunes (comunicado y genérica)
// ---------------------------------------------------------------------------

const recetaComunicado: Generador = (d) => ({
  titulo: d.tit(`Comunicado oficial y alerta ES-Alert por ${d.perfil.etiqueta}`, d.dEvento, d.dTrafico ?? d.dViento),
  resumen: `Sin mensaje oficial se multiplican los rumores, los curiosos y las llamadas al 112. Se propone un comunicado del Ayuntamiento y una alerta ES-Alert acotada a ${d.lugarCorto} con la consigna de autoprotección: ${d.perfil.autoproteccion}.`,
  severidad: "media",
  protocolo: { nombre: `Información a la población · ${d.perfil.etiqueta}` },
  razonamiento: `La información oficial temprana reduce desplazamientos innecesarios y descarga el 112. El alcance se limita a ${d.lugarCorto} para no generar alarma en el resto de la ciudad.`,
  acciones: [
    A("Gabinete de prensa", `Publicar comunicado municipal sobre la ${d.perfil.etiqueta} en ${d.lugar}, con medidas adoptadas y la instrucción: ${d.perfil.autoproteccion}.`, "5 min", "alta"),
    A("112 / ES-Alert", `Alerta cell broadcast acotada a ${d.lugarCorto} con el texto de autoprotección y el teléfono de información.`, "3 min", "alta"),
    A("Aviso SMS / redes municipales", "Difusión del mismo mensaje por SMS a inscritos y por los canales oficiales del Ayuntamiento, con hora de la próxima actualización.", "4 min", "media"),
    A("Email medios", "Nota a Telemadrid, Europa Press y medios locales con datos verificados y punto de prensa a la hora en punto.", "6 min", "media"),
  ],
  mensajeAlerta: `Ayuntamiento de Madrid: ${d.perfil.etiqueta} en ${d.lugar}. ${d.perfil.autoproteccion[0].toUpperCase()}${d.perfil.autoproteccion.slice(1)}. Más información en emergenciasmadrid.es.`,
  urgencia: "media",
  riesgo: 15,
  costeDeNoActuar: "Rumores y bulos sin desmentir, curiosos en la zona de trabajo y saturación del 112 con llamadas repetidas.",
  plazoMinutos: 20,
  alternativas: [
    alt("Publicar solo en redes sociales sin ES-Alert", "El mensaje no llegaría a quien no sigue las cuentas municipales, que es justo la población de más edad de la zona afectada."),
    alt("ES-Alert a toda la ciudad de Madrid", `La afectación está acotada a ${d.lugarCorto}: una alerta general provocaría alarma y llamadas masivas al 112 sin mejorar la protección.`),
  ],
});

const recetaGenerica: Generador = (d) => ({
  titulo: d.tit(`Medida de protección por ${d.perfil.etiqueta}`, d.dEvento, d.dViento),
  resumen: `Se ha pedido una decisión sobre "${d.foco}" y no existe una plantilla específica para ese paso. Se propone la medida mínima segura: reconocimiento sobre el terreno, perímetro y aviso a la población de ${d.lugarCorto}, revisando la decisión con el siguiente parte.`,
  severidad: "media",
  protocolo: { nombre: `Respuesta genérica a ${d.perfil.etiqueta}` },
  razonamiento: `No hay plantilla específica para el foco "${d.foco}" del tipo ${d.tipo}: se aplica la respuesta mínima segura y se mantiene la decisión abierta hasta el siguiente parte.`,
  acciones: [
    A("Bomberos", `Reconocimiento sobre el terreno en ${d.lugar} y valoración del alcance real del suceso.`, "8 min", "alta"),
    A("Policía Municipal", "Perímetro preventivo y control de accesos mientras se confirma la naturaleza del suceso.", "6 min", "alta"),
    A("SAMUR-PC", "1 unidad de soporte vital avanzado en preventivo en el punto de encuentro.", "10 min", "media"),
    A("Gabinete de prensa", `Aviso breve a la población de ${d.lugarCorto}: ${d.perfil.autoproteccion}.`, "10 min", "baja"),
  ],
  mensajeAlerta: `Centro de Mando: reconocimiento y perímetro preventivo en ${d.lugar}. Confirmen situación y necesidades en cuanto lleguen.`,
  urgencia: "media",
  riesgo: 20,
  costeDeNoActuar: "Perder el reconocimiento inicial y decidir a ciegas en el siguiente turno, con el suceso ya evolucionado.",
  plazoMinutos: 15,
  alternativas: [
    alt("Movilizar el dispositivo completo", "Sin confirmar la naturaleza del suceso, un despliegue máximo deja sin cobertura al resto de la ciudad."),
    alt("No hacer nada hasta el siguiente aviso", `El último parte ("${recorta(d.ultimoTitulo, 60)}") ya describe un riesgo concreto: el reconocimiento es la medida de menor coste.`),
  ],
});

// ---------------------------------------------------------------------------
// 9. Recetas por tipo y foco
// ---------------------------------------------------------------------------

// --- Incendio industrial (los 6 focos del escenario original) ---------------
const RECETAS_FUEGO: Record<string, Generador> = {
  "incendio_industrial:despliegue_inicial": (d) => ({
    titulo: d.tit("Despliegue inicial contra incendio industrial", d.dEvento, d.dViento),
    resumen: `Fuego activo confirmado por visión y por reportes ciudadanos en ${d.lugar}. Con ${d.dViento} la columna de humo deriva hacia el ${d.hacia}${d.dTrafico ? `, sobre viales con ${d.dTrafico}` : ""}${d.dAire ? ` y el aire ya marca ${d.dAire}` : ""}. Se propone ataque por barlovento, sectorización de la nave y perímetro de 300 m.`,
    severidad: "critica",
    protocolo: { codigo: "PEMAM-IND-01", nombre: "Incendio industrial con humo tóxico" },
    razonamiento: "Primera respuesta con los medios del parque más cercano, sectorización de la nave y establecimiento de perímetro de seguridad antes de que el humo alcance los viales.",
    acciones: [
      A("Bomberos Parque 7", "2 autobombas + 1 autoescala; ataque por el flanco de barlovento y sectorización de la nave.", "6 min", "alta"),
      A("Helicóptero Bomberos", "Reconocimiento aéreo del perímetro y de la dirección real de la columna de humo.", "12 min", "media"),
      A("Policía Municipal U-12", `Perímetro de seguridad de 300 m y control de accesos a ${d.lugarCorto}.`, "4 min", "alta"),
      A("SAMUR-PC", "1 unidad de soporte vital avanzado en el puesto de mando avanzado.", "8 min", "media"),
    ],
    mensajeAlerta: `Bomberos Parque 7: incendio industrial confirmado en ${d.lugar} con humo denso. Salida inmediata de 2 autobombas y autoescala.`,
    urgencia: "critica",
    riesgo: 35,
    costeDeNoActuar: "Propagación a naves colindantes y a la subestación contigua, con riesgo de apagón local.",
    plazoMinutos: 5,
    alternativas: [
      alt("Enviar solo una autobomba de reconocimiento", "La visión confirma fuego activo y humo denso en nave industrial: la respuesta escalonada pierde los primeros minutos, que son los decisivos."),
      alt("Perímetro de 100 m", `Con ${d.dViento} el humo alcanza los viales a 300 m; un perímetro corto dejaría tráfico y curiosos dentro de la nube.`),
    ],
  }),
  "incendio_industrial:corte_m30": (d) => {
    const parcial = d.restr.cortesParciales || (d.carga ?? 0) >= 60;
    return {
      titulo: d.tit(parcial ? "Corte parcial de la M-30 sur por humo en calzada" : "Corte total de la M-30 sur por humo en calzada", d.dTrafico, d.dViento),
      resumen: `El humo cruza la calzada con ${d.dViento} (deriva hacia el ${d.hacia}). ${d.dTrafico ? `Los sensores municipales marcan ${d.dTrafico}. ` : "No hay lectura de tráfico disponible. "}${parcial ? "Un corte total con esta carga colapsaría los accesos y la ruta de evacuación: se propone corte parcial del carril derecho." : "La carga actual permite un corte total sin colapso inmediato de la red."}`,
      severidad: "alta",
      protocolo: { codigo: "PEMAM-TR-02", nombre: "Regulación de tráfico en incidentes con humo" },
      razonamiento: "Decisión tomada con la carga real de los sensores de tráfico del Ayuntamiento y la dirección actual del viento.",
      acciones: [
        A("Policía Municipal U-12", parcial ? "Corte del carril derecho de la M-30 sur sentido norte y regulación semafórica en los accesos." : "Corte total de la M-30 sur entre salidas 11 y 13, con desvío señalizado por Embajadores.", "4 min", "alta"),
        A("Centro de Gestión de Tráfico", "Paneles de mensaje variable: 'Humo en calzada, reduzca la velocidad, salida 12 cerrada'.", "2 min", "alta"),
        A("EMT", "Desvío de las líneas 8, 102 y 148 fuera del tramo afectado y aviso en marquesinas.", "8 min", "media"),
        A("Bomberos Parque 7", "Cortina de agua en el flanco que da a la calzada para abatir el humo sobre la vía.", "7 min", "media"),
      ],
      mensajeAlerta: `Policía Municipal: ${parcial ? "corte parcial" : "corte total"} de la M-30 sur por humo del incendio de ${d.lugarCorto}. Regulen accesos y confirmen ejecución.`,
      urgencia: "alta",
      riesgo: parcial ? 45 : 70,
      costeDeNoActuar: "Alcances múltiples por visibilidad nula en calzada y bloqueo del acceso sur al hospital de referencia.",
      plazoMinutos: 8,
      alternativas: parcial
        ? [alt("Corte total de la M-30 sur", `Con ${d.dTrafico ?? "la carga actual"} en los sensores municipales colapsaría el acceso sur y la ruta de evacuación.`), alt("No cortar y solo señalizar", "Visibilidad nula por humo denso sobre la calzada: la señalización no evita el alcance múltiple.")]
        : [alt("Corte parcial de un solo carril", `Con ${d.dTrafico ?? "la carga actual"} el corte total no colapsa la red y elimina por completo el tramo con humo.`), alt("No cortar y solo señalizar", "Visibilidad nula por humo denso sobre la calzada: la señalización no evita el alcance múltiple.")],
    };
  },
  "incendio_industrial:hospital": (d) => ({
    titulo: d.tit("Protección del acceso hospitalario y preposicionamiento de SAMUR", d.dAire ?? d.dEvento, d.dViento),
    resumen: `El grafo sitúa al hospital a dos saltos del incidente por la vía bloqueada${d.dominoTop ? ` (${d.dominoTop})` : ""}. ${d.dAire ? `El aire marca ${d.dAire}. ` : ""}Se propone confirmar por llamada la capacidad de urgencias, sellar las tomas de aire y asegurar una ruta alternativa de ambulancias.`,
    severidad: "alta",
    protocolo: { codigo: "PEMAM-SAN-04", nombre: "Continuidad asistencial de centros sanitarios" },
    razonamiento: "El hospital depende de una vía afectada por el incidente según el grafo de infraestructuras: se protege sin trasladar pacientes.",
    acciones: [
      A("Agente de voz (HappyRobot)", "Llamada al jefe de guardia del hospital para confirmar camas libres en urgencias y activar el plan de contingencia por humo.", "3 min", "alta"),
      A("SAMUR-PC", "Preposicionar 2 unidades de soporte vital avanzado en la puerta de urgencias y fijar ruta alternativa de acceso.", "10 min", "alta"),
      A("Policía Municipal", "Reservar un carril de emergencia en el acceso al hospital para ambulancias.", "6 min", "media"),
      A("Servicio de Mantenimiento del hospital", "Cerrar tomas de aire exterior y pasar la climatización a recirculación.", "5 min", "alta"),
    ],
    mensajeAlerta: `Hospital de referencia: ${d.perfil.etiqueta} con humo denso en ${d.lugarCorto}. Confirmen capacidad de urgencias y cierren tomas de aire exteriores.`,
    urgencia: "alta",
    riesgo: 30,
    costeDeNoActuar: "Urgencias saturadas sin aviso previo y ambulancias atrapadas en el acceso afectado.",
    plazoMinutos: 12,
    alternativas: [
      alt("Evacuar el servicio de urgencias", "El grafo sitúa al hospital a dos saltos, no bajo impacto directo: evacuar urgencias es más peligroso para los pacientes que sellar las tomas de aire."),
      alt("Esperar a que el hospital confirme humo interior", "La llamada al 112 ya reporta olor a plástico quemado en la toma de aire: esperar consume el margen de reacción."),
    ],
  }),
  "incendio_industrial:evacuacion": (d) => ({
    titulo: d.tit("Evacuación preventiva de residencia de mayores y bloques próximos", d.dAire ?? d.dEvento, d.dViento),
    resumen: `Aviso telefónico de una residencia de mayores a 300 m con 42 residentes, 11 con movilidad reducida, en el eje del humo (${d.dViento}, deriva hacia el ${d.hacia})${d.dAire ? `, con ${d.dAire}` : ""}. Se propone evacuación al polideportivo municipal con apoyo de EMT y Protección Civil.`,
    severidad: "critica",
    protocolo: { codigo: "PEMAM-EV-01", nombre: "Evacuación de población vulnerable" },
    razonamiento: "Población vulnerable dentro de la pluma de humo y sin capacidad de autoprotección: la evacuación asistida es la única medida que garantiza aire limpio.",
    acciones: [
      A("Protección Civil", "Evacuación de la residencia (42 personas) al polideportivo municipal, con prioridad para las 11 personas con movilidad reducida.", "15 min", "alta"),
      A("EMT", "2 autobuses adaptados a la puerta de la residencia y uno de reserva en el punto de encuentro.", "12 min", "alta"),
      A("Agente de voz (HappyRobot)", "Llamada a la dirección de la residencia para confirmar el censo y preparar la salida por la puerta de sotavento.", "2 min", "alta"),
      A("Aviso SMS vecinos", "Aviso de confinamiento a los bloques colindantes: cerrar ventanas, apagar climatización y no salir salvo indicación.", "1 min", "media"),
    ],
    mensajeAlerta: `Protección Civil: evacuación preventiva de la residencia de mayores de ${d.lugarCorto} hacia el polideportivo municipal. Confirmen recursos y hora de salida.`,
    urgencia: "critica",
    riesgo: 55,
    costeDeNoActuar: "Exposición de 42 personas mayores a humo tóxico y una evacuación tardía con visibilidad nula.",
    plazoMinutos: 10,
    alternativas: [
      alt("Confinamiento en la residencia", "El humo ya entra por las ventanas y hay 11 personas con movilidad reducida: el confinamiento no garantiza aire respirable."),
      alt("Evacuar a un hospital", "Saturaría urgencias sin necesidad asistencial; el polideportivo está fuera del eje del humo y tiene acceso por ruta alternativa."),
    ],
  }),
  "incendio_industrial:replanificacion_viento": (d) => ({
    titulo: d.tit("Replanificación por cambio de viento: el humo gira hacia el hospital", d.dViento, d.dAire ?? d.dTrafico),
    resumen: `El viento ha rolado: ahora sopla a ${d.v.velocidadKmh} km/h del ${d.v.direccionTexto} y la columna deriva hacia el ${d.hacia}, alcanzando el acceso de urgencias y la subestación${d.dominoTop ? ` (${d.dominoTop})` : ""}. Los planes aprobados quedan en el lado equivocado del humo: hay que sellar el hospital, cambiar la ruta de evacuación y reubicar el corte de tráfico.`,
    severidad: "critica",
    protocolo: { codigo: "PEMAM-REV-07", nombre: "Revisión del plan por cambio de condiciones" },
    razonamiento: "Cambio de condiciones meteorológicas confirmado por la estación: el humo amenaza ahora una infraestructura crítica que antes estaba a sotavento.",
    acciones: [
      A("Agente de voz (HappyRobot)", "Llamada al jefe de guardia del hospital: cerrar tomas de aire, sellar urgencias y activar el plan de contingencia por humo.", "2 min", "alta"),
      A("SAMUR-PC", "Desviar ambulancias a los hospitales de respaldo y fijar ruta alternativa de acceso.", "5 min", "alta"),
      A("Protección Civil", `Cambiar la ruta de evacuación a la alternativa que queda fuera del nuevo eje del humo (${d.hacia}).`, "5 min", "alta"),
      A("Policía Municipal", "Levantar el corte anterior y cortar los viales del entorno del hospital.", "6 min", "alta"),
      A("Bomberos Parque 7", "Reposicionar autobombas al nuevo flanco de barlovento para proteger la subestación.", "8 min", "alta"),
    ],
    mensajeAlerta: `Cambio de viento en el incendio de ${d.lugarCorto}: el humo avanza hacia el ${d.hacia} y alcanza el hospital. Sellar urgencias, desviar ambulancias y cambiar la ruta de evacuación.`,
    urgencia: "critica",
    riesgo: 60,
    costeDeNoActuar: "Humo tóxico en urgencias, ambulancias atrapadas y riesgo de caída de la subestación que alimenta al Centro 112.",
    plazoMinutos: 6,
    alternativas: [
      alt("Mantener los planes ya aprobados", `El viento ha rolado a ${d.v.direccionTexto} (${d.v.velocidadKmh} km/h): la ruta de evacuación y el corte de tráfico quedan en el lado equivocado de la columna.`),
      alt("Evacuar el hospital completo", "Sellar urgencias y desviar ambulancias protege igual sin trasladar pacientes críticos bajo la nube de humo."),
    ],
  }),
  "incendio_industrial:comunicado": (d) => {
    const base = recetaComunicado(d);
    return { ...base, protocolo: { codigo: "PEMAM-COM-03", nombre: "Información a la población" } };
  },

  // --- Incendio urbano -----------------------------------------------------
  "incendio_urbano:despliegue_inicial": (d) => ({
    titulo: d.tit("Despliegue inicial en incendio de edificio", d.dEvento, d.dViento),
    resumen: `Incendio declarado en un inmueble de ${d.lugar}. Con ${d.dViento} el humo asciende por el patio y la escalera, que es la vía de evacuación de todos los vecinos. Se propone ataque por la escalera con control de puertas, autoescala en fachada y rescate de las plantas superiores.`,
    severidad: "critica",
    protocolo: { nombre: "Incendio en edificio de viviendas" },
    razonamiento: "En incendio urbano el riesgo principal no es el fuego sino el humo en la caja de escalera: primero se controla la vía de evacuación y después se ataca el foco.",
    acciones: [
      A("Bomberos", "2 autobombas y 1 autoescala; control de la caja de escalera con ventilación forzada y ataque al foco.", "6 min", "alta"),
      A("Bomberos · equipo de rescate", "Rescate de las plantas superiores por autoescala, empezando por la vertical del foco.", "9 min", "alta"),
      A("SAMUR-PC", "2 unidades y punto de triaje en el portal para intoxicados por inhalación de humo.", "8 min", "alta"),
      A("Policía Municipal", "Despejar la calle de vehículos aparcados para dar apoyo a la autoescala y cortar el tramo.", "5 min", "alta"),
    ],
    mensajeAlerta: `Bomberos: incendio en edificio de viviendas en ${d.lugar}. Prioridad: control de la escalera y rescate de plantas superiores.`,
    urgencia: "critica",
    riesgo: 35,
    costeDeNoActuar: "Vecinos intoxicados en la escalera y propagación por patio a las viviendas superiores.",
    plazoMinutos: 5,
    alternativas: [
      alt("Ordenar la salida inmediata de todos los vecinos por la escalera", "Con la escalera llena de humo, sacar a todo el edificio a la vez provoca más intoxicados que el propio fuego."),
      alt("Esperar a la confirmación del alcance antes de pedir la autoescala", "La autoescala tarda más en posicionarse que en confirmarse el alcance: pedirla tarde deja sin salida a las plantas altas."),
    ],
  }),
  "incendio_urbano:evacuacion_edificio": (d) => ({
    titulo: d.tit("Evacuación vertical del inmueble frente a confinamiento en vivienda", d.dAire ?? d.dEvento, d.dViento),
    resumen: `Con la escalera comprometida por el humo (${d.dViento}, deriva hacia el ${d.hacia})${d.dAire ? ` y ${d.dAire} en el exterior` : ""}, se propone evacuación dirigida planta a planta por debajo del foco y confinamiento con puerta estanca por encima, hasta que los bomberos confirmen la escalera practicable.`,
    severidad: "critica",
    protocolo: { nombre: "Evacuación dirigida en edificio de viviendas" },
    razonamiento: "La evacuación por debajo del foco es segura y rápida; por encima, el confinamiento con puerta cerrada y toallas húmedas protege mejor que atravesar la columna de humo.",
    acciones: [
      A("Bomberos", "Evacuación dirigida de las plantas por debajo del foco y conteo de ocupantes en el punto de reunión.", "10 min", "alta"),
      A("Agente de voz (HappyRobot)", "Llamada automática a los teléfonos del portal: quien esté por encima del foco cierra la puerta, sella rendijas y se asoma a la fachada.", "3 min", "alta"),
      A("Protección Civil", "Punto de reunión y censo de evacuados; mantas y atención a mayores y menores.", "12 min", "media"),
      A("Servicios Sociales", "Alojamiento temporal para los vecinos que no puedan volver esta noche.", "25 min", "baja"),
    ],
    mensajeAlerta: `Vecinos de ${d.lugar}: si vive por debajo del incendio, salga ahora siguiendo a los bomberos. Si vive por encima, cierre la puerta, selle rendijas y hágase visible en la ventana.`,
    urgencia: "critica",
    riesgo: 55,
    costeDeNoActuar: "Vecinos atrapados en la escalera con humo y rescates simultáneos que superan a los medios disponibles.",
    plazoMinutos: 8,
    alternativas: [
      alt("Evacuación total e inmediata del edificio", "Obligaría a las plantas altas a cruzar la columna de humo, que es la primera causa de víctimas en incendio urbano."),
      alt("Confinamiento general sin evacuar a nadie", "Las plantas bajas tienen salida limpia: mantenerlas dentro añade riesgo sin ninguna ventaja."),
    ],
  }),
  "incendio_urbano:corte_accesos": (d) => ({
    titulo: d.tit("Corte de la calle y reserva de accesos para autoescala", d.dTrafico, d.dViento),
    resumen: `La autoescala necesita una franja libre en fachada y las ambulancias una salida despejada. ${d.dTrafico ? `Los sensores municipales marcan ${d.dTrafico} en el entorno, ` : ""}por lo que se propone corte del tramo y desvío de líneas de EMT, con grúa para retirar los vehículos que estorben.`,
    severidad: "alta",
    protocolo: { nombre: "Despeje de accesos para medios de intervención" },
    razonamiento: "El tiempo de posicionamiento de la autoescala depende directamente de la calle libre: el corte es la medida con mayor retorno operativo del dispositivo.",
    acciones: [
      A("Policía Municipal", "Corte del tramo afectado y de los dos accesos laterales; paso reservado para bomberos y SAMUR-PC.", "4 min", "alta"),
      A("Grúa municipal", "Retirada inmediata de los vehículos que impiden el despliegue de los estabilizadores de la autoescala.", "8 min", "alta"),
      A("EMT", "Desvío de las líneas que pasan por el tramo y aviso en marquesinas y app.", "10 min", "media"),
      A("Centro de Gestión de Tráfico", "Paneles de mensaje variable con el itinerario alternativo al tramo cortado.", "5 min", "media"),
    ],
    mensajeAlerta: `Policía Municipal: corte del tramo de ${d.lugar} por incendio. Reserven paso a autoescala y ambulancias y retiren vehículos con grúa.`,
    urgencia: "alta",
    riesgo: 45,
    costeDeNoActuar: "La autoescala no puede estabilizarse en fachada y el rescate de plantas altas se retrasa varios minutos.",
    plazoMinutos: 6,
    alternativas: [
      alt("Señalizar sin cortar el tráfico", "Un solo vehículo en el tramo bloquea los estabilizadores de la autoescala: la señalización no lo garantiza."),
      alt("Cortar todo el barrio", `Sobredimensionado: con ${d.dTrafico ?? "la carga actual"} bastan el tramo y los dos accesos laterales.`),
    ],
  }),
  "incendio_urbano:apoyo_sanitario": (d) => ({
    titulo: d.tit("Dispositivo sanitario por inhalación de humo", d.dAire ?? d.dEvento, d.dViento),
    resumen: `Los afectados por inhalación de humo aparecen en oleadas a medida que avanza la evacuación${d.dAire ? ` (aire exterior: ${d.dAire})` : ""}. Se propone puesto de triaje en el portal, reparto de pacientes entre dos hospitales y reserva de cámara hiperbárica para intoxicaciones por monóxido.`,
    severidad: "alta",
    protocolo: { nombre: "Asistencia sanitaria en incendio con intoxicados" },
    razonamiento: "Repartir a los intoxicados entre varios hospitales evita colapsar el más cercano y acorta el tiempo hasta el tratamiento con oxígeno.",
    acciones: [
      A("SAMUR-PC", "Puesto sanitario avanzado en el portal, triaje por saturación de oxígeno y oxigenoterapia precoz.", "6 min", "alta"),
      A("SUMMA 112", "2 unidades adicionales y coordinación del reparto de pacientes entre dos hospitales de referencia.", "12 min", "alta"),
      A("Agente de voz (HappyRobot)", "Llamada a los hospitales receptores para confirmar camas y disponibilidad de cámara hiperbárica.", "4 min", "alta"),
      A("Protección Civil", "Zona de descanso con mantas y agua para evacuados no heridos, separada del área asistencial.", "15 min", "baja"),
    ],
    mensajeAlerta: `SAMUR-PC: dispositivo sanitario en ${d.lugar} por inhalación de humo. Triaje en portal y reparto de pacientes entre dos hospitales.`,
    urgencia: "alta",
    riesgo: 25,
    costeDeNoActuar: "Intoxicados por monóxido sin detectar y saturación de un único servicio de urgencias.",
    plazoMinutos: 10,
    alternativas: [
      alt("Trasladar a todos los afectados al hospital más cercano", "Se colapsaría un solo servicio de urgencias y se alargaría el tiempo hasta la oxigenoterapia de los casos graves."),
      alt("Atender solo a quien lo solicite", "La intoxicación por monóxido cursa sin síntomas evidentes al principio: sin triaje activo se escapan los casos graves."),
    ],
  }),

  // --- Incendio forestal ---------------------------------------------------
  "incendio_forestal:despliegue_inicial": (d) => ({
    titulo: d.tit("Ataque inicial al incendio forestal", d.dViento, d.dEvento),
    resumen: `Incendio forestal activo en ${d.lugar}. Con ${d.dViento} la propagación es hacia el ${d.hacia}${d.dAire ? ` y el aire ya marca ${d.dAire}` : ""}. Se propone ataque directo en cabeza mientras la superficie es pequeña y apertura de línea de defensa en el flanco derecho.`,
    severidad: "critica",
    protocolo: { nombre: "Ataque inicial a incendio forestal" },
    razonamiento: "En incendio forestal el ataque en los primeros minutos evita el salto a copas; después de ese margen solo cabe defender la interfaz.",
    acciones: [
      A("Bomberos Comunidad de Madrid", "Ataque directo en la cabeza del incendio con 2 autobombas forestales y 1 brigada helitransportada.", "15 min", "alta"),
      A("Medios aéreos", "1 helicóptero de extinción con descargas sobre la cabeza y reconocimiento del perímetro.", "20 min", "alta"),
      A("Agentes Forestales", "Apertura de línea de defensa en el flanco derecho aprovechando el cortafuegos existente.", "25 min", "media"),
      A("Policía Municipal", "Cierre de caminos forestales y control de accesos para evitar curiosos en la zona de trabajo.", "10 min", "media"),
    ],
    mensajeAlerta: `Operativo forestal: incendio activo en ${d.lugar}, propagación hacia el ${d.hacia} con ${d.dViento}. Ataque directo en cabeza y línea de defensa en flanco derecho.`,
    urgencia: "critica",
    riesgo: 40,
    costeDeNoActuar: "Salto a copas y carrera hacia la interfaz urbano-forestal con viviendas ocupadas.",
    plazoMinutos: 8,
    alternativas: [
      alt("Defender solo el perímetro urbano y dejar arder el monte", `Con ${d.dViento} la superficie se multiplicaría antes de llegar la noche: el ataque inicial es la única ventana barata.`),
      alt("Esperar a los medios aéreos para iniciar el ataque", "El ataque terrestre puede iniciar la línea de defensa mientras llegan: perder ese tiempo duplica el perímetro."),
    ],
  }),
  "incendio_forestal:defensa_interfaz": (d) => ({
    titulo: d.tit("Defensa de la interfaz urbano-forestal", d.dViento, d.dEvento),
    resumen: `La propagación hacia el ${d.hacia} con ${d.dViento} pone la interfaz urbano-forestal en la trayectoria. Se propone asignar autobombas a cada urbanización expuesta, retirar el combustible de las parcelas perimetrales y preparar el confinamiento en las viviendas defendibles.`,
    severidad: "critica",
    protocolo: { nombre: "Defensa de la interfaz urbano-forestal" },
    razonamiento: "La defensa de viviendas se decide antes de que llegue el frente: asignar medios a cada urbanización evita improvisar cuando ya no hay visibilidad.",
    acciones: [
      A("Bomberos", "1 autobomba asignada a cada urbanización expuesta, con punto de agua identificado y ruta de repliegue.", "18 min", "alta"),
      A("Servicio de Limpieza", "Retirada de combustible acumulado y poda perimetral en las parcelas de primera línea.", "30 min", "media"),
      A("Policía Municipal", "Censo puerta a puerta de las viviendas ocupadas y de las personas con movilidad reducida.", "20 min", "alta"),
      A("Aviso SMS vecinos", "Instrucciones de preparación: cerrar ventanas y toldos, retirar bombonas y regar el perímetro.", "5 min", "media"),
    ],
    mensajeAlerta: `Bomberos: defensa de la interfaz urbano-forestal de ${d.lugarCorto}. Una autobomba por urbanización, punto de agua y ruta de repliegue identificados.`,
    urgencia: "critica",
    riesgo: 45,
    costeDeNoActuar: "Viviendas ocupadas alcanzadas por el frente sin medios asignados ni ruta de salida definida.",
    plazoMinutos: 12,
    alternativas: [
      alt("Concentrar todos los medios en la cabeza del incendio", `Con ${d.dViento} la cabeza no se detiene y las viviendas quedarían sin defensa asignada.`),
      alt("Evacuar ya todas las urbanizaciones", "La evacuación masiva por caminos forestales estrechos y con humo es más peligrosa que el confinamiento en viviendas defendibles."),
    ],
  }),
  "incendio_forestal:evacuacion_preventiva": (d) => ({
    titulo: d.tit("Evacuación preventiva de urbanizaciones en la trayectoria", d.dViento, d.dAire ?? d.dEvento),
    resumen: `Con propagación hacia el ${d.hacia} y ${d.dViento}, las urbanizaciones de la trayectoria deben salir mientras las carreteras siguen practicables${d.dAire ? ` (aire: ${d.dAire})` : ""}. Se propone evacuación escalonada por sectores hacia el pabellón municipal, con las carreteras aún abiertas al tráfico de salida.`,
    severidad: "critica",
    protocolo: { nombre: "Evacuación preventiva por incendio forestal" },
    razonamiento: "La evacuación forestal solo es segura mientras las vías están limpias de humo: retrasarla obliga a confinar en viviendas no preparadas.",
    acciones: [
      A("Protección Civil", "Evacuación escalonada por sectores hacia el pabellón municipal, empezando por el sector más expuesto.", "20 min", "alta"),
      A("EMT / autobuses municipales", "3 autobuses para quien no disponga de vehículo y 1 adaptado para movilidad reducida.", "25 min", "alta"),
      A("Policía Municipal", "Sentido único de salida en la carretera de acceso y control de que nadie entra en sentido contrario.", "10 min", "alta"),
      A("112 / ES-Alert", `Alerta a los sectores afectados con la ruta de salida y el punto de acogida.`, "5 min", "alta"),
    ],
    mensajeAlerta: `Protección Civil: evacuación preventiva de las urbanizaciones de ${d.lugarCorto}. Salida por la carretera principal en sentido único hacia el pabellón municipal.`,
    urgencia: "critica",
    riesgo: 60,
    costeDeNoActuar: "Evacuación tardía con la carretera de salida invadida por el humo y vecinos atrapados en la urbanización.",
    plazoMinutos: 12,
    alternativas: [
      alt("Confinamiento en las viviendas", "Solo es válido en viviendas con perímetro limpio y hueco protegido: aquí hay parcelas con vegetación pegada a fachada."),
      alt("Esperar a que el frente esté a 1 km", "A esa distancia la carretera ya tendría humo y la evacuación se convertiría en un rescate."),
    ],
  }),
  "incendio_forestal:corte_carreteras": (d) => ({
    titulo: d.tit("Corte de carreteras y caminos por humo y paso de medios", d.dTrafico ?? d.dViento, d.dEvento),
    resumen: `El humo cruza la carretera con ${d.dViento}${d.dTrafico ? ` y los sensores marcan ${d.dTrafico}` : ""}. Se propone corte al tráfico general manteniendo el sentido de salida para la evacuación y paso exclusivo para los medios de extinción.`,
    severidad: "alta",
    protocolo: { nombre: "Regulación viaria en incendio forestal" },
    razonamiento: "El corte se diseña asimétrico: cierra la entrada de curiosos pero mantiene abierta la salida de los vecinos evacuados y el paso de los medios.",
    acciones: [
      A("Policía Municipal / Guardia Civil de Tráfico", "Corte al tráfico de entrada y sentido único de salida en la carretera afectada.", "8 min", "alta"),
      A("Agentes Forestales", "Cierre con barrera de los caminos forestales y control de que no queda nadie dentro.", "15 min", "alta"),
      A("Centro de Gestión de Tráfico", "Paneles de mensaje variable con el itinerario alternativo y el aviso de humo en calzada.", "6 min", "media"),
      A("EMT / transporte interurbano", "Suspensión de las líneas que atraviesan el tramo y refuerzo desde el punto de acogida.", "20 min", "media"),
    ],
    mensajeAlerta: `Policía Municipal: corte de la carretera de ${d.lugarCorto} por humo. Se mantiene el sentido de salida para la evacuación y paso reservado a medios de extinción.`,
    urgencia: "alta",
    riesgo: 50,
    costeDeNoActuar: "Colisiones por visibilidad nula y curiosos entrando en la zona de trabajo de los medios.",
    plazoMinutos: 8,
    alternativas: [
      alt("Corte total en ambos sentidos", "Dejaría atrapados a los vecinos que aún están evacuando por esa misma carretera."),
      alt("Señalizar sin cortar", `Con ${d.dViento} el humo cruza la calzada a rachas: la señalización no evita el alcance por visibilidad nula.`),
    ],
  }),
};

// --- Inundación, tráfico y ferroviario --------------------------------------
const RECETAS_AGUA_TRANSPORTE: Record<string, Generador> = {
  "inundacion:activacion_plan_inundacion": (d) => ({
    titulo: d.tit("Activación del plan municipal de inundaciones", d.dEvento, d.dTrafico),
    resumen: `Se activa el plan de inundaciones por el aviso en ${d.lugar}${d.dEvento ? ` (${d.dEvento})` : ""}. Se movilizan bombeo y achique, se ponen en vigilancia los puntos negros conocidos (pasos inferiores, vados y colectores) y se coordina con Canal de Isabel II el estado de la red.`,
    severidad: "alta",
    protocolo: { nombre: "Activación del Plan de Inundaciones (PEMAM)" },
    razonamiento: "La inundación urbana se gestiona por puntos negros conocidos: anticipar medios a esos puntos es más eficaz que responder a cada aviso por separado.",
    acciones: [
      A("Bomberos", "Movilizar 2 equipos de achique y bombeo a los puntos negros de la cuenca afectada.", "12 min", "alta"),
      A("Canal de Isabel II", "Revisión del estado de colectores y tanques de tormenta aguas arriba y confirmación de capacidad restante.", "15 min", "alta"),
      A("Servicio de Limpieza", "Desatasco preventivo de imbornales en los viales que ya acumulan agua.", "20 min", "media"),
      A("Policía Municipal", "Vigilancia de pasos inferiores y vados, con orden de cerrar en cuanto haya lámina de agua.", "10 min", "alta"),
    ],
    mensajeAlerta: `Activado el plan municipal de inundaciones por el episodio de ${d.lugarCorto}. Equipos de achique a puntos negros y vigilancia de pasos inferiores.`,
    urgencia: "alta",
    riesgo: 30,
    costeDeNoActuar: "Responder aviso por aviso, con los equipos dispersos cuando se acumulen los puntos críticos.",
    plazoMinutos: 12,
    alternativas: [
      alt("Esperar al siguiente boletín antes de activar", "Los tiempos de llegada a los puntos negros son de 12-20 minutos: activar después del boletín llega tarde al primer pico."),
      alt("Activar el plan en toda la ciudad", "El episodio está localizado en una cuenca: extenderlo dejaría sin medios al resto de distritos sin ganancia."),
    ],
  }),
  "inundacion:cierre_pasos_inferiores": (d) => ({
    titulo: d.tit("Cierre de pasos inferiores", d.dEvento, d.dTrafico),
    resumen: `La intensidad de lluvia${d.dEvento ? ` (${d.dEvento})` : ""} supera la capacidad de los imbornales y los pasos inferiores acumulan lámina de agua. ${d.dTrafico ? `Los sensores municipales marcan ${d.dTrafico}, ` : ""}por lo que el cierre debe hacerse con desvío señalizado antes de que entre un vehículo y quede atrapado.`,
    severidad: "alta",
    protocolo: { nombre: "Cierre preventivo de pasos inferiores y vados" },
    razonamiento: "El 80 % de las víctimas por inundación urbana se produce dentro de vehículos en pasos inferiores: el cierre preventivo es la medida con mejor relación entre coste y vidas evitadas.",
    acciones: [
      A("Policía Municipal", "Cierre físico con vallas de los pasos inferiores y vados inundables del distrito y control de que no queda ningún vehículo dentro.", "8 min", "alta"),
      A("Centro de Gestión de Tráfico", "Paneles de mensaje variable con el itinerario alternativo y el aviso de paso inferior cerrado.", "4 min", "alta"),
      A("EMT", "Desvío de las líneas que utilizan los pasos cerrados y aviso en marquesinas y app.", "10 min", "media"),
      A("Bomberos", "Equipo de achique preposicionado en el paso inferior con mayor histórico de inundación.", "12 min", "media"),
    ],
    mensajeAlerta: `Policía Municipal: cierre inmediato de los pasos inferiores y vados de ${d.lugarCorto} por acumulación de agua. Confirmen que no queda ningún vehículo dentro.`,
    urgencia: "alta",
    riesgo: 50,
    costeDeNoActuar: "Vehículos atrapados en el paso inferior y rescates acuáticos nocturnos con la lámina de agua subiendo.",
    plazoMinutos: 8,
    alternativas: [
      alt("Señalizar sin cerrar físicamente", "Los conductores subestiman la profundidad de la lámina de agua: sin barrera física siguen entrando."),
      alt("Cerrar toda la red viaria del distrito", `Sobredimensionado: con ${d.dTrafico ?? "la carga actual"} el colapso del resto de la red impediría llegar a los equipos de achique.`),
    ],
  }),
  "inundacion:evacuacion_zona_baja": (d) => ({
    titulo: d.tit("Evacuación de bajos, sótanos y garajes inundables", d.dEvento, d.dTrafico),
    resumen: `El agua entra en bajos y garajes de ${d.lugar}${d.dEvento ? ` con ${d.dEvento}` : ""}. Se propone desalojo de plantas bajo rasante y confinamiento en altura del resto de vecinos: nadie debe bajar al garaje a mover el coche.`,
    severidad: "critica",
    protocolo: { nombre: "Desalojo de plantas bajo rasante" },
    razonamiento: "El riesgo mortal está bajo rasante, no en las plantas altas: se evacua hacia arriba dentro del propio edificio, que es más rápido y seguro que sacar a la gente a la calle inundada.",
    acciones: [
      A("Bomberos", "Desalojo de bajos, sótanos y garajes; corte del acceso a las rampas y achique en los puntos con más lámina.", "12 min", "alta"),
      A("Protección Civil", "Censo de personas con movilidad reducida en plantas bajas y traslado asistido a plantas altas o al refugio.", "18 min", "alta"),
      A("Aviso SMS vecinos", "Instrucción expresa: no bajar al garaje a mover el vehículo, subir a plantas altas y no usar el ascensor.", "3 min", "alta"),
      A("Policía Municipal", "Control de los accesos a la zona baja y del cumplimiento del desalojo.", "10 min", "media"),
    ],
    mensajeAlerta: `Vecinos de ${d.lugarCorto}: no bajen al garaje ni al sótano. Suban a plantas altas y no utilicen el ascensor. Bomberos están achicando.`,
    urgencia: "critica",
    riesgo: 60,
    costeDeNoActuar: "Personas atrapadas en garajes y sótanos con el agua subiendo y sin salida por la rampa.",
    plazoMinutos: 8,
    alternativas: [
      alt("Evacuar los edificios a la calle", "La calle está inundada y con corriente: sacar a los vecinos del edificio es más peligroso que subirlos de planta."),
      alt("Achicar sin desalojar", "El achique tarda más que la subida de la lámina de agua: primero salen las personas, después el agua."),
    ],
  }),
  "inundacion:corte_suministro_electrico": (d) => ({
    titulo: d.tit("Corte preventivo de suministro eléctrico en zona anegada", d.dEvento, d.dDemanda ?? d.dTrafico),
    resumen: `Hay agua en cuadros eléctricos y garajes de ${d.lugar}. Se propone corte preventivo coordinado con la distribuidora en los edificios afectados${d.dDemanda ? ` (la red peninsular marca ${d.dDemanda}, sin restricción de operación)` : ""}, con avisos previos a los vecinos y prioridad de reposición para los edificios con personas dependientes.`,
    severidad: "alta",
    protocolo: { nombre: "Corte preventivo de suministro en zona inundada" },
    razonamiento: "Con agua en contacto con cuadros y garajes, el riesgo de electrocución supera al perjuicio del corte; el corte ordenado permite además reponer antes que tras un cortocircuito.",
    acciones: [
      A("Iberdrola / UFD", "Corte programado de los centros de transformación que alimentan los edificios anegados y precinto de los cuadros afectados.", "15 min", "alta"),
      A("Bomberos", "Verificación de ausencia de tensión antes de entrar a achicar garajes y sótanos.", "10 min", "alta"),
      A("Agente de voz (HappyRobot)", "Llamada a residencias, centros de día y domicilios con personas electrodependientes de la zona del corte.", "6 min", "alta"),
      A("Aviso SMS vecinos", "Aviso del corte, su duración estimada y la instrucción de no tocar cuadros ni enchufes mojados.", "5 min", "media"),
    ],
    mensajeAlerta: `Iberdrola/UFD y Bomberos: corte preventivo de suministro en los edificios anegados de ${d.lugarCorto}. Confirmen ausencia de tensión antes del achique.`,
    urgencia: "alta",
    riesgo: 70,
    costeDeNoActuar: "Electrocución de vecinos o de los propios equipos de achique al entrar en garajes con cuadros bajo el agua.",
    plazoMinutos: 10,
    alternativas: [
      alt("Achicar con el suministro conectado", "Entrar en un garaje inundado con tensión es el escenario con más accidentes graves para los intervinientes."),
      alt("Cortar todo el distrito", "Dejaría sin luz a hospitales, semáforos y ascensores fuera de la zona inundada, sin reducir el riesgo real."),
    ],
  }),
  "inundacion:refugios": (d) => ({
    titulo: d.tit("Apertura de refugios para desalojados", d.dEvento, d.dTrafico),
    resumen: `Los desalojos de bajos y garajes de ${d.lugar} dejan familias sin vivienda practicable esta noche. Se propone abrir el polideportivo y un centro cultural como albergue temporal, con catering, mantas y punto de atención social.`,
    severidad: "media",
    protocolo: { nombre: "Albergue temporal de población desalojada" },
    razonamiento: "Abrir el refugio antes de que llegue la gente evita colas a la intemperie y permite censar a los afectados desde el primer minuto.",
    acciones: [
      A("Protección Civil", "Habilitar el polideportivo municipal como albergue: 120 plazas, censo de entrada y zona separada para familias con menores.", "25 min", "alta"),
      A("Servicios Sociales", "Punto de atención social, gestión de ayudas de emergencia y alojamiento hotelero para los casos que no encajen en albergue.", "30 min", "media"),
      A("Cruz Roja", "Catering, mantas, kits de higiene y apoyo psicológico en el albergue.", "30 min", "media"),
      A("EMT", "Lanzadera entre la zona desalojada y el albergue mientras duren los desalojos.", "20 min", "baja"),
    ],
    mensajeAlerta: `Protección Civil: abierto albergue temporal en el polideportivo de ${d.lugarCorto} para los vecinos desalojados. Lanzadera de EMT desde la zona afectada.`,
    urgencia: "media",
    riesgo: 20,
    costeDeNoActuar: "Familias desalojadas pasando la noche en la calle y sin censo de afectados para las ayudas posteriores.",
    plazoMinutos: 25,
    alternativas: [
      alt("Alojar a todos en hoteles", "Más caro y más lento de coordinar en la primera noche; se reserva para los casos que el albergue no puede atender."),
      alt("No abrir refugio y esperar a que vuelvan a sus casas", "Los bajos siguen anegados y sin suministro: no hay vivienda practicable a la que volver esta noche."),
    ],
  }),

  "accidente_trafico:activacion_plan_accidente_trafico": (d) => ({
    titulo: d.tit("Activación del dispositivo por accidente de tráfico", d.dEvento, d.dTrafico),
    resumen: `Accidente con víctimas en ${d.lugar}${d.dEvento ? ` (${d.dEvento})` : ""}. ${d.dTrafico ? `Los sensores municipales marcan ${d.dTrafico} en el entorno. ` : ""}Se propone activar el dispositivo conjunto de rescate, sanitario y de regulación viaria, con balizamiento aguas arriba para evitar el alcance por alcance.`,
    severidad: "alta",
    protocolo: { nombre: "Respuesta inicial a accidente de tráfico con víctimas" },
    razonamiento: "El segundo accidente contra la cola del primero es el riesgo más frecuente: el balizamiento aguas arriba va antes que cualquier otra maniobra.",
    acciones: [
      A("Bomberos", "1 unidad de rescate y excarcelación, estabilización de los vehículos y control de derrames de combustible.", "7 min", "alta"),
      A("SAMUR-PC", "2 unidades de soporte vital avanzado y mando sanitario para el triaje en el punto.", "8 min", "alta"),
      A("Policía Municipal", "Balizamiento a 500 m aguas arriba, regulación del paso alternativo y atestado.", "5 min", "alta"),
      A("Centro de Gestión de Tráfico", "Paneles de mensaje variable con aviso de accidente y reducción de velocidad desde 2 km antes.", "4 min", "media"),
    ],
    mensajeAlerta: `Accidente con víctimas en ${d.lugar}. Bomberos, SAMUR-PC y Policía Municipal en camino. Balizamiento aguas arriba prioritario.`,
    urgencia: "alta",
    riesgo: 30,
    costeDeNoActuar: "Alcance múltiple contra la cola formada y víctimas añadidas entre los propios intervinientes.",
    plazoMinutos: 5,
    alternativas: [
      alt("Enviar solo unidad sanitaria", "Con ocupantes atrapados la asistencia no puede empezar sin excarcelación: irían dos móviles y faltaría el rescate."),
      alt("Regular sin balizar aguas arriba", `Con ${d.dTrafico ?? "la carga actual"} la cola crece rápido y el alcance por detrás es el riesgo dominante.`),
    ],
  }),
  "accidente_trafico:rescate_atrapados": (d) => ({
    titulo: d.tit("Excarcelación de ocupantes atrapados", d.dEvento, d.dTrafico),
    resumen: `Hay ocupantes atrapados en los vehículos de ${d.lugar}. Se propone excarcelación con estabilización previa, control de la batería y del combustible derramado, y asistencia sanitaria simultánea dentro del habitáculo.`,
    severidad: "critica",
    protocolo: { nombre: "Rescate y excarcelación en accidente de tráfico" },
    razonamiento: "La hora de oro empieza en el impacto: el sanitario entra en el habitáculo mientras se excarcela, no después.",
    acciones: [
      A("Bomberos · rescate", "Estabilización de los vehículos, desconexión de baterías y excarcelación por el lateral con menor deformación.", "6 min", "alta"),
      A("SAMUR-PC", "Médico dentro del habitáculo durante la excarcelación: vía, analgesia y control cervical.", "6 min", "alta"),
      A("Bomberos · riesgo químico", "Línea de espuma preventiva por derrame de combustible y control de vehículo eléctrico si lo hubiera.", "8 min", "media"),
      A("Policía Municipal", "Zona estéril de 30 m alrededor de la maniobra y retirada de curiosos y grabaciones.", "4 min", "media"),
    ],
    mensajeAlerta: `Bomberos y SAMUR-PC: excarcelación en curso en ${d.lugar}. Zona estéril de 30 m y línea de espuma preventiva por derrame.`,
    urgencia: "critica",
    riesgo: 35,
    costeDeNoActuar: "Fallecimiento de los ocupantes atrapados por retraso asistencial y riesgo de incendio del vehículo.",
    plazoMinutos: 6,
    alternativas: [
      alt("Extraer a los ocupantes sin estabilizar los vehículos", "Provoca lesiones medulares añadidas y puede desplazar el vehículo sobre el propio equipo de rescate."),
      alt("Esperar a tener la vía cortada para empezar", "El balizamiento y el rescate se hacen en paralelo: secuenciarlos regala minutos de la hora de oro."),
    ],
  }),
  "accidente_trafico:corte_via_desvio": (d) => ({
    titulo: d.tit("Corte de la vía y desvío de tráfico", d.dTrafico, d.dEvento),
    resumen: `Para trabajar con seguridad hay que cortar la calzada. ${d.dTrafico ? `Con ${d.dTrafico} en los sensores municipales, ` : ""}se propone corte de los carriles afectados con paso alternativo por el lateral y desvío señalizado en el enlace anterior, en vez de un corte total que colapsaría la red.`,
    severidad: "alta",
    protocolo: { nombre: "Corte y desvío por accidente en vía urbana" },
    razonamiento: "El objetivo es una zona de trabajo segura con el menor coste de red posible: se corta lo imprescindible y se desvía en el enlace anterior.",
    acciones: [
      A("Policía Municipal", "Corte de los carriles afectados con paso alternativo por el lateral y agentes en el enlace anterior.", "5 min", "alta"),
      A("Centro de Gestión de Tráfico", "Desvío señalizado en el enlace anterior y paneles con el tiempo estimado de restablecimiento.", "4 min", "alta"),
      A("EMT", "Desvío de las líneas afectadas y refuerzo en la parada de transbordo.", "10 min", "media"),
      A("Grúa municipal", "Retirada de los vehículos accidentados en cuanto el atestado lo permita, para reabrir carriles.", "20 min", "media"),
    ],
    mensajeAlerta: `Policía Municipal: corte de los carriles afectados en ${d.lugar} con paso alternativo. Desvío señalizado en el enlace anterior.`,
    urgencia: "alta",
    riesgo: 50,
    costeDeNoActuar: "Zona de trabajo insegura para los equipos y riesgo de atropello de los intervinientes.",
    plazoMinutos: 7,
    alternativas: [
      alt("Corte total de la vía", `Con ${d.dTrafico ?? "la carga actual"} el corte total desplazaría el atasco a la red secundaria y bloquearía el acceso de las ambulancias.`),
      alt("Trabajar con la vía abierta y solo conos", "El margen lateral no da el espacio mínimo para la excarcelación y expone al equipo al tráfico en marcha."),
    ],
  }),
  "accidente_trafico:evacuacion_sanitaria": (d) => ({
    titulo: d.tit("Reparto hospitalario de heridos y puesto médico avanzado", d.dEvento, d.dTrafico),
    resumen: `El número de heridos en ${d.lugar} obliga a repartir entre varios hospitales para no colapsar el más cercano. Se propone puesto médico avanzado en el punto, triaje por colores y confirmación previa de camas por llamada.`,
    severidad: "alta",
    protocolo: { nombre: "Triaje y distribución hospitalaria" },
    razonamiento: "Distribuir según gravedad y capacidad real confirmada es lo que reduce la mortalidad, no llevar a todos al hospital más próximo.",
    acciones: [
      A("SAMUR-PC", "Puesto médico avanzado y triaje por colores en el punto; mando sanitario único.", "8 min", "alta"),
      A("Agente de voz (HappyRobot)", "Llamadas simultáneas a los hospitales de referencia para confirmar camas de críticos y quirófano disponible.", "5 min", "alta"),
      A("SUMMA 112", "Refuerzo con 2 unidades y coordinación del transporte secundario.", "12 min", "alta"),
      A("Policía Municipal", "Corredor de evacuación sanitaria señalizado y libre entre el punto y el hospital receptor.", "6 min", "media"),
    ],
    mensajeAlerta: `SAMUR-PC: puesto médico avanzado en ${d.lugar}. Confirmen camas de críticos en los hospitales de referencia antes de iniciar traslados.`,
    urgencia: "alta",
    riesgo: 25,
    costeDeNoActuar: "Colapso del hospital más cercano y críticos esperando quirófano mientras otro centro está libre.",
    plazoMinutos: 10,
    alternativas: [
      alt("Trasladar a todos al hospital más cercano", "Se colapsaría un único servicio de urgencias y los críticos competirían por el mismo quirófano."),
      alt("Traslado inmediato sin triaje previo", "Sin triaje los leves ocupan las primeras ambulancias y los críticos salen más tarde."),
    ],
  }),

  "accidente_ferroviario:activacion_plan_accidente_ferroviario": (d) => ({
    titulo: d.tit("Activación del plan de emergencia ferroviaria", d.dEvento, d.dTrafico),
    resumen: `Suceso ferroviario en ${d.lugar}${d.dEvento ? ` (${d.dEvento})` : ""}. Se propone activar el plan conjunto con el operador: mando único, acceso por el punto kilométrico más próximo y ninguna entrada a la plataforma hasta que haya confirmación de vía cortada y catenaria descargada.`,
    severidad: "critica",
    protocolo: { nombre: "Plan de emergencia ferroviaria (Adif / Metro de Madrid)" },
    razonamiento: "En incidente ferroviario nadie entra a la plataforma sin corte de circulación y descargo de catenaria confirmados por el operador: es la primera condición de seguridad.",
    acciones: [
      A("Adif / Metro de Madrid", "Confirmar corte de circulación en ambos sentidos y descargo de catenaria del tramo; designar responsable de vía en el PMA.", "6 min", "alta"),
      A("Bomberos", "Acceso por el punto kilométrico más próximo con equipo de rescate en vía y material de estabilización del convoy.", "12 min", "alta"),
      A("SAMUR-PC", "Mando sanitario, 3 unidades de soporte vital avanzado y zona de triaje en el andén o en la trinchera.", "12 min", "alta"),
      A("Policía Municipal", "Perímetro, control del acceso de curiosos a la plataforma y guía de los medios hasta el punto kilométrico.", "8 min", "media"),
    ],
    mensajeAlerta: `Activado el plan de emergencia ferroviaria por el suceso de ${d.lugar}. Nadie accede a la vía sin confirmación de corte de circulación y descargo de catenaria.`,
    urgencia: "critica",
    riesgo: 40,
    costeDeNoActuar: "Intervinientes en la vía con circulación abierta o catenaria en tensión: el escenario con más víctimas entre efectivos.",
    plazoMinutos: 6,
    alternativas: [
      alt("Acceder de inmediato al convoy sin esperar al descargo", "Es el error clásico en accidente ferroviario: la catenaria en tensión mata a los primeros intervinientes."),
      alt("Delegar toda la respuesta en el operador ferroviario", "El operador asegura la vía, pero el rescate y el triaje son municipales: sin mando único se duplican decisiones."),
    ],
  }),
  "accidente_ferroviario:corte_circulacion_catenaria": (d) => ({
    titulo: d.tit("Corte de circulación y descargo de catenaria", d.dEvento, d.dDemanda ?? d.dTrafico),
    resumen: `Antes del rescate hay que garantizar la seguridad eléctrica y de circulación del tramo de ${d.lugar}. Se propone corte de circulación en ambos sentidos, descargo y puesta a tierra de la catenaria, y entrega formal del tramo al mando de bomberos.`,
    severidad: "critica",
    protocolo: { nombre: "Corte de circulación y descargo eléctrico de vía" },
    razonamiento: "La entrega formal del tramo por escrito o por radio grabada es lo que permite a los equipos trabajar: sin ese trámite el rescate no puede empezar.",
    acciones: [
      A("Adif / Metro de Madrid", "Corte de circulación en ambos sentidos, descargo de catenaria y puesta a tierra visible del tramo afectado.", "8 min", "alta"),
      A("Adif / Metro de Madrid", "Entrega formal del tramo al mando de Bomberos por canal grabado, con identificación del responsable de vía.", "10 min", "alta"),
      A("Bomberos", "Verificación propia de ausencia de tensión con pértiga antes de que entre ningún equipo.", "12 min", "alta"),
      A("Policía Municipal", "Control de que no accede nadie a la plataforma durante la maniobra de descargo.", "6 min", "media"),
    ],
    mensajeAlerta: `Adif/Metro: corte de circulación y descargo de catenaria en el tramo de ${d.lugarCorto}. Comuniquen la entrega formal del tramo al mando de Bomberos.`,
    urgencia: "critica",
    riesgo: 65,
    costeDeNoActuar: "Electrocución de los equipos de rescate o arrollamiento por un tren que circula por la vía contigua.",
    plazoMinutos: 8,
    alternativas: [
      alt("Cortar solo la vía del convoy accidentado", "El riesgo de arrollamiento viene de la vía contigua, donde los equipos trabajan de espaldas a la circulación."),
      alt("Iniciar el rescate en paralelo al descargo", "No hay forma de garantizar la ausencia de tensión mientras se maniobra: primero el descargo, después el rescate."),
    ],
  }),
  "accidente_ferroviario:rescate_y_triaje": (d) => ({
    titulo: d.tit("Rescate en el convoy y triaje de viajeros", d.dEvento, d.dTrafico),
    resumen: `Con el tramo entregado, se propone rescate por sectores del convoy de ${d.lugar}, triaje por colores en el andén y evacuación de los ilesos a una zona de reagrupamiento con censo, para poder contabilizar a los que faltan.`,
    severidad: "critica",
    protocolo: { nombre: "Rescate y triaje en accidente ferroviario" },
    razonamiento: "Censar a los ilesos es lo que permite saber cuántas personas siguen dentro: sin reagrupamiento la búsqueda no tiene final.",
    acciones: [
      A("Bomberos", "Rescate por sectores del convoy, con marcado de coches ya revisados y búsqueda bajo el material.", "15 min", "alta"),
      A("SAMUR-PC", "Triaje por colores en el andén, noria de evacuación y hospital de referencia por color.", "12 min", "alta"),
      A("Protección Civil", "Zona de reagrupamiento de ilesos con censo nominal y atención básica.", "18 min", "alta"),
      A("Policía Municipal", "Control de accesos, gestión de la lista de personas y atención a familiares que se presenten.", "15 min", "media"),
    ],
    mensajeAlerta: `Bomberos y SAMUR-PC: rescate por sectores y triaje en el andén de ${d.lugarCorto}. Censo nominal de ilesos en la zona de reagrupamiento.`,
    urgencia: "critica",
    riesgo: 45,
    costeDeNoActuar: "Viajeros sin localizar entre el material y familias sin información durante horas.",
    plazoMinutos: 10,
    alternativas: [
      alt("Evacuar a todos los viajeros sin censo previo", "Se pierde la cuenta de quién sigue dentro y la búsqueda se alarga innecesariamente."),
      alt("Triaje directamente en los hospitales", "Sin triaje en origen los críticos viajan en la misma noria que los leves y llegan más tarde."),
    ],
  }),
  "accidente_ferroviario:transporte_alternativo": (d) => ({
    titulo: d.tit("Plan alternativo de transporte para los viajeros afectados", d.dTrafico, d.dEvento),
    resumen: `El corte de circulación deja sin servicio a los viajeros del tramo de ${d.lugarCorto}${d.dTrafico ? ` con ${d.dTrafico} en la red viaria` : ""}. Se propone plan alternativo por carretera con autobuses lanzadera, refuerzo de las líneas paralelas y información en estaciones.`,
    severidad: "media",
    protocolo: { nombre: "Transporte alternativo por corte ferroviario" },
    razonamiento: "El plan alternativo evita que miles de viajeros se acumulen en los andenes cerrados y descarga la presión sobre el dispositivo de emergencia.",
    acciones: [
      A("EMT", "Autobuses lanzadera entre las dos estaciones extremas del tramo cortado, con frecuencia de 5 minutos en hora punta.", "25 min", "alta"),
      A("Metro de Madrid", "Refuerzo de las líneas paralelas y apertura de tornos para absorber el trasvase de viajeros.", "20 min", "alta"),
      A("Adif / operador", "Información en estaciones y app con el punto exacto de salida de las lanzaderas y el tiempo estimado.", "10 min", "media"),
      A("Policía Municipal", "Regulación del espacio de parada de las lanzaderas y de la cola de viajeros en el exterior.", "15 min", "media"),
    ],
    mensajeAlerta: `Servicio interrumpido en el tramo de ${d.lugarCorto}. Lanzaderas de EMT entre las estaciones extremas y refuerzo en las líneas paralelas.`,
    urgencia: "media",
    riesgo: 20,
    costeDeNoActuar: "Miles de viajeros acumulados en los accesos, con riesgo de aglomeración junto a la zona de intervención.",
    plazoMinutos: 20,
    alternativas: [
      alt("Suspender el servicio sin alternativa", "Trasladaría la aglomeración a la calle, justo al lado del dispositivo de rescate."),
      alt("Reabrir la vía contigua para mantener el servicio", "Mientras haya equipos trabajando junto a la plataforma, reabrir la vía contigua es un riesgo de arrollamiento inasumible."),
    ],
  }),
};

// --- Gas, derrumbe, apagón y meteorología extrema ---------------------------
const RECETAS_RIESGO_TECNOLOGICO: Record<string, Generador> = {
  "fuga_gas:activacion_plan_fuga_gas": (d) => ({
    titulo: d.tit("Activación de la respuesta a fuga de gas", d.dEvento, d.dViento),
    resumen: `Fuga de gas notificada en ${d.lugar}${d.dEvento ? ` (${d.dEvento})` : ""}. Con ${d.dViento} la nube deriva hacia el ${d.hacia}. Se propone medición de atmósfera con explosímetro, supresión de fuentes de ignición y zonificación en caliente, templada y fría antes de cualquier otra maniobra.`,
    severidad: "critica",
    protocolo: { nombre: "Intervención en fuga de gas combustible" },
    razonamiento: "En atmósfera explosiva la primera decisión es no generar la chispa: se miden concentraciones y se eliminan fuentes de ignición antes de entrar.",
    acciones: [
      A("Bomberos · riesgo tecnológico", "Medición con explosímetro, zonificación en caliente/templada/fría y ventilación natural sin equipos eléctricos.", "8 min", "alta"),
      A("Policía Municipal", "Corte del tráfico en el entorno y prohibición de arrancar vehículos dentro de la zona caliente.", "6 min", "alta"),
      A("Distribuidora de gas", "Localizar la acometida afectada y desplazar equipo de corte y reparación al punto.", "15 min", "alta"),
      A("SAMUR-PC", "2 unidades en preventivo fuera de la zona caliente, con plan de asistencia a quemados.", "10 min", "media"),
    ],
    mensajeAlerta: `Fuga de gas en ${d.lugar}. No accionen interruptores, timbres ni vehículos en el entorno. Bomberos midiendo atmósfera y zonificando.`,
    urgencia: "critica",
    riesgo: 40,
    costeDeNoActuar: "Deflagración con la nube confinada en el portal y víctimas entre vecinos e intervinientes.",
    plazoMinutos: 5,
    alternativas: [
      alt("Entrar a buscar la fuga sin medir la atmósfera", "Cualquier equipo no ATEX dentro de la zona caliente es una fuente de ignición: la medición va primero."),
      alt("Esperar a la distribuidora sin zonificar", "La distribuidora tarda más que los bomberos: sin zonificación previa siguen entrando vecinos y vehículos."),
    ],
  }),
  "fuga_gas:corte_suministro_gas": (d) => ({
    titulo: d.tit("Corte del suministro de gas en la acometida afectada", d.dEvento, d.dViento),
    resumen: `Para detener la fuga de ${d.lugar} hay que cerrar la acometida o el ramal. Se propone corte por la distribuidora con localización previa de la llave general, aviso a los edificios que quedarán sin servicio y verificación posterior de concentración residual.`,
    severidad: "critica",
    protocolo: { nombre: "Corte de suministro de gas en emergencia" },
    razonamiento: "Cortar en acometida detiene el aporte de combustible; cerrar el ramal completo es más rápido pero deja sin servicio a manzanas enteras, así que se reserva si la acometida no es accesible.",
    acciones: [
      A("Distribuidora de gas", "Corte en la acometida del edificio afectado; si no es accesible, corte del ramal de la manzana.", "12 min", "alta"),
      A("Bomberos · riesgo tecnológico", "Control de la concentración tras el corte y ventilación hasta valores por debajo del límite inferior de explosividad.", "15 min", "alta"),
      A("Aviso SMS vecinos", "Aviso del corte de gas, su duración estimada y la advertencia de no manipular la instalación interior.", "5 min", "media"),
      A("Agente de voz (HappyRobot)", "Llamada a bares, panaderías y centros con consumo de gas del ramal para que apaguen quemadores de forma ordenada.", "8 min", "media"),
    ],
    mensajeAlerta: `Distribuidora de gas: corte inmediato de la acometida de ${d.lugar}. Bomberos confirmarán concentración residual antes de reponer.`,
    urgencia: "critica",
    riesgo: 65,
    costeDeNoActuar: "La fuga sigue aportando combustible a una nube confinada, con riesgo creciente de deflagración.",
    plazoMinutos: 8,
    alternativas: [
      alt("Cortar el ramal completo de la manzana", "Deja sin suministro a decenas de edificios y obliga a una reposición puerta a puerta: solo si la acometida no es accesible."),
      alt("Ventilar sin cortar el suministro", "Ventilar sin cerrar el aporte no reduce la concentración: solo alarga el tiempo en atmósfera explosiva."),
    ],
  }),
  "fuga_gas:perimetro_confinamiento": (d) => ({
    titulo: d.tit("Perímetro de seguridad y confinamiento por atmósfera explosiva", d.dViento, d.dEvento),
    resumen: `Con ${d.dViento} y deriva hacia el ${d.hacia}, se propone perímetro de 100 m y confinamiento de los edificios interiores: quedarse dentro con las ventanas cerradas es más seguro que bajar por una escalera donde puede haber acumulación de gas.`,
    severidad: "alta",
    protocolo: { nombre: "Perímetro y confinamiento por atmósfera explosiva" },
    razonamiento: "Evacuar por escaleras y portales con posible acumulación de gas expone a más gente que el confinamiento en vivienda con ventilación cruzada.",
    acciones: [
      A("Policía Municipal", "Perímetro de 100 m, corte de tráfico y prohibición expresa de arrancar vehículos dentro del perímetro.", "6 min", "alta"),
      A("Aviso SMS vecinos", "Instrucción de confinamiento: no accionar interruptores ni timbres, no usar el ascensor y ventilar con las ventanas del lado contrario a la fuga.", "4 min", "alta"),
      A("Bomberos", "Medición puerta a puerta en los portales del perímetro, empezando por los sótanos y cuartos de contadores.", "15 min", "alta"),
      A("Protección Civil", "Punto de atención a quien ya haya salido del perímetro y control de que nadie vuelve a entrar.", "12 min", "media"),
    ],
    mensajeAlerta: `Vecinos del entorno de ${d.lugar}: permanezcan en casa, no accionen interruptores ni timbres y no usen el ascensor. Ventilen por el lado contrario a la fuga.`,
    urgencia: "alta",
    riesgo: 45,
    costeDeNoActuar: "Vecinos bajando por escaleras y portales con acumulación de gas y accionando luces al salir.",
    plazoMinutos: 6,
    alternativas: [
      alt("Evacuación inmediata de todo el perímetro", "Obliga a cientos de personas a atravesar portales con posible acumulación: se reserva para cuando la concentración no baje."),
      alt("Perímetro de 30 m", "Insuficiente con la deriva actual del viento: dejaría dentro los portales del lado de sotavento."),
    ],
  }),
  "fuga_gas:evacuacion_radio": (d) => ({
    titulo: d.tit("Evacuación del radio interior por concentración persistente", d.dEvento, d.dViento),
    resumen: `La concentración medida en ${d.lugar} no baja pese a la ventilación. Se propone evacuación del radio interior por rutas de barlovento, con salida escalonada portal a portal para no generar acumulación de gente en la zona caliente.`,
    severidad: "critica",
    protocolo: { nombre: "Evacuación por atmósfera explosiva persistente" },
    razonamiento: "Cuando el confinamiento deja de proteger porque la concentración interior sube, la evacuación escalonada por barlovento es el mal menor.",
    acciones: [
      A("Bomberos", "Evacuación asistida portal a portal por ruta de barlovento, con medición previa de cada escalera.", "15 min", "alta"),
      A("Protección Civil", "Punto de acogida a 300 m en barlovento, censo de evacuados y atención a personas dependientes.", "18 min", "alta"),
      A("EMT", "1 autobús adaptado para personas con movilidad reducida en el punto de acogida.", "20 min", "media"),
      A("Policía Municipal", "Ampliación del perímetro y control de que no vuelve nadie a los portales evacuados.", "8 min", "alta"),
    ],
    mensajeAlerta: `Bomberos: evacuación escalonada del radio interior de ${d.lugarCorto} por concentración de gas persistente. Salida por barlovento al punto de acogida.`,
    urgencia: "critica",
    riesgo: 60,
    costeDeNoActuar: "Vecinos confinados en viviendas con concentración creciente y sin margen si se produce la deflagración.",
    plazoMinutos: 8,
    alternativas: [
      alt("Mantener el confinamiento", "Ha dejado de ser protector: las mediciones interiores suben en vez de bajar."),
      alt("Evacuación simultánea de todo el perímetro", "Concentraría a cientos de personas en la calle dentro de la zona de riesgo: la salida se escalona por portales."),
    ],
  }),

  "derrumbe:activacion_plan_derrumbe": (d) => ({
    titulo: d.tit("Activación de la respuesta a derrumbe estructural", d.dEvento, d.dViento),
    resumen: `Derrumbe estructural en ${d.lugar}${d.dEvento ? ` (${d.dEvento})` : ""}. Se propone zona cero acordonada, silencio operativo para la escucha y despliegue de rescate en estructuras colapsadas con apoyo canino, antes de mover un solo escombro.`,
    severidad: "critica",
    protocolo: { nombre: "Rescate en estructuras colapsadas" },
    razonamiento: "El primer recurso en un derrumbe es el silencio: la escucha localiza a los sepultados y evita remover escombro sobre ellos.",
    acciones: [
      A("Bomberos · rescate en estructuras", "Zona cero acordonada, silencio operativo y escucha con geófonos; ningún movimiento de escombro sin localización previa.", "12 min", "alta"),
      A("Unidad canina de rescate", "Barrido del montón de escombro con perros de búsqueda para marcar puntos de intervención.", "20 min", "alta"),
      A("SAMUR-PC", "Puesto médico avanzado junto a la zona cero y preparación para síndrome de aplastamiento.", "12 min", "alta"),
      A("Policía Municipal", "Perímetro amplio, control de curiosos y despeje de la vía para maquinaria pesada.", "8 min", "media"),
    ],
    mensajeAlerta: `Derrumbe en ${d.lugar}. Zona cero acordonada y silencio operativo para la escucha. No se remueve escombro sin localización previa.`,
    urgencia: "critica",
    riesgo: 40,
    costeDeNoActuar: "Sepultados que dejan de ser localizables y colapso secundario sobre los propios rescatadores.",
    plazoMinutos: 5,
    alternativas: [
      alt("Retirar escombro con maquinaria desde el primer minuto", "La maquinaria destruye las cavidades de supervivencia y hace inútil la escucha."),
      alt("Esperar a la unidad canina para acordonar", "El acordonamiento y el silencio operativo no dependen de la unidad canina y son condición para que sirva de algo."),
    ],
  }),
  "derrumbe:busqueda_y_rescate": (d) => ({
    titulo: d.tit("Dispositivo de búsqueda y rescate de sepultados", d.dEvento, d.dViento),
    resumen: `Se propone búsqueda por sectores sobre el montón de escombro de ${d.lugar}, alternando ciclos de escucha, barrido canino y apertura manual de galerías, con control continuo de estabilidad y relevos programados de los equipos.`,
    severidad: "critica",
    protocolo: { nombre: "Búsqueda y rescate en derrumbe" },
    razonamiento: "El rendimiento cae en picado sin relevos y sin control de estabilidad: la búsqueda se organiza en ciclos y sectores, no por impulso.",
    acciones: [
      A("Bomberos · rescate en estructuras", "Sectorización del montón y ciclos de escucha, barrido canino y apertura manual de galerías.", "15 min", "alta"),
      A("Bomberos · apeos", "Control continuo de estabilidad del montón y apeo de las galerías abiertas.", "18 min", "alta"),
      A("SAMUR-PC", "Asistencia en galería a los localizados y protocolo de síndrome de aplastamiento antes de la extracción.", "15 min", "alta"),
      A("Protección Civil", "Relevos, hidratación y control de tiempos de trabajo de los equipos en zona cero.", "25 min", "media"),
    ],
    mensajeAlerta: `Bomberos: búsqueda por sectores en la zona cero de ${d.lugarCorto}. Ciclos de escucha y apertura manual con apeo. Relevos programados.`,
    urgencia: "critica",
    riesgo: 50,
    costeDeNoActuar: "Sepultados que superan el tiempo de supervivencia y rescatadores agotados trabajando sobre un montón inestable.",
    plazoMinutos: 10,
    alternativas: [
      alt("Excavación mecánica generalizada", "Solo procede cuando la escucha y el barrido canino descartan supervivientes: antes, destruye las cavidades."),
      alt("Búsqueda sin sectorizar", "Se repiten zonas y quedan huecos sin cubrir, justo lo que no puede permitirse una búsqueda contrarreloj."),
    ],
  }),
  "derrumbe:apuntalamiento": (d) => ({
    titulo: d.tit("Apuntalamiento y evaluación de edificios contiguos", d.dEvento, d.dViento),
    resumen: `El derrumbe de ${d.lugar} deja medianeras al descubierto y grietas en los inmuebles colindantes. Se propone apuntalamiento de urgencia, inspección técnica de los contiguos y semáforo de habitabilidad antes de permitir cualquier regreso.`,
    severidad: "alta",
    protocolo: { nombre: "Apuntalamiento y evaluación estructural de urgencia" },
    razonamiento: "El colapso secundario del edificio contiguo es el riesgo que más víctimas añade tras un derrumbe: el apuntalamiento va antes que la retirada de escombro.",
    acciones: [
      A("Bomberos · apeos", "Apuntalamiento de urgencia de medianeras y forjados comprometidos de los edificios colindantes.", "20 min", "alta"),
      A("Arquitectos municipales", "Inspección técnica de los inmuebles contiguos y semáforo verde/amarillo/rojo de habitabilidad.", "35 min", "alta"),
      A("Policía Municipal", "Prohibición de acceso a los inmuebles marcados en rojo, incluso para recoger pertenencias.", "10 min", "alta"),
      A("Servicios Sociales", "Realojo temporal de los vecinos de los edificios no habitables.", "40 min", "media"),
    ],
    mensajeAlerta: `Bomberos: apuntalamiento de urgencia en los edificios contiguos a ${d.lugar}. Prohibido el acceso a los inmuebles marcados en rojo.`,
    urgencia: "alta",
    riesgo: 45,
    costeDeNoActuar: "Colapso secundario del edificio contiguo con vecinos o rescatadores dentro.",
    plazoMinutos: 15,
    alternativas: [
      alt("Permitir el regreso de los vecinos a los contiguos", "Sin inspección técnica no hay forma de saber si el forjado ha perdido apoyo en la medianera."),
      alt("Demoler los contiguos preventivamente", "Desproporcionado antes de la inspección y elimina los accesos que el rescate está usando."),
    ],
  }),
  "derrumbe:desalojo_manzana": (d) => ({
    titulo: d.tit("Desalojo preventivo de la manzana", d.dEvento, d.dViento),
    resumen: `Mientras dure el rescate y la evaluación estructural en ${d.lugar}, se propone desalojo preventivo de la manzana, realojo de los afectados y punto único de información para vecinos y familiares.`,
    severidad: "alta",
    protocolo: { nombre: "Desalojo preventivo por riesgo estructural" },
    razonamiento: "Con inspección pendiente y maquinaria trabajando, mantener vecinos en la manzana añade riesgo sin ninguna ventaja operativa.",
    acciones: [
      A("Policía Municipal", "Desalojo puerta a puerta de la manzana con censo nominal y precinto de los portales.", "20 min", "alta"),
      A("Protección Civil", "Punto de acogida y albergue temporal en el centro municipal más próximo.", "25 min", "alta"),
      A("Servicios Sociales", "Ayudas de emergencia, realojo y acompañamiento a las familias afectadas.", "40 min", "media"),
      A("Gabinete de prensa", "Punto único de información para vecinos y familiares, con horario fijo de actualización.", "15 min", "media"),
    ],
    mensajeAlerta: `Policía Municipal: desalojo preventivo de la manzana de ${d.lugar} por riesgo estructural. Punto de acogida en el centro municipal más próximo.`,
    urgencia: "alta",
    riesgo: 55,
    costeDeNoActuar: "Vecinos dentro de edificios sin evaluar mientras trabaja la maquinaria pesada.",
    plazoMinutos: 15,
    alternativas: [
      alt("Desalojar solo el portal colindante", "Las grietas detectadas afectan a la medianera de toda la manzana, no solo al edificio pegado al derrumbe."),
      alt("Esperar al informe técnico definitivo", "El informe tarda horas; el desalojo preventivo es reversible en cuanto el técnico marque en verde."),
    ],
  }),

  "apagon:activacion_plan_apagon": (d) => ({
    titulo: d.tit("Activación del plan municipal por apagón", d.dDemanda ?? d.dEvento, d.dTrafico),
    resumen: `Corte de suministro eléctrico en ${d.lugar}${d.dDemanda ? `; la demanda peninsular marca ${d.dDemanda}` : ""}. Se propone activar el plan de apagón: delimitar el alcance real con la distribuidora, obtener previsión de restablecimiento y priorizar los puntos críticos antes de que se agoten los sistemas de alimentación ininterrumpida.`,
    severidad: "alta",
    protocolo: { nombre: "Activación del plan municipal por apagón" },
    razonamiento: "El margen de decisión lo marcan las baterías de los sistemas críticos: conocer el alcance y la previsión de reposición en los primeros minutos es lo que permite priorizar.",
    acciones: [
      A("Iberdrola / UFD", "Delimitar el alcance del corte, identificar la causa y dar previsión de restablecimiento por zonas.", "10 min", "alta"),
      A("Centro de Mando", "Censo de puntos críticos sin suministro: hospitales, residencias, semáforos, túneles y estaciones.", "12 min", "alta"),
      A("Policía Municipal", "Patrullas de reconocimiento por los ejes principales del área afectada e informe de estado.", "10 min", "alta"),
      A("Metro de Madrid", "Confirmar evacuación de túneles y estado de trenes detenidos entre estaciones.", "15 min", "alta"),
    ],
    mensajeAlerta: `Activado el plan municipal por apagón en ${d.lugarCorto}. Distribuidora, confirmen alcance y previsión de restablecimiento por zonas.`,
    urgencia: "alta",
    riesgo: 30,
    costeDeNoActuar: "Decidir a ciegas sobre el reparto de generadores y descubrir tarde qué puntos críticos están sin respaldo.",
    plazoMinutos: 10,
    alternativas: [
      alt("Esperar el parte oficial de la distribuidora", "El parte definitivo llega en horas; el censo municipal de críticos se puede hacer en minutos."),
      alt("Desplegar generadores sin censo previo", "Los generadores son limitados: repartirlos sin saber quién tiene respaldo propio los malgasta."),
    ],
  }),
  "apagon:prioridad_hospitales_generadores": (d) => ({
    titulo: d.tit("Prioridad de restablecimiento y generadores a puntos críticos", d.dDemanda ?? d.dEvento, d.dTrafico),
    resumen: `Los hospitales y residencias del área sin suministro dependen de grupos electrógenos con autonomía limitada${d.dDemanda ? ` (demanda peninsular ${d.dDemanda})` : ""}. Se propone fijar con la distribuidora el orden de reposición, desplegar generadores móviles y confirmar por llamada la autonomía real de cada centro.`,
    severidad: "critica",
    protocolo: { nombre: "Continuidad eléctrica de infraestructuras críticas" },
    razonamiento: "La autonomía declarada y la real casi nunca coinciden: la llamada de verificación es lo que evita descubrir un grupo sin gasóleo a las seis horas.",
    acciones: [
      A("Agente de voz (HappyRobot)", "Llamada a hospitales, residencias y centros de diálisis para confirmar autonomía real del grupo electrógeno y nivel de gasóleo.", "8 min", "alta"),
      A("Iberdrola / UFD", "Orden de reposición priorizando los circuitos que alimentan hospitales, residencias y el centro de comunicaciones.", "15 min", "alta"),
      A("Bomberos / Protección Civil", "Despliegue de generadores móviles a los centros sin respaldo propio o con autonomía inferior a 6 horas.", "35 min", "alta"),
      A("SAMUR-PC", "Plan de traslado sanitario para pacientes electrodependientes si algún centro pierde el respaldo.", "20 min", "media"),
    ],
    mensajeAlerta: `Centros sanitarios y residencias de ${d.lugarCorto}: confirmen autonomía real de sus grupos electrógenos y nivel de gasóleo. Generadores municipales en camino.`,
    urgencia: "critica",
    riesgo: 35,
    costeDeNoActuar: "Pacientes electrodependientes sin respaldo cuando se agote el gasóleo de los grupos, sin margen para trasladarlos.",
    plazoMinutos: 12,
    alternativas: [
      alt("Evacuar preventivamente los hospitales afectados", "Trasladar pacientes críticos es mucho más peligroso que reforzar el suministro con generadores."),
      alt("Confiar en la autonomía declarada de cada centro", "La autonomía sobre el papel y el gasóleo real del depósito difieren con frecuencia: hay que verificarlo por llamada."),
    ],
  }),
  "apagon:semaforos_policia": (d) => ({
    titulo: d.tit("Regulación manual de cruces con semáforos apagados", d.dTrafico, d.dDemanda ?? d.dEvento),
    resumen: `Los semáforos del área han quedado fuera de servicio${d.dTrafico ? ` con ${d.dTrafico} en los sensores municipales` : ""}. Se propone regulación manual en los cruces de mayor intensidad, priorizando los itinerarios de ambulancias y bomberos, y refuerzo de agentes en el entorno hospitalario.`,
    severidad: "alta",
    protocolo: { nombre: "Regulación manual de tráfico por corte eléctrico" },
    razonamiento: "No hay agentes para todos los cruces: se priorizan los de mayor intensidad y los que forman parte de los itinerarios de emergencia.",
    acciones: [
      A("Policía Municipal", "Regulación manual en los cruces de mayor intensidad del área afectada, con relevos cada 2 horas.", "12 min", "alta"),
      A("Centro de Gestión de Tráfico", "Identificar los cruces sin señal y publicar el listado de itinerarios recomendados.", "8 min", "alta"),
      A("EMT", "Ajuste de frecuencias y refuerzo en los corredores que sustituyen al metro sin servicio.", "20 min", "media"),
      A("Protección Civil", "Apoyo con señalización luminosa autónoma en los cruces sin agente disponible.", "25 min", "media"),
    ],
    mensajeAlerta: `Policía Municipal: regulación manual de los cruces principales de ${d.lugarCorto} por semáforos sin servicio. Prioridad a los itinerarios de ambulancias.`,
    urgencia: "alta",
    riesgo: 40,
    costeDeNoActuar: "Accidentes en cruces sin regulación y ambulancias retenidas en itinerarios bloqueados.",
    plazoMinutos: 10,
    alternativas: [
      alt("Cortar el tráfico en toda el área sin suministro", "Bloquearía también a los servicios de emergencia y a quien intenta salir de la zona."),
      alt("Dejar los cruces sin regular hasta que vuelva la luz", `Con ${d.dTrafico ?? "la intensidad actual"} los cruces principales se bloquean en minutos y arrastran a los itinerarios sanitarios.`),
    ],
  }),
  "apagon:rescate_ascensores": (d) => ({
    titulo: d.tit("Rescate de personas atrapadas en ascensores", d.dEvento, d.dDemanda ?? d.dTrafico),
    resumen: `El corte ha dejado personas atrapadas en ascensores de ${d.lugarCorto}. Se propone lista priorizada por vulnerabilidad, rescate por equipos ligeros de bomberos con apoyo de las empresas mantenedoras y contacto telefónico continuo con cada persona atrapada.`,
    severidad: "alta",
    protocolo: { nombre: "Rescate de atrapados en ascensores" },
    razonamiento: "El volumen de avisos supera a los equipos disponibles: priorizar por vulnerabilidad y mantener contacto telefónico convierte una espera larga en una espera segura.",
    acciones: [
      A("Bomberos", "Equipos ligeros de rescate en ascensores, empezando por avisos con personas mayores, menores solos o problemas de salud.", "15 min", "alta"),
      A("Empresas mantenedoras de ascensores", "Movilización de técnicos de guardia para maniobras de rescate en paralelo a los bomberos.", "25 min", "alta"),
      A("Agente de voz (HappyRobot)", "Contacto telefónico continuo con cada persona atrapada: tiempo estimado de llegada e instrucciones de ventilación y calma.", "5 min", "alta"),
      A("SAMUR-PC", "Unidad de apoyo para las personas rescatadas con patología previa o crisis de ansiedad.", "20 min", "media"),
    ],
    mensajeAlerta: `Bomberos: rescate de atrapados en ascensores de ${d.lugarCorto}, priorizado por vulnerabilidad. Mantengan contacto telefónico con cada aviso.`,
    urgencia: "alta",
    riesgo: 25,
    costeDeNoActuar: "Personas mayores atrapadas durante horas sin contacto, con riesgo de descompensación.",
    plazoMinutos: 12,
    alternativas: [
      alt("Atender los avisos por orden de llegada", "Deja a personas vulnerables detrás de avisos sin riesgo: la priorización clínica es más justa y más segura."),
      alt("Delegar todos los rescates en las mantenedoras", "Sus tiempos de respuesta en un apagón generalizado se disparan: los bomberos cubren los casos con riesgo."),
    ],
  }),

  "ola_calor:activacion_plan_ola_calor": (d) => ({
    titulo: d.tit("Activación del plan municipal por ola de calor", d.dEvento, d.dAire ?? d.dViento),
    resumen: `Episodio de calor extremo en ${d.lugarCorto}${d.dEvento ? ` (${d.dEvento})` : ""}${d.dAire ? ` con ${d.dAire}` : ""}. Se propone activar el nivel de alerta del plan de calor: refuerzo sanitario en las horas centrales, vigilancia activa de personas vulnerables y apertura de los refugios climáticos.`,
    severidad: "alta",
    protocolo: { nombre: "Activación del Plan municipal frente al calor extremo" },
    razonamiento: "La mortalidad por calor se concentra en mayores que viven solos y en trabajadores al aire libre: el plan actúa sobre esos dos grupos antes del pico térmico.",
    acciones: [
      A("SAMUR-PC", "Refuerzo de unidades entre las 12 y las 20 h y protocolo de golpe de calor activado en todas las dotaciones.", "30 min", "alta"),
      A("Servicios Sociales", "Activar la vigilancia telefónica diaria de mayores que viven solos incluidos en el censo de vulnerables.", "25 min", "alta"),
      A("Protección Civil", "Apertura de los refugios climáticos municipales y reparto de agua en los puntos de mayor afluencia.", "30 min", "media"),
      A("Gabinete de prensa", "Aviso de nivel de alerta con recomendaciones de hidratación y horarios a evitar.", "15 min", "media"),
    ],
    mensajeAlerta: `Activado el plan municipal frente al calor extremo en ${d.lugarCorto}. Refuerzo sanitario en horas centrales y refugios climáticos abiertos.`,
    urgencia: "alta",
    riesgo: 20,
    costeDeNoActuar: "Exceso de mortalidad entre mayores que viven solos y golpes de calor en trabajos al aire libre.",
    plazoMinutos: 25,
    alternativas: [
      alt("Esperar al aviso rojo de la agencia estatal", "El exceso de mortalidad empieza antes del umbral rojo: activar en naranja adelanta la protección sin coste relevante."),
      alt("Limitar la respuesta a un comunicado", "El comunicado no llega a los mayores que viven solos, que son justo el grupo con más riesgo."),
    ],
  }),
  "ola_calor:refugios_climaticos": (d) => ({
    titulo: d.tit("Apertura y ampliación de horario de refugios climáticos", d.dEvento, d.dAire ?? d.dViento),
    resumen: `Se propone abrir la red de refugios climáticos de ${d.lugarCorto} y ampliar su horario hasta las 22 h: bibliotecas, centros de mayores y polideportivos climatizados, con transporte gratuito para quien no pueda desplazarse.`,
    severidad: "media",
    protocolo: { nombre: "Red municipal de refugios climáticos" },
    razonamiento: "El refugio solo funciona si es accesible en el horario en que la vivienda deja de proteger: por eso se amplía hasta la noche y se resuelve el transporte.",
    acciones: [
      A("Protección Civil", "Apertura de la red de refugios climáticos con horario ampliado hasta las 22 h y agua disponible en todos ellos.", "30 min", "alta"),
      A("Servicios Sociales", "Transporte gratuito al refugio para mayores y personas con movilidad reducida del censo de vulnerables.", "40 min", "media"),
      A("EMT", "Refuerzo de las líneas que conectan los barrios con más población mayor con los refugios abiertos.", "35 min", "media"),
      A("Gabinete de prensa", "Publicación del mapa de refugios y sus horarios en la web municipal y en los tablones de los centros de mayores.", "20 min", "media"),
    ],
    mensajeAlerta: `Refugios climáticos abiertos en ${d.lugarCorto} hasta las 22 h. Transporte gratuito para mayores y personas con movilidad reducida.`,
    urgencia: "media",
    riesgo: 15,
    costeDeNoActuar: "Mayores pasando el pico térmico en viviendas sin climatización, que es el escenario con más mortalidad.",
    plazoMinutos: 30,
    alternativas: [
      alt("Abrir solo los centros de mayores", "Su aforo es insuficiente para el episodio y deja fuera a las familias con menores y a las personas sin hogar."),
      alt("Repartir ventiladores a domicilio", "Por encima de 35 °C el ventilador no reduce el riesgo de golpe de calor: hace falta espacio climatizado."),
    ],
  }),
  "ola_calor:aviso_vulnerables": (d) => ({
    titulo: d.tit("Aviso proactivo a personas vulnerables", d.dEvento, d.dAire ?? d.dViento),
    resumen: `Se propone campaña de llamadas proactivas a los mayores que viven solos del censo municipal de ${d.lugarCorto}, más visitas a residencias y equipos de calle para personas sin hogar durante las horas centrales.`,
    severidad: "alta",
    protocolo: { nombre: "Vigilancia activa de población vulnerable al calor" },
    razonamiento: "La llamada proactiva detecta a quien ya está descompensado y no habría llamado al 112 por sí mismo.",
    acciones: [
      A("Agente de voz (HappyRobot)", "Ronda de llamadas al censo de mayores que viven solos: control de hidratación, temperatura en casa y derivación al 112 si procede.", "20 min", "alta"),
      A("Servicios Sociales", "Visita domiciliaria a los casos que no contesten a la llamada o den señales de descompensación.", "45 min", "alta"),
      A("SAMUR Social", "Equipos de calle con agua y evaluación sanitaria a personas sin hogar en las horas centrales.", "30 min", "alta"),
      A("Inspección de residencias", "Verificación de climatización y protocolo de hidratación en residencias de mayores del distrito.", "60 min", "media"),
    ],
    mensajeAlerta: `Servicios Sociales y SAMUR Social: campaña de aviso y visita a personas vulnerables en ${d.lugarCorto} por calor extremo. Prioridad a los que no contesten.`,
    urgencia: "alta",
    riesgo: 15,
    costeDeNoActuar: "Personas mayores descompensadas en su domicilio sin que nadie lo detecte hasta que es tarde.",
    plazoMinutos: 20,
    alternativas: [
      alt("Difundir solo recomendaciones generales", "No alcanza a quien vive solo, sin redes y sin costumbre de consultar medios municipales."),
      alt("Esperar a que llamen al 112", "El golpe de calor cursa con confusión: la persona afectada suele no ser capaz de pedir ayuda."),
    ],
  }),
  "ola_calor:horario_obras": (d) => ({
    titulo: d.tit("Restricción del horario de obras y trabajo al aire libre", d.dEvento, d.dAire ?? d.dViento),
    resumen: `Se propone prohibir los trabajos al aire libre en las horas centrales en obras municipales y contratas de ${d.lugarCorto}, con reorganización de turnos a primera hora y obligación de sombra, agua y descansos.`,
    severidad: "media",
    protocolo: { nombre: "Protección de trabajadores al aire libre en calor extremo" },
    razonamiento: "La medida es de aplicación inmediata en obra municipal y contratas, y sirve de referencia para el resto de empleadores del municipio.",
    acciones: [
      A("Dirección de obras municipales", "Suspensión de los trabajos al aire libre entre las 12 y las 19 h y traslado de la jornada a primera hora.", "30 min", "alta"),
      A("Contratas municipales", "Obligación de punto de sombra, agua fresca y descansos de 10 minutos por hora en todos los tajos.", "40 min", "media"),
      A("Servicio de Limpieza y Jardines", "Reorganización de los turnos de baldeo y riego a horario nocturno y de madrugada.", "45 min", "media"),
      A("Gabinete de prensa", "Recomendación pública al resto de empleadores del municipio para que apliquen la misma restricción.", "20 min", "baja"),
    ],
    mensajeAlerta: `Obras municipales y contratas de ${d.lugarCorto}: suspendidos los trabajos al aire libre entre las 12 y las 19 h mientras dure el episodio de calor.`,
    urgencia: "media",
    riesgo: 20,
    costeDeNoActuar: "Golpes de calor en trabajadores expuestos, con responsabilidad directa del Ayuntamiento como promotor.",
    plazoMinutos: 30,
    alternativas: [
      alt("Recomendar sin obligar", "En obra la recomendación no cambia la planificación de los tajos: se necesita la instrucción formal."),
      alt("Parar las obras el día completo", "Desplazar la jornada a primera hora protege igual y no paraliza la actividad ni genera sobrecoste."),
    ],
  }),
};

// --- Nevada, sismo, aglomeración, vertido, persona y genérico ---------------
const RECETAS_RESTO: Record<string, Generador> = {
  "nevada:activacion_plan_nevada": (d) => ({
    titulo: d.tit("Activación del plan municipal de nevadas", d.dEvento, d.dTrafico),
    resumen: `Episodio de nieve y hielo sobre ${d.lugarCorto}${d.dEvento ? ` (${d.dEvento})` : ""}${d.dTrafico ? ` con ${d.dTrafico} en la red viaria` : ""}. Se propone activar el plan de nevadas: turnos completos de quitanieves y esparcidores, prioridad en la red viaria principal y accesos hospitalarios, y campaña de frío para personas sin hogar.`,
    severidad: "alta",
    protocolo: { nombre: "Activación del Plan municipal de Nevadas" },
    razonamiento: "El plan se activa antes de que cuaje: tratar una calzada limpia cuesta una fracción de lo que cuesta retirar nieve compactada.",
    acciones: [
      A("Servicio de Limpieza / UTE de vialidad invernal", "Activar los turnos completos de quitanieves y esparcidores de salmuera sobre la red viaria prioritaria.", "30 min", "alta"),
      A("Policía Municipal", "Vigilancia de los puntos con histórico de placas de hielo: puentes, rampas y accesos hospitalarios.", "20 min", "alta"),
      A("SAMUR Social", "Activar la campaña de frío: equipos de calle y ampliación de plazas de albergue.", "40 min", "alta"),
      A("EMT", "Revisión de itinerarios con pendiente y preparación de cadenas en la flota.", "35 min", "media"),
    ],
    mensajeAlerta: `Activado el plan municipal de nevadas en ${d.lugarCorto}. Turnos completos de vialidad invernal y campaña de frío en marcha.`,
    urgencia: "alta",
    riesgo: 25,
    costeDeNoActuar: "Nieve compactada y placas de hielo en la red principal, con accesos hospitalarios cortados durante horas.",
    plazoMinutos: 25,
    alternativas: [
      alt("Esperar a que empiece a cuajar", "El tratamiento preventivo sobre calzada limpia es varias veces más eficaz que actuar sobre nieve ya compactada."),
      alt("Activar solo la retirada de nieve sin campaña de frío", "Las noches de helada son las de mayor riesgo vital para las personas sin hogar: la campaña no es accesoria."),
    ],
  }),
  "nevada:tratamiento_vias": (d) => ({
    titulo: d.tit("Tratamiento preventivo de la red viaria prioritaria", d.dEvento, d.dTrafico),
    resumen: `Se propone tratamiento preventivo con salmuera y fundentes en la red viaria prioritaria de ${d.lugarCorto}: accesos hospitalarios, ejes de transporte público, rampas y puentes${d.dTrafico ? `, aprovechando la ventana de ${d.dTrafico} antes de la hora punta` : ""}.`,
    severidad: "alta",
    protocolo: { nombre: "Vialidad invernal: tratamiento preventivo" },
    razonamiento: "El orden de tratamiento es el que fija el plan: primero lo que da acceso a hospitales y transporte público, después el resto de la red.",
    acciones: [
      A("Servicio de Limpieza / vialidad invernal", "Esparcido de salmuera en accesos hospitalarios, ejes de EMT, puentes y rampas antes del pico de tráfico.", "35 min", "alta"),
      A("Policía Municipal", "Control de las rampas y puentes tratados y corte puntual de los tramos con placa de hielo detectada.", "20 min", "alta"),
      A("Centro de Gestión de Tráfico", "Paneles con el estado de la red y los itinerarios tratados recomendados.", "15 min", "media"),
      A("EMT", "Mantenimiento del servicio en los ejes tratados y supresión temporal de los ramales con pendiente no tratada.", "30 min", "media"),
    ],
    mensajeAlerta: `Vialidad invernal: tratamiento preventivo en ${d.lugarCorto}, prioridad a accesos hospitalarios y ejes de EMT. Policía, informen de placas de hielo.`,
    urgencia: "alta",
    riesgo: 25,
    costeDeNoActuar: "Accesos hospitalarios con hielo y autobuses bloqueados en rampas, arrastrando al resto de la red.",
    plazoMinutos: 25,
    alternativas: [
      alt("Tratar toda la red viaria por igual", "Los medios de vialidad invernal son limitados: repartirlos sin prioridad deja los accesos hospitalarios sin tratar a tiempo."),
      alt("Retirar la nieve con maquinaria en vez de tratar", "La retirada llega después; el fundente evita que llegue a cuajar, que es mucho más barato."),
    ],
  }),
  "nevada:restriccion_trafico": (d) => ({
    titulo: d.tit("Restricción de tráfico pesado y obligación de cadenas", d.dTrafico, d.dEvento),
    resumen: `Se propone restringir la circulación de vehículos pesados y exigir cadenas o neumáticos de invierno en los accesos con pendiente de ${d.lugarCorto}${d.dTrafico ? ` (${d.dTrafico} en los sensores municipales)` : ""}, con áreas de espera habilitadas para los camiones retenidos.`,
    severidad: "alta",
    protocolo: { nombre: "Restricción de circulación por nevada" },
    razonamiento: "Un solo camión cruzado en una rampa bloquea el eje y deja detrás a las quitanieves: la restricción del pesado protege la capacidad de tratar la vía.",
    acciones: [
      A("Policía Municipal / Guardia Civil de Tráfico", "Restricción de vehículos pesados en los accesos con pendiente y control de cadenas o neumáticos de invierno.", "20 min", "alta"),
      A("Centro de Gestión de Tráfico", "Paneles con la restricción vigente, los itinerarios alternativos y las áreas de espera habilitadas.", "12 min", "alta"),
      A("Protección Civil", "Áreas de espera para camiones retenidos con agua, mantas y aseos.", "40 min", "media"),
      A("EMT", "Instalación de cadenas en la flota que cubre los itinerarios con pendiente.", "35 min", "media"),
    ],
    mensajeAlerta: `Restringida la circulación de vehículos pesados en ${d.lugarCorto} por nieve. Cadenas obligatorias en los accesos con pendiente.`,
    urgencia: "alta",
    riesgo: 45,
    costeDeNoActuar: "Camiones cruzados en las rampas bloqueando la vía y las propias máquinas quitanieves detrás del atasco.",
    plazoMinutos: 20,
    alternativas: [
      alt("Cerrar por completo los accesos", "Dejaría incomunicada a la población y bloquearía el acceso de los servicios de emergencia."),
      alt("Recomendar cadenas sin exigirlas", "La recomendación no evita que el primer vehículo sin cadenas bloquee la rampa y el eje entero."),
    ],
  }),
  "nevada:refugios_sin_hogar": (d) => ({
    titulo: d.tit("Campaña de frío: plazas de albergue y equipos de calle", d.dEvento, d.dTrafico),
    resumen: `La noche de helada en ${d.lugarCorto} es el momento de mayor riesgo vital para las personas sin hogar. Se propone ampliar plazas de albergue, reforzar los equipos de calle y habilitar un espacio municipal climatizado de acogida inmediata sin requisitos previos.`,
    severidad: "alta",
    protocolo: { nombre: "Campaña municipal contra el frío" },
    razonamiento: "El albergue solo protege si es accesible sin trámites a cualquier hora: los requisitos de entrada son la principal causa de que queden plazas libres con gente en la calle.",
    acciones: [
      A("SAMUR Social", "Refuerzo de equipos de calle en los puntos conocidos de pernocta, con mantas, bebida caliente y traslado voluntario.", "30 min", "alta"),
      A("Servicios Sociales", "Ampliación de plazas de albergue y apertura de un espacio municipal climatizado de acogida inmediata sin requisitos.", "45 min", "alta"),
      A("Protección Civil", "Transporte al albergue desde los puntos de pernocta durante toda la noche.", "40 min", "media"),
      A("Policía Municipal", "Aviso al SAMUR Social de cualquier persona localizada a la intemperie durante las rondas nocturnas.", "20 min", "media"),
    ],
    mensajeAlerta: `Campaña de frío activada en ${d.lugarCorto}: plazas ampliadas de albergue y acogida inmediata sin requisitos. Equipos de calle reforzados toda la noche.`,
    urgencia: "alta",
    riesgo: 15,
    costeDeNoActuar: "Muertes por hipotermia en la vía pública durante la noche de helada.",
    plazoMinutos: 30,
    alternativas: [
      alt("Mantener el dispositivo habitual de albergue", "Sus plazas se agotan las noches de helada, justo cuando más se necesitan."),
      alt("Traslado obligatorio de las personas localizadas", "No es legalmente posible y rompe la confianza con los equipos de calle, que dejarían de ser aceptados."),
    ],
  }),

  "sismo:activacion_plan_sismo": (d) => ({
    titulo: d.tit("Activación del plan sísmico municipal", d.dEvento, d.dTrafico),
    resumen: `Movimiento sísmico sentido en ${d.lugarCorto}${d.dEvento ? ` (${d.dEvento})` : ""}. Se propone activar el plan sísmico: reconocimiento rápido por sectores, censo de edificios sensibles (colegios, residencias, hospitales) y verificación del estado de las redes de gas, agua y electricidad.`,
    severidad: "critica",
    protocolo: { nombre: "Activación del plan de riesgo sísmico" },
    razonamiento: "Tras un seísmo la información es el recurso escaso: el reconocimiento rápido por sectores permite decidir dónde concentrar los medios antes de la primera réplica.",
    acciones: [
      A("Bomberos", "Reconocimiento rápido por sectores con informe de daños en 30 minutos y marcado de edificios con colapso o riesgo.", "20 min", "alta"),
      A("Policía Municipal", "Censo de edificios sensibles del distrito: colegios, residencias, hospitales y edificios de más de 8 alturas.", "25 min", "alta"),
      A("Canal de Isabel II / distribuidoras", "Verificación del estado de las redes de agua, gas y electricidad y corte preventivo donde haya rotura.", "30 min", "alta"),
      A("SAMUR-PC", "Despliegue de mando sanitario y preparación para atención masiva con posibles réplicas.", "20 min", "alta"),
    ],
    mensajeAlerta: `Activado el plan sísmico en ${d.lugarCorto}. Reconocimiento rápido por sectores e informe de daños en 30 minutos. Atención a posibles réplicas.`,
    urgencia: "critica",
    riesgo: 35,
    costeDeNoActuar: "Decidir sin mapa de daños y descubrir tarde los edificios colapsados o con ocupantes atrapados.",
    plazoMinutos: 10,
    alternativas: [
      alt("Enviar todos los medios al primer aviso recibido", "El primer aviso no suele ser el más grave: sin reconocimiento por sectores se concentran los medios en el sitio equivocado."),
      alt("Esperar el informe oficial de magnitud", "La magnitud no dice dónde hay daños: el reconocimiento municipal es lo único que permite priorizar."),
    ],
  }),
  "sismo:busqueda_y_rescate": (d) => ({
    titulo: d.tit("Despliegue de búsqueda y rescate tras el seísmo", d.dEvento, d.dTrafico),
    resumen: `Hay edificios con colapso y posibles atrapados en ${d.lugarCorto}. Se propone concentrar el rescate en los edificios marcados en el reconocimiento, con control de estabilidad ante réplicas y relevos programados.`,
    severidad: "critica",
    protocolo: { nombre: "Búsqueda y rescate en emergencia sísmica" },
    razonamiento: "Con réplicas probables, cada entrada a un edificio dañado se autoriza individualmente y con vigilante de seguridad estructural.",
    acciones: [
      A("Bomberos · rescate en estructuras", "Rescate en los edificios marcados con colapso, con vigilante de seguridad estructural y señal acústica de repliegue por réplica.", "20 min", "alta"),
      A("Unidad canina de rescate", "Barrido de los montones de escombro para priorizar puntos de intervención.", "30 min", "alta"),
      A("SAMUR-PC", "Puesto médico avanzado por sector y protocolo de síndrome de aplastamiento.", "20 min", "alta"),
      A("Policía Municipal", "Perímetro de los edificios marcados en rojo y control de que nadie entra a recuperar pertenencias.", "15 min", "media"),
    ],
    mensajeAlerta: `Bomberos: rescate en los edificios marcados de ${d.lugarCorto}. Vigilante estructural en cada entrada y señal de repliegue ante réplica.`,
    urgencia: "critica",
    riesgo: 50,
    costeDeNoActuar: "Atrapados sin localizar y rescatadores sorprendidos por una réplica dentro de un edificio sin vigilancia estructural.",
    plazoMinutos: 10,
    alternativas: [
      alt("Entrar en todos los edificios dañados a la vez", "No hay equipos para todos y se perdería el control de estabilidad, que es lo que protege a los rescatadores."),
      alt("Esperar a que pase el riesgo de réplicas", "La ventana de supervivencia de los atrapados es más corta que la secuencia de réplicas."),
    ],
  }),
  "sismo:evaluacion_estructural": (d) => ({
    titulo: d.tit("Inspección estructural y semáforo de habitabilidad", d.dEvento, d.dTrafico),
    resumen: `Se propone inspección estructural sistemática de los edificios de ${d.lugarCorto} con marcado verde, amarillo o rojo, empezando por colegios, residencias y edificios con daños visibles, para decidir quién puede volver a casa esta noche.`,
    severidad: "alta",
    protocolo: { nombre: "Evaluación de habitabilidad tras seísmo" },
    razonamiento: "El semáforo de habitabilidad es lo que permite devolver a la mayoría de los vecinos a sus casas y concentrar el realojo en los casos reales.",
    acciones: [
      A("Arquitectos municipales", "Inspección sistemática con marcado verde/amarillo/rojo, priorizando colegios, residencias y edificios con daños visibles.", "45 min", "alta"),
      A("Bomberos · apeos", "Apuntalamiento de urgencia en los edificios marcados en amarillo para permitir la retirada de enseres.", "40 min", "media"),
      A("Policía Municipal", "Precinto de los edificios marcados en rojo y registro de los vecinos afectados.", "20 min", "alta"),
      A("Servicios Sociales", "Realojo de los vecinos de edificios no habitables y ayudas de emergencia.", "60 min", "media"),
    ],
    mensajeAlerta: `Arquitectos municipales: inspección estructural en ${d.lugarCorto} con marcado verde/amarillo/rojo. Prioridad a colegios y residencias.`,
    urgencia: "alta",
    riesgo: 30,
    costeDeNoActuar: "Vecinos volviendo a edificios comprometidos o, al contrario, miles realojados sin necesidad.",
    plazoMinutos: 25,
    alternativas: [
      alt("Declarar no habitable todo el sector", "Realojaría a miles de personas sin necesidad y saturaría los refugios."),
      alt("Permitir el regreso general hasta que haya informe", "Un forjado comprometido puede ceder con la primera réplica: el regreso se autoriza edificio a edificio."),
    ],
  }),
  "sismo:refugios_y_puntos_reunion": (d) => ({
    titulo: d.tit("Refugios y puntos de reunión al aire libre", d.dEvento, d.dViento),
    resumen: `Mientras dura la inspección estructural en ${d.lugarCorto}, se propone habilitar puntos de reunión al aire libre y refugios con estructura verificada, con censo de personas y punto de información para familiares.`,
    severidad: "alta",
    protocolo: { nombre: "Acogida de población tras seísmo" },
    razonamiento: "Los puntos de reunión al aire libre son seguros frente a réplicas y permiten censar; el refugio cubierto solo se usa si su estructura ha sido verificada.",
    acciones: [
      A("Protección Civil", "Habilitar puntos de reunión al aire libre señalizados, con censo nominal de las personas que llegan.", "25 min", "alta"),
      A("Arquitectos municipales", "Verificación estructural previa de los pabellones y polideportivos antes de usarlos como refugio cubierto.", "40 min", "alta"),
      A("Cruz Roja", "Mantas, agua, atención sanitaria básica y apoyo psicológico en los puntos de reunión.", "35 min", "media"),
      A("Policía Municipal", "Punto de información a familiares y gestión de las listas de personas localizadas.", "20 min", "media"),
    ],
    mensajeAlerta: `Protección Civil: puntos de reunión al aire libre habilitados en ${d.lugarCorto}. Los refugios cubiertos se abrirán tras verificación estructural.`,
    urgencia: "alta",
    riesgo: 20,
    costeDeNoActuar: "Vecinos pasando la noche en la calle sin censo, sin abrigo y sin información para sus familias.",
    plazoMinutos: 25,
    alternativas: [
      alt("Abrir de inmediato los polideportivos como refugio", "Sin verificación estructural se estaría metiendo a cientos de personas en un edificio que no se sabe si resiste una réplica."),
      alt("No habilitar acogida y esperar al regreso a los domicilios", "La inspección tarda horas: sin puntos de reunión la gente se dispersa y no hay forma de censar."),
    ],
  }),

  "aglomeracion:activacion_plan_aglomeracion": (d) => ({
    titulo: d.tit("Activación del dispositivo de control de multitudes", d.dEvento, d.dTrafico),
    resumen: `Densidad de personas peligrosa en ${d.lugar}${d.dEvento ? ` (${d.dEvento})` : ""}. Se propone mando único del dispositivo, medición de densidad por sectores con las cámaras municipales y liberación inmediata de las vías de escape antes de que la presión siga subiendo.`,
    severidad: "critica",
    protocolo: { nombre: "Control de multitudes y prevención de avalancha" },
    razonamiento: "En una multitud la avalancha se produce por presión acumulada, no por pánico: la medida que salva vidas es reducir la densidad y abrir salidas, en ese orden.",
    acciones: [
      A("Policía Municipal", "Mando único del dispositivo, medición de densidad por sectores con las cámaras municipales y liberación de las vías de escape.", "8 min", "alta"),
      A("Organización del evento", "Detener el acceso de nuevos asistentes y abrir todas las salidas de emergencia sin excepción.", "5 min", "alta"),
      A("SAMUR-PC", "2 unidades y punto de atención en el perímetro, con acceso reservado al interior del recinto.", "10 min", "alta"),
      A("Megafonía del recinto", "Mensajes de descompresión: indicaciones de salida por sectores, sin transmitir urgencia ni alarma.", "4 min", "alta"),
    ],
    mensajeAlerta: `Densidad crítica en ${d.lugar}. Detengan el acceso, abran todas las salidas y midan densidad por sectores. Mando único de Policía Municipal.`,
    urgencia: "critica",
    riesgo: 40,
    costeDeNoActuar: "Avalancha por presión acumulada, con asfixia compresiva en los puntos de estrechamiento.",
    plazoMinutos: 5,
    alternativas: [
      alt("Desalojar el recinto de inmediato por megafonía", "Un desalojo general con esta densidad concentra a todos en las salidas y provoca justo la avalancha que se quiere evitar."),
      alt("Mantener el acceso y reforzar la vigilancia", "Con la densidad medida, cada persona que entra empeora la presión: cerrar el acceso es la primera medida."),
    ],
  }),
  "aglomeracion:control_aforo_accesos": (d) => ({
    titulo: d.tit("Cierre de accesos y control de aforo", d.dEvento, d.dTrafico),
    resumen: `Se propone cierre de accesos al recinto de ${d.lugar} y control de aforo con recuento en tiempo real, permitiendo solo la entrada de servicios de emergencia hasta que la densidad baje del umbral de seguridad.`,
    severidad: "critica",
    protocolo: { nombre: "Control de aforo en recinto saturado" },
    razonamiento: "El aforo se recupera dejando salir y no dejando entrar: es la palanca más rápida y la de menor riesgo sobre la densidad.",
    acciones: [
      A("Policía Municipal", "Cierre de los accesos al recinto, con paso exclusivo para servicios de emergencia y recuento en tiempo real.", "6 min", "alta"),
      A("Metro de Madrid / EMT", "Paso sin parada en las estaciones del recinto y desvío de los viajeros a las estaciones contiguas.", "10 min", "alta"),
      A("Organización del evento", "Recuento de aforo por sectores y comunicación continua de la densidad al puesto de mando.", "8 min", "alta"),
      A("Gabinete de prensa", "Mensaje en redes y medios: recinto al completo, no acudan y utilicen los accesos alternativos indicados.", "6 min", "media"),
    ],
    mensajeAlerta: `Policía Municipal: accesos cerrados en ${d.lugar} por aforo. Metro sin parada en las estaciones del recinto. Solo entran servicios de emergencia.`,
    urgencia: "critica",
    riesgo: 40,
    costeDeNoActuar: "Densidad creciente en los puntos de estrechamiento y avalancha en los accesos.",
    plazoMinutos: 6,
    alternativas: [
      alt("Filtrar la entrada sin cerrar los accesos", "Con la afluencia actual el filtrado no reduce la densidad, solo la retrasa unos minutos."),
      alt("Cerrar también las salidas para controlar los flujos", "Cerrar salidas en una multitud densa es el error que convierte una aglomeración en una avalancha."),
    ],
  }),
  "aglomeracion:pasillo_sanitario": (d) => ({
    titulo: d.tit("Pasillo sanitario y puesto de atención en el recinto", d.dEvento, d.dTrafico),
    resumen: `Se propone abrir y mantener un pasillo sanitario desde el interior del recinto de ${d.lugar} hasta el puesto médico avanzado en el perímetro, con equipos a pie capaces de entrar donde no llega la ambulancia.`,
    severidad: "alta",
    protocolo: { nombre: "Asistencia sanitaria en aglomeración" },
    razonamiento: "En alta densidad la ambulancia no entra: la asistencia depende de equipos a pie y de un pasillo mantenido físicamente por agentes.",
    acciones: [
      A("Policía Municipal", "Apertura y mantenimiento físico del pasillo sanitario con cordón de agentes desde el sector crítico al perímetro.", "8 min", "alta"),
      A("SAMUR-PC", "Equipos a pie con material de reanimación dentro del recinto y puesto médico avanzado en el perímetro.", "10 min", "alta"),
      A("SUMMA 112", "Ambulancias en el perímetro con reparto hospitalario preacordado para casos de asfixia compresiva.", "15 min", "alta"),
      A("Megafonía del recinto", "Petición de paso para los equipos sanitarios por el pasillo señalizado, repetida por sectores.", "5 min", "media"),
    ],
    mensajeAlerta: `SAMUR-PC y Policía Municipal: pasillo sanitario abierto en ${d.lugar}. Equipos a pie dentro del recinto y puesto médico en el perímetro.`,
    urgencia: "alta",
    riesgo: 30,
    costeDeNoActuar: "Asistencia imposible a los afectados por asfixia compresiva en el interior de la multitud.",
    plazoMinutos: 8,
    alternativas: [
      alt("Entrar con ambulancias al recinto", "Con esta densidad el vehículo queda bloqueado y ocupa el espacio que necesita el pasillo a pie."),
      alt("Atender solo en el perímetro", "Los casos graves de compresión se producen en el interior y no pueden llegar por sí mismos al perímetro."),
    ],
  }),
  "aglomeracion:dispersion_ordenada": (d) => ({
    titulo: d.tit("Dispersión ordenada por sectores", d.dEvento, d.dTrafico),
    resumen: `Con la densidad ya controlada en ${d.lugar}, se propone dispersión ordenada por sectores y rutas de salida diferenciadas, con refuerzo de transporte público para absorber la salida sin nuevas concentraciones en las estaciones.`,
    severidad: "alta",
    protocolo: { nombre: "Dispersión ordenada de multitudes" },
    razonamiento: "La salida se escalona por sectores y rutas distintas para no trasladar la aglomeración desde el recinto a los accesos del transporte público.",
    acciones: [
      A("Policía Municipal", "Dispersión escalonada por sectores, con rutas de salida diferenciadas y cordón en los puntos de estrechamiento.", "12 min", "alta"),
      A("Metro de Madrid / EMT", "Refuerzo de frecuencias y apertura de todos los tornos y accesos de las estaciones próximas.", "15 min", "alta"),
      A("Megafonía del recinto", "Indicaciones de salida por sectores, con tono neutro y tiempos concretos para cada zona.", "5 min", "alta"),
      A("Protección Civil", "Puntos de agua y de reunión de menores y personas separadas de su grupo en las rutas de salida.", "20 min", "media"),
    ],
    mensajeAlerta: `Policía Municipal: dispersión ordenada por sectores en ${d.lugar}. Refuerzo de metro y EMT para absorber la salida sin nuevas concentraciones.`,
    urgencia: "alta",
    riesgo: 35,
    costeDeNoActuar: "Trasladar la aglomeración del recinto a los accesos del transporte público, con el mismo riesgo de avalancha.",
    plazoMinutos: 10,
    alternativas: [
      alt("Desalojo simultáneo de todo el recinto", "Concentraría a todos los asistentes en las mismas salidas y estaciones en el mismo minuto."),
      alt("Mantener a la gente dentro hasta que se vacíen los accesos", "La densidad interior es el problema: retenerla más tiempo aumenta la presión en los estrechamientos."),
    ],
  }),

  "vertido_quimico:activacion_plan_vertido_quimico": (d) => ({
    titulo: d.tit("Activación de la respuesta NRBQ por vertido", d.dEvento, d.dViento),
    resumen: `Vertido de sustancia peligrosa en ${d.lugar}${d.dEvento ? ` (${d.dEvento})` : ""}. Con ${d.dViento} los vapores derivan hacia el ${d.hacia}. Se propone identificar el producto por el panel naranja o la ficha de seguridad, zonificar y trabajar solo con equipos de protección adecuados al producto.`,
    severidad: "critica",
    protocolo: { nombre: "Intervención en vertido de sustancias peligrosas" },
    razonamiento: "Sin identificación del producto no se puede elegir ni el equipo de protección ni el absorbente: identificar va antes que contener.",
    acciones: [
      A("Bomberos · riesgo químico", "Identificación del producto por panel naranja y ficha de seguridad; zonificación caliente/templada/fría y estación de descontaminación.", "12 min", "alta"),
      A("Policía Municipal", "Perímetro amplio a favor del viento, corte de tráfico y control de accesos a la zona caliente.", "8 min", "alta"),
      A("SAMUR-PC", "Unidad de descontaminación y asistencia a posibles expuestos, fuera de la zona caliente.", "15 min", "alta"),
      A("Canal de Isabel II", "Alerta a la red de saneamiento y localización de los imbornales y colectores que recibirían el vertido.", "15 min", "alta"),
    ],
    mensajeAlerta: `Vertido de sustancia peligrosa en ${d.lugar}. Identificación del producto en curso, zona caliente acordonada y vapores derivando hacia el ${d.hacia}.`,
    urgencia: "critica",
    riesgo: 40,
    costeDeNoActuar: "Exposición de vecinos e intervinientes a un producto sin identificar y entrada del vertido en la red de saneamiento.",
    plazoMinutos: 6,
    alternativas: [
      alt("Contener el vertido antes de identificar el producto", "El absorbente y el equipo de protección dependen del producto: actuar a ciegas puede provocar una reacción peor."),
      alt("Baldear el vertido con agua", "Con muchos productos el agua disuelve y dispersa el contaminante por toda la red de saneamiento."),
    ],
  }),
  "vertido_quimico:contencion_vertido": (d) => ({
    titulo: d.tit("Contención del vertido y sellado de imbornales", d.dEvento, d.dViento),
    resumen: `Se propone contener el vertido de ${d.lugar} con barreras y absorbentes compatibles con el producto identificado, sellar los imbornales aguas abajo y retirar el residuo con gestor autorizado, sin baldear en ningún caso.`,
    severidad: "alta",
    protocolo: { nombre: "Contención y recogida de vertido peligroso" },
    razonamiento: "Cada imbornal sellado a tiempo evita kilómetros de red contaminada: la contención perimetral es la medida de mayor impacto ambiental evitado.",
    acciones: [
      A("Bomberos · riesgo químico", "Barreras de contención y absorbente compatible con el producto; prohibición expresa de baldear.", "15 min", "alta"),
      A("Servicio de Limpieza", "Sellado de los imbornales aguas abajo del vertido y balsa de contención en el punto bajo.", "20 min", "alta"),
      A("Canal de Isabel II", "Aislamiento del tramo de saneamiento afectado y muestreo aguas abajo.", "25 min", "alta"),
      A("Gestor autorizado de residuos", "Retirada y tratamiento del residuo recogido con documento de trazabilidad.", "60 min", "media"),
    ],
    mensajeAlerta: `Bomberos y Servicio de Limpieza: contención del vertido en ${d.lugar} y sellado de imbornales aguas abajo. No baldear bajo ningún concepto.`,
    urgencia: "alta",
    riesgo: 35,
    costeDeNoActuar: "Vertido incorporado a la red de saneamiento, con contaminación difusa y coste de descontaminación multiplicado.",
    plazoMinutos: 10,
    alternativas: [
      alt("Baldear la calzada para limpiar el vertido", "Dispersa el producto por toda la red de saneamiento y convierte un vertido puntual en uno difuso."),
      alt("Esperar al gestor autorizado para actuar", "El gestor tarda una hora; los imbornales se sellan en veinte minutos y es lo que decide el alcance final."),
    ],
  }),
  "vertido_quimico:corte_captacion_agua": (d) => ({
    titulo: d.tit("Corte de captación y abastecimiento aguas abajo", d.dEvento, d.dViento),
    resumen: `Existe riesgo de que el vertido de ${d.lugar} alcance la captación de agua. Se propone cerrar la captación aguas abajo, aislar el depósito afectado, muestrear la red y abastecer con cisternas mientras dure la incertidumbre analítica.`,
    severidad: "critica",
    protocolo: { nombre: "Protección del abastecimiento ante vertido" },
    razonamiento: "El corte preventivo de captación es reversible en horas; la contaminación de un depósito de abastecimiento afecta a decenas de miles de personas y tarda días en resolverse.",
    acciones: [
      A("Canal de Isabel II", "Cierre de la captación aguas abajo del vertido y aislamiento del depósito que pudiera verse afectado.", "20 min", "alta"),
      A("Canal de Isabel II · laboratorio", "Muestreo y análisis de urgencia en la red y en el depósito, con resultado preliminar en 2 horas.", "40 min", "alta"),
      A("Protección Civil", "Abastecimiento con cisternas y reparto de agua embotellada en los puntos sensibles: hospitales, residencias y colegios.", "45 min", "alta"),
      A("112 / ES-Alert", `Aviso de no consumo de agua de red en la zona afectada de ${d.lugarCorto} hasta nuevo aviso.`, "10 min", "alta"),
    ],
    mensajeAlerta: `Canal de Isabel II: cierre de captación aguas abajo del vertido de ${d.lugarCorto} y aviso de no consumo en la zona hasta los resultados analíticos.`,
    urgencia: "critica",
    riesgo: 70,
    costeDeNoActuar: "Contaminación del agua de abastecimiento de decenas de miles de personas antes de que exista una analítica.",
    plazoMinutos: 12,
    alternativas: [
      alt("Esperar a los resultados analíticos antes de cortar", "El agua contaminada llegaría a los grifos antes que el resultado del laboratorio."),
      alt("Cortar el abastecimiento de todo el municipio", "Desproporcionado: el riesgo está acotado al tramo aguas abajo del vertido y hay sectorización disponible."),
    ],
  }),
  "vertido_quimico:confinamiento_perimetro": (d) => ({
    titulo: d.tit("Confinamiento del perímetro por vapores", d.dViento, d.dEvento),
    resumen: `Con ${d.dViento} y deriva de los vapores hacia el ${d.hacia}, se propone confinamiento de la población del perímetro: ventanas cerradas, climatización apagada y nadie en la calle, que protege más que evacuar a través de la nube.`,
    severidad: "alta",
    protocolo: { nombre: "Confinamiento por vapores tóxicos" },
    razonamiento: "Frente a una nube de vapores el interior de la vivienda con huecos cerrados es un refugio eficaz durante el tiempo que tarda en pasar: evacuar obligaría a atravesarla.",
    acciones: [
      A("112 / ES-Alert", `Alerta de confinamiento en el perímetro de ${d.lugarCorto}: cerrar ventanas, apagar climatización y no salir a la calle.`, "5 min", "alta"),
      A("Policía Municipal", "Perímetro con megafonía móvil y control de que nadie circula a pie dentro de la zona afectada.", "8 min", "alta"),
      A("Bomberos · riesgo químico", "Medición continua de concentración en el perímetro y aviso inmediato si procede pasar a evacuación.", "12 min", "alta"),
      A("Agente de voz (HappyRobot)", "Llamada a colegios, residencias y centros de día del perímetro con la instrucción de confinamiento.", "6 min", "alta"),
    ],
    mensajeAlerta: `Confinamiento en el perímetro de ${d.lugarCorto} por vapores. Cierren ventanas, apaguen la climatización y no salgan a la calle hasta nuevo aviso.`,
    urgencia: "alta",
    riesgo: 45,
    costeDeNoActuar: "Vecinos expuestos a vapores tóxicos en la calle y en viviendas con la climatización tomando aire exterior.",
    plazoMinutos: 6,
    alternativas: [
      alt("Evacuación del perímetro", "Obligaría a la población a atravesar la nube de vapores, que es exactamente lo que el confinamiento evita."),
      alt("Solo aviso por redes sociales", "No llega con la inmediatez necesaria a colegios y residencias, que necesitan la instrucción en minutos."),
    ],
  }),

  "persona_peligro:activacion_plan_persona_peligro": (d) => ({
    titulo: d.tit("Activación del dispositivo de rescate de persona en peligro", d.dEvento, d.dViento),
    resumen: `Aviso de persona en peligro en ${d.lugar}${d.dEvento ? ` (${d.dEvento})` : ""}. Se propone activar el dispositivo de rescate con los medios especializados que corresponda al medio, asegurar primero la seguridad de los intervinientes y mantener contacto visual o verbal continuo con la persona.`,
    severidad: "critica",
    protocolo: { nombre: "Rescate de persona en peligro" },
    razonamiento: "El contacto continuo con la persona estabiliza la situación y da información para elegir la técnica de rescate correcta antes de improvisar.",
    acciones: [
      A("Bomberos · rescate", "Despliegue del equipo especializado según el medio (altura, agua o espacio confinado) y aseguramiento de la zona.", "8 min", "alta"),
      A("SAMUR-PC", "1 unidad de soporte vital avanzado en el punto, con psicólogo de guardia si el aviso lo sugiere.", "10 min", "alta"),
      A("Policía Municipal", "Perímetro discreto, contacto verbal continuo con la persona y retirada de curiosos y cámaras.", "6 min", "alta"),
      A("Centro de Mando", "Recabar información de familiares o testigos sobre estado, patologías y circunstancias.", "10 min", "media"),
    ],
    mensajeAlerta: `Bomberos y SAMUR-PC: dispositivo de rescate en ${d.lugar}. Perímetro discreto y contacto verbal continuo con la persona.`,
    urgencia: "critica",
    riesgo: 30,
    costeDeNoActuar: "Desenlace irreversible mientras se decide qué medios enviar.",
    plazoMinutos: 5,
    alternativas: [
      alt("Intervenir sin equipo especializado", "Los rescates improvisados en altura o en agua acaban con dos personas en peligro en vez de una."),
      alt("Esperar a tener toda la información antes de movilizar", "Los medios especializados tardan en llegar: se movilizan ya y se ajusta la técnica al llegar."),
    ],
  }),
  "persona_peligro:localizacion_y_rescate": (d) => ({
    titulo: d.tit("Técnica de rescate y medios especializados", d.dEvento, d.dViento),
    resumen: `Se propone ejecutar el rescate en ${d.lugar} con el equipo especializado correspondiente, punto de anclaje verificado y plan de respaldo, manteniendo la comunicación con la persona durante toda la maniobra.`,
    severidad: "critica",
    protocolo: { nombre: "Ejecución de rescate especializado" },
    razonamiento: "La maniobra se hace con doble seguridad y plan de respaldo: el rescate que sale mal convierte a los intervinientes en víctimas.",
    acciones: [
      A("Bomberos · rescate especializado", "Montaje del sistema con punto de anclaje verificado, doble seguridad y plan de respaldo antes de iniciar la maniobra.", "12 min", "alta"),
      A("SAMUR-PC", "Asistencia inmediata en el punto de recepción y traslado al hospital útil más próximo.", "10 min", "alta"),
      A("Policía Municipal", "Zona estéril alrededor de la maniobra y control de que no se graba ni se difunde la intervención.", "6 min", "media"),
      A("Protección Civil", "Apoyo logístico, iluminación de la zona de trabajo y atención a los familiares presentes.", "15 min", "media"),
    ],
    mensajeAlerta: `Bomberos: maniobra de rescate en curso en ${d.lugar}. Zona estéril, doble seguridad montada y SAMUR-PC en el punto de recepción.`,
    urgencia: "critica",
    riesgo: 35,
    costeDeNoActuar: "La persona pierde sus posibilidades de rescate con vida mientras se prolonga la espera.",
    plazoMinutos: 8,
    alternativas: [
      alt("Rescate rápido sin doble seguridad", "Un fallo del sistema durante la maniobra añade víctimas entre los propios rescatadores."),
      alt("Esperar a medios de otra administración", "Los medios municipales ya están en el punto: esperar refuerzos externos alarga la exposición de la persona."),
    ],
  }),
  "persona_peligro:apoyo_sanitario": (d) => ({
    titulo: d.tit("Cobertura sanitaria y psicológica tras el rescate", d.dEvento, d.dViento),
    resumen: `Se propone asistencia sanitaria y psicológica a la persona rescatada en ${d.lugarCorto}, atención a los familiares presentes y apoyo posterior al equipo interviniente, preservando en todo momento la intimidad de la persona.`,
    severidad: "media",
    protocolo: { nombre: "Atención sanitaria y psicosocial tras rescate" },
    razonamiento: "El rescate no acaba con la extracción: la atención psicológica inmediata y la protección de la intimidad son parte del resultado.",
    acciones: [
      A("SAMUR-PC", "Valoración sanitaria completa y traslado al hospital útil, con acompañamiento del equipo psicosocial.", "10 min", "alta"),
      A("SAMUR-PC · psicosocial", "Atención psicológica a la persona rescatada y a los familiares presentes en el punto.", "15 min", "alta"),
      A("Policía Municipal", "Protección de la intimidad de la persona: sin imágenes, sin declaraciones y sin datos personales en ningún canal.", "8 min", "alta"),
      A("Protección Civil", "Espacio reservado para familiares, alejado de curiosos y de medios de comunicación.", "20 min", "media"),
    ],
    mensajeAlerta: `SAMUR-PC: cobertura sanitaria y psicológica tras el rescate en ${d.lugarCorto}. Preserven la intimidad de la persona y de su familia.`,
    urgencia: "media",
    riesgo: 15,
    costeDeNoActuar: "Persona rescatada sin seguimiento clínico ni psicológico y difusión de imágenes que vulneran su intimidad.",
    plazoMinutos: 15,
    alternativas: [
      alt("Traslado directo sin atención psicológica", "En este tipo de intervenciones el riesgo persiste tras el rescate: la atención inmediata es parte del tratamiento."),
      alt("Informar públicamente del caso con detalle", "Vulnera la intimidad de la persona y contraviene las recomendaciones de comunicación en estos sucesos."),
    ],
  }),

  "otro:activacion_plan_otro": (d) => ({
    titulo: d.tit("Activación de la respuesta municipal al aviso", d.dEvento, d.dViento),
    resumen: `Aviso sin encaje claro en un tipo de emergencia conocido en ${d.lugar}. ${d.descripcionFoco || "Se propone la respuesta mínima segura mientras se confirma la naturaleza del suceso."} Se moviliza reconocimiento, perímetro preventivo y cobertura sanitaria, y se revisa la decisión con el siguiente parte.`,
    severidad: "media",
    protocolo: { nombre: "Respuesta municipal a suceso sin clasificar" },
    razonamiento: "Con información incompleta la decisión correcta es la reversible: reconocer, acotar y volver a decidir con datos, sin comprometer medios de forma irreversible.",
    acciones: [
      A("Bomberos", `Reconocimiento sobre el terreno en ${d.lugar} y confirmación de la naturaleza y el alcance del suceso.`, "8 min", "alta"),
      A("Policía Municipal", "Perímetro preventivo, control de accesos y recogida de testimonios de los avisantes.", "6 min", "alta"),
      A("SAMUR-PC", "1 unidad de soporte vital avanzado en preventivo en el punto de encuentro.", "10 min", "media"),
      A("Centro de Mando", "Cruce del aviso con cámaras municipales, periféricos cercanos y datos de entorno para confirmar o descartar.", "5 min", "media"),
    ],
    mensajeAlerta: `Centro de Mando: reconocimiento y perímetro preventivo en ${d.lugar}. Confirmen naturaleza del suceso y necesidades al llegar.`,
    urgencia: "media",
    riesgo: 20,
    costeDeNoActuar: "Descartar un aviso real por no encajar en una categoría conocida y perder los primeros minutos.",
    plazoMinutos: 10,
    alternativas: [
      alt("Descartar el aviso por falta de encaje", `El último parte ("${recorta(d.ultimoTitulo, 60)}") describe un riesgo concreto: descartarlo sin reconocimiento no es una decisión informada.`),
      alt("Movilizar el dispositivo completo", "Sin confirmar la naturaleza del suceso, un despliegue máximo deja sin cobertura al resto de la ciudad."),
    ],
  }),
  "otro:valoracion_in_situ": (d) => ({
    titulo: d.tit("Reconocimiento sobre el terreno y valoración del alcance", d.dEvento, d.dViento),
    resumen: `El reconocimiento en ${d.lugar} debe cerrar las preguntas abiertas: qué ocurre, a cuánta gente afecta y qué infraestructuras hay alrededor${d.dominoTop ? ` (el grafo señala ${d.dominoTop})` : ""}. Se propone reconocimiento con reporte estructurado en 10 minutos.`,
    severidad: "media",
    protocolo: { nombre: "Reconocimiento y valoración de alcance" },
    razonamiento: "Un reporte estructurado con hora, alcance, afectados e infraestructuras próximas convierte un aviso confuso en una decisión con datos.",
    acciones: [
      A("Bomberos", "Reconocimiento con reporte estructurado en 10 minutos: naturaleza, alcance, afectados e infraestructuras próximas.", "10 min", "alta"),
      A("Periférico de campo (móvil de efectivo)", "Envío de imágenes geolocalizadas desde el punto para análisis de visión en el Centro de Mando.", "6 min", "alta"),
      A("Policía Municipal", "Entrevista con los avisantes y con los testigos presenciales para acotar la cronología.", "12 min", "media"),
      A("Centro de Mando", "Contraste del reporte con cámaras municipales, datos de entorno y avisos previos de la misma zona.", "8 min", "media"),
    ],
    mensajeAlerta: `Bomberos: reconocimiento en ${d.lugar} con reporte estructurado en 10 minutos. Envíen imágenes geolocalizadas desde el punto.`,
    urgencia: "media",
    riesgo: 15,
    costeDeNoActuar: "Seguir decidiendo sobre un aviso sin confirmar, con medios comprometidos a ciegas.",
    plazoMinutos: 10,
    alternativas: [
      alt("Decidir con la información actual", "La información disponible no permite ni dimensionar ni descartar: cualquier decisión sería arbitraria."),
      alt("Enviar un dispositivo completo a reconocer", "El reconocimiento no necesita más que una dotación y un periférico de campo."),
    ],
  }),
  "otro:medidas_de_proteccion": (d) => ({
    titulo: d.tit("Medidas de protección de la población", d.dEvento, d.dViento),
    resumen: `Con lo observado en ${d.lugar}, se propone el paquete de protección compatible con la incertidumbre: perímetro, confinamiento preventivo de los edificios más próximos y cobertura sanitaria, revisable en cuanto llegue el siguiente parte.`,
    severidad: "alta",
    protocolo: { nombre: "Medidas de protección a la población" },
    razonamiento: "Con incertidumbre se eligen las medidas reversibles y de bajo coste social: proteger sin comprometer la respuesta posterior.",
    acciones: [
      A("Policía Municipal", "Perímetro de seguridad proporcional a lo observado y control de accesos.", "6 min", "alta"),
      A("Aviso SMS vecinos", `Instrucción de autoprotección a los edificios más próximos: ${d.perfil.autoproteccion}.`, "5 min", "alta"),
      A("SAMUR-PC", "1 unidad en preventivo y plan de asistencia si la situación evoluciona.", "10 min", "media"),
      A("Protección Civil", "Preparar un punto de acogida por si fuera necesario desalojar, sin activarlo todavía.", "20 min", "baja"),
    ],
    mensajeAlerta: `Centro de Mando: perímetro y aviso de autoprotección en el entorno de ${d.lugar}. Punto de acogida preparado, no activado.`,
    urgencia: "alta",
    riesgo: 30,
    costeDeNoActuar: "Población dentro del área de riesgo sin ninguna instrucción mientras se aclara la situación.",
    plazoMinutos: 8,
    alternativas: [
      alt("Evacuar preventivamente el entorno", "Sin confirmar la naturaleza del riesgo, la evacuación tiene más coste y más riesgo que el confinamiento."),
      alt("No adoptar ninguna medida hasta confirmar", "El perímetro y el aviso son reversibles y de coste bajo: esperar solo añade exposición."),
    ],
  }),
};

// Registro final: la clave es `${tipo}:${foco}`.
const RECETAS: Record<string, Generador> = {
  ...RECETAS_FUEGO,
  ...RECETAS_AGUA_TRANSPORTE,
  ...RECETAS_RIESGO_TECNOLOGICO,
  ...RECETAS_RESTO,
};
