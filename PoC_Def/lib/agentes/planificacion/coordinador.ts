// =====================================================================
// ATALAYA INCENDIOS · Agente "coordinador" (planificación)
// ---------------------------------------------------------------------
// Propósito: el jefe de operaciones. Decide qué medios van a cada foco y a
// qué sector, cuándo pedir medios aéreos, cuándo elevar el nivel, cómo
// repartir unidades entre varios incendios y cuándo retirar a alguien por
// seguridad. Replanifica cuando el frente gira o cuando un humano deniega.
// DUEÑO: constructor D.
// Dependencias: lib/ia/llm (razonamiento), lib/fuentes/osrm (tiempos de
// viaje REALES por carretera), lib/simulacion/geometria.
// =====================================================================
import type { Decision, Evidencia, Incendio, Unidad } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { gradosATexto, haversine, rumbo } from "../../fuentes/geo";
import { completarJson, modeloPara, proveedorDisponible } from "../../ia/llm";
import { normalizarGrados } from "../../simulacion/geometria";
import { accionesDelPlan, ESQUEMA_PLAN, RUMBO_SECTOR, type Plan } from "./mapeo-plan";
import {
  bloqueDecisionesPrevias,
  bloqueLecciones,
  caducarPendientes,
  decisionBase,
  DOCTRINA_ESPANA,
  ESTADOS_VIVOS,
  fichaIncendio,
} from "./comun";

/** Candidatas a las que se les pide ruta real a OSRM (una petición por unidad). */
const CANDIDATAS_OSRM = 6;
/** Máximo de decisiones por incendio y ciclo. */
const MAX_DECISIONES = 2;
/** Focos que se planifican por ciclo (cada uno cuesta 1-2 llamadas de razonamiento). */
const FOCOS_POR_CICLO = 2;

// El esquema del plan, el tipo `Plan` y la conversión a acciones viven en
// ./mapeo-plan.ts: es la frontera entre lo que escribe el modelo y lo que
// hace el sistema, y así se puede probar sin proveedor de IA.
const ESQUEMA = ESQUEMA_PLAN;

export const coordinador: Agente = {
  id: "coordinador",
  nombre: "Coordinador de medios",
  categoria: "planificacion",
  descripcion: "Reparte unidades y sectores entre los focos, pide medios aéreos y replanifica cuando gira el frente.",
  modelo: modeloPara("razonamiento"),
  cadenciaSeg: 90,
  tiempoMaximoSeg: 240,
  despiertaCon: ["incendio_nuevo", "incendio_actualizado", "viento_gira", "peligro_sube", "unidad_llega", "decision_denegada"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const { estado } = ctx;
    const activos = estado.incendiosOperativos().filter((i) => i.estado !== "controlado");
    if (!activos.length) {
      ctx.informarTarea("Sin focos activos que coordinar");
      return { resumen: "Sin focos activos" };
    }
    if (!proveedorDisponible()) {
      ctx.informarTarea("Sin proveedor de IA configurado: el coordinador no puede planificar");
      return { resumen: "El coordinador necesita el LLM y no hay proveedor configurado (revisa las claves en la barra de servicios)" };
    }

    const decisiones: Decision[] = [];
    const resumenes: string[] = [];

    // Se ordenan los focos por urgencia: sin medios asignados primero (ataque inicial pendiente),
    // luego población amenazada, peligro y tamaño. Máximo FOCOS_POR_CICLO por ciclo para no agotar el tiempo.
    const sinMedios = (i: Incendio) => (estado.unidadesDe(i.id).length === 0 ? 1 : 0);
    const ordenados = [...activos].sort((a, b) => sinMedios(b) - sinMedios(a) || urgencia(ctx, b) - urgencia(ctx, a));

    for (const incendio of ordenados.slice(0, FOCOS_POR_CICLO)) {
      if (ctx.abortSignal.aborted) break;
      ctx.informarTarea(`Planificando el dispositivo de ${incendio.nombre}`, incendio.id);
      const nuevas = await planificarFoco(incendio, ordenados, ctx);
      decisiones.push(...nuevas);
      if (nuevas.length) resumenes.push(`${incendio.nombre}: ${nuevas.map((d) => d.titulo).join(" + ")}`);
    }

    return {
      resumen: resumenes.length ? resumenes.join(" · ") : `${activos.length} foco(s) revisados, sin cambios en el dispositivo`,
      decisiones,
    };
  },
};

/** Puntuación de urgencia de un foco: personas > viviendas > monte. */
function urgencia(ctx: ContextoAgente, i: Incendio): number {
  const poblaciones = ctx.estado.poblacionesDe(i.id);
  const inminentes = poblaciones.filter((p) => p.riesgo === "inminente").length;
  const altos = poblaciones.filter((p) => p.riesgo === "alto").length;
  const habitantes = poblaciones.filter((p) => p.riesgo === "inminente" || p.riesgo === "alto").reduce((s, p) => s + (p.habitantes ?? 0), 0);
  return inminentes * 1000 + altos * 300 + Math.min(500, habitantes / 10) + i.nivelGravedad * 200 + (i.peligro?.valor ?? 0) + Math.min(100, i.areaHa);
}

/** Motivo de replanificación si ha pasado algo desde la última decisión viva del coordinador. */
function motivoReplan(ctx: ContextoAgente, incendio: Incendio): { motivo: string; sustituyeA?: string } | undefined {
  const mias = [...ctx.estado.decisiones.values()]
    .filter((d) => d.agenteId === "coordinador" && d.incendioId === incendio.id)
    .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  const ultima = mias[mias.length - 1];
  if (!ultima) return undefined;

  // 1. Denegación humana con comentario: es lo que más enseña.
  const denegada = [...mias].reverse().find((d) => d.estado === "denegada" && d.comentarioHumano);
  if (denegada && (!ultima.decididaEn || denegada.decididaEn === ultima.decididaEn || denegada.id === ultima.id)) {
    return { motivo: `El mando denegó "${denegada.titulo}" con este motivo: "${denegada.comentarioHumano}". Se rehace el plan teniéndolo en cuenta.`, sustituyeA: denegada.id };
  }

  // 2. Giro del frente después de la última propuesta.
  const giro = ctx.estado.eventos
    .filter((e) => e.tipo === "viento_gira" && e.incendioId === incendio.id && e.en > ultima.creadaEn)
    .slice(-1)[0];
  if (giro) return { motivo: `${giro.mensaje} El plan anterior queda obsoleto.`, sustituyeA: ESTADOS_VIVOS.includes(ultima.estado) ? ultima.id : undefined };

  return undefined;
}

/** Plan determinista de ataque inicial: las dos unidades más rápidas por carretera, bomberos/BRIF primero. */
function planAtaqueInicial(incendio: Incendio, candidatas: Candidata[]): Plan {
  const preferidas = new Set<Unidad["tipo"]>(["bomberos", "brif", "agentes_forestales", "proteccion_civil"]);
  const rapidas = [...candidatas]
    .filter((c) => c.unidad.estado === "disponible")
    .sort((a, b) => {
      const pa = preferidas.has(a.unidad.tipo) ? 0 : 1;
      const pb = preferidas.has(b.unidad.tipo) ? 0 : 1;
      return pa - pb || (a.minutosCarretera ?? 1e9) - (b.minutosCarretera ?? 1e9) || a.km - b.km;
    })
    .slice(0, 2);
  const eta = (c: Candidata) => (c.minutosCarretera !== undefined ? `${c.minutosCarretera} min por carretera` : `${c.km.toFixed(1)} km`);
  return {
    titulo: `Ataque inicial — ${incendio.nombre}`,
    resumen: rapidas.length
      ? `Enviar ${rapidas.map((c) => `${c.unidad.nombre} (${eta(c)})`).join(" y ")} a la cabeza del incendio.`
      : "No hay unidades disponibles para el ataque inicial.",
    razonamiento:
      `El foco está ${incendio.estado} y no tiene ninguna unidad asignada: la doctrina exige ataque inicial a todo incendio forestal ` +
      `para evitar que crezca, aunque el peligro sea ${incendio.peligro?.nivel ?? "desconocido"}. Se eligen las unidades por tiempo real ` +
      `por carretera (OSRM), priorizando bomberos y brigadas forestales. El dispositivo se revisará con la meteorología y el frente.`,
    prioridad: 1,
    riesgo: 35,
    sectores: [{ nombre: "A", rumbo: "cabeza", descripcion: "Cabeza del incendio (ataque inicial)" }],
    despliegues: rapidas.map((c) => ({ unidadId: c.unidad.id, sector: "A", motivo: `Ataque inicial: ${eta(c)}` })),
    reasignaciones: [],
    retiradas: [],
    mediosAereos: { solicitar: false, tipo: "", motivo: "" },
    nivelPropuesto: incendio.nivelGravedad,
    motivoNivel: "",
  };
}

interface Candidata {
  unidad: Unidad;
  km: number;
  minutosCarretera?: number;
  distanciaCarreteraKm?: number;
  errorRuta?: string;
}

/** Tiempos de viaje REALES por carretera (OSRM) de las unidades más cercanas. */
async function candidatas(incendio: Incendio, unidades: Unidad[]): Promise<Candidata[]> {
  // Siempre entran los medios de extinción más cercanos (bomberos, BRIF, agentes forestales),
  // aunque en línea recta haya más ambulancias o patrullas: sin ellos no hay ataque inicial real.
  const conDistancia = unidades.map((u) => ({ unidad: u, km: haversine(u.posicion, incendio.centro) })).sort((a, b) => a.km - b.km);
  const extincion = new Set<Unidad["tipo"]>(["bomberos", "brif", "agentes_forestales", "maquinaria"]);
  const primeras = conDistancia.filter((c) => extincion.has(c.unidad.tipo)).slice(0, Math.ceil(CANDIDATAS_OSRM / 2));
  const resto = conDistancia.filter((c) => !primeras.includes(c)).slice(0, CANDIDATAS_OSRM - primeras.length);
  const cercanas = [...primeras, ...resto].sort((a, b) => a.km - b.km);

  const { ruta } = await import("../../fuentes/osrm");
  const resultados = await Promise.allSettled(cercanas.map((c) => ruta(c.unidad.posicion, incendio.centro)));
  return cercanas.map((c, i) => {
    const r = resultados[i];
    if (r.status === "fulfilled") {
      return { ...c, minutosCarretera: Math.round(r.value.duracionS / 60), distanciaCarreteraKm: +(r.value.distanciaM / 1000).toFixed(1) };
    }
    return { ...c, errorRuta: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  });
}

async function planificarFoco(incendio: Incendio, todos: Incendio[], ctx: ContextoAgente): Promise<Decision[]> {
  const { estado } = ctx;
  const replan = motivoReplan(ctx, incendio);

  const asignadas = estado.unidadesDe(incendio.id);
  const disponibles = [...estado.unidades.values()].filter((u) => u.estado === "disponible" && !u.incendioId);
  const enOtrosFocos = [...estado.unidades.values()].filter((u) => u.incendioId && u.incendioId !== incendio.id && u.estado !== "fuera_servicio");

  // Si no hay replanificación y ya hay dispositivo y decisiones vivas, no se insiste.
  const vivas = [...estado.decisiones.values()].filter((d) => d.agenteId === "coordinador" && d.incendioId === incendio.id && ESTADOS_VIVOS.includes(d.estado));
  if (!replan && vivas.length >= MAX_DECISIONES) return [];
  if (!replan && asignadas.length > 0 && vivas.length > 0) return [];

  // El entorno (parques, unidades, meteo) se carga de forma asíncrona tras declarar el foco: si aún
  // no hay unidades en el pool ni meteo, se espera al evento "incendio_actualizado" en vez de
  // planificar a ciegas (pediría medios aéreos sin conocer los medios terrestres disponibles).
  if (!replan && asignadas.length === 0 && (disponibles.length === 0 || !incendio.meteo)) {
    ctx.informarTarea(`Esperando el entorno de ${incendio.nombre} (unidades y meteorología aún cargándose)`, incendio.id);
    return [];
  }
  const listaCandidatas = disponibles.length ? await candidatas(incendio, disponibles) : [];
  // Doctrina española: todo incendio forestal detectado/confirmado recibe ATAQUE INICIAL aunque el
  // peligro sea bajo. Sin unidades asignadas ni decisión viva, el despliegue es obligatorio.
  const ataqueInicial =
    asignadas.length === 0 && vivas.length === 0 && ["detectado", "confirmado", "activo"].includes(incendio.estado) && listaCandidatas.length > 0;
  const poblaciones = estado.poblacionesDe(incendio.id).sort((a, b) => (a.etaFrenteMin ?? 1e9) - (b.etaFrenteMin ?? 1e9));
  const previas = bloqueDecisionesPrevias(ctx, incendio.id);

  const rumboFrente = incendio.frente?.rumboGrados ?? 0;
  const sectoresTexto = (["cabeza", "flanco_derecho", "flanco_izquierdo", "cola"] as const)
    .map((s) => `  ${s}: rumbo ${normalizarGrados(rumboFrente + RUMBO_SECTOR[s]).toFixed(0)}° (${gradosATexto(rumboFrente + RUMBO_SECTOR[s])})`)
    .join("\n");

  const prompt = [
    fichaIncendio(incendio),
    "",
    `Sectores posibles (referidos al rumbo del frente, ${gradosATexto(rumboFrente)}):\n${sectoresTexto}`,
    "",
    poblaciones.length
      ? `POBLACIONES (ordenadas por tiempo de llegada del frente):\n${poblaciones
          .slice(0, 10)
          .map(
            (p) =>
              `- ${p.nombre} (id ${p.id}): ${p.distanciaKm.toFixed(1)} km al ${gradosATexto(p.rumboDesdeFuegoGrados)}, ` +
              `${p.habitantes ?? "?"} habitantes, riesgo ${p.riesgo}` +
              (p.etaFrenteMin !== undefined ? `, frente en ~${p.etaFrenteMin} min` : ", fuera de trayectoria") +
              `, aviso ${p.estadoAviso}`,
          )
          .join("\n")}`
      : "POBLACIONES: ninguna registrada todavía en el radio operativo.",
    "",
    asignadas.length
      ? `UNIDADES YA ASIGNADAS A ESTE FOCO:\n${asignadas
          .map((u) => `- ${u.nombre} (id ${u.id}), ${u.tipo}, estado ${u.estado}${u.sector ? `, sector ${u.sector}` : ""}, ${u.dotacion.personas} personas`)
          .join("\n")}`
      : "UNIDADES YA ASIGNADAS A ESTE FOCO: ninguna.",
    "",
    listaCandidatas.length
      ? `UNIDADES DISPONIBLES (tiempo REAL por carretera calculado con OSRM):\n${listaCandidatas
          .map(
            (c) =>
              `- ${c.unidad.nombre} (id ${c.unidad.id}), ${c.unidad.tipo}, ${c.unidad.dotacion.personas} personas y ${c.unidad.dotacion.vehiculos} vehículos, ` +
              `base ${c.unidad.base.nombre}, ${c.km.toFixed(1)} km en línea recta, ` +
              (c.minutosCarretera !== undefined
                ? `${c.minutosCarretera} min por carretera (${c.distanciaCarreteraKm} km reales)`
                : `SIN RUTA: ${c.errorRuta ?? "OSRM no responde"}`),
          )
          .join("\n")}`
      : "UNIDADES DISPONIBLES: ninguna libre ahora mismo.",
    "",
    enOtrosFocos.length && todos.length > 1
      ? `UNIDADES EN OTROS FOCOS (se pueden reasignar si la prioridad lo justifica):\n${enOtrosFocos
          .slice(0, 12)
          .map((u) => {
            const otro = estado.incendios.get(u.incendioId as string);
            const pobOtro = otro ? estado.poblacionesDe(otro.id).filter((p) => p.riesgo === "inminente" || p.riesgo === "alto").length : 0;
            return `- ${u.nombre} (id ${u.id}) en ${otro?.nombre ?? "?"} (${otro?.areaHa.toFixed(0) ?? "?"} ha, ${pobOtro} población(es) en riesgo alto), estado ${u.estado}`;
          })
          .join("\n")}`
      : "",
    "",
    todos.length > 1
      ? `OTROS FOCOS ACTIVOS: ${todos.filter((i) => i.id !== incendio.id).map((i) => `${i.nombre} (${i.areaHa.toFixed(0)} ha, nivel ${i.nivelGravedad})`).join("; ")}`
      : "",
    previas.texto,
    replan ? `\n\nREPLANIFICACIÓN OBLIGATORIA: ${replan.motivo}` : "",
    ataqueInicial
      ? "\n\nATAQUE INICIAL OBLIGATORIO: este foco no tiene NINGUNA unidad asignada ni en ruta. Debes proponer al menos " +
        "dos despliegues (la unidad más rápida por carretera y una segunda de apoyo o reconocimiento), aunque el peligro " +
        "sea bajo o el fuego sea pequeño: la doctrina exige ataque inicial a todo incendio forestal para evitar que crezca."
      : "",
    bloqueLecciones(ctx),
  ]
    .filter(Boolean)
    .join("\n");

  let plan: Plan;
  if (ataqueInicial) {
    // Reacción inmediata: el ataque inicial no espera al modelo (decenas de segundos bajo carga).
    // El modelo refina el dispositivo en el siguiente ciclo, cuando ya hay medios en ruta.
    plan = planAtaqueInicial(incendio, listaCandidatas);
    ctx.registrar("agente", `Ataque inicial inmediato en ${incendio.nombre}: ${plan.despliegues.length} unidad(es) elegidas por tiempo real de carretera`, {
      incendioId: incendio.id,
      nivel: "info",
    });
  } else try {
    const r = await completarJson({
      // Cola prioritaria de lib/ia/llm.ts: Cadena de mando: de esta llamada sale el dispositivo.
      prioridad: "alta",
      system:
        "Eres el coordinador de medios de una sala de coordinación de incendios forestales en España (jefe de operaciones).\n" +
        DOCTRINA_ESPANA +
        "\n\nReglas de tu respuesta:\n" +
        "- Usa SIEMPRE los identificadores (id) exactos que te doy para unidades; no inventes ninguno.\n" +
        "- Elige las unidades por tiempo REAL por carretera y por adecuación (BRIF y agentes forestales al monte, bomberos a la " +
        "interfaz urbano-forestal, maquinaria a línea de defensa), no solo por cercanía.\n" +
        "- Asigna cada unidad a un sector: 'A' cabeza, 'B' flanco derecho, 'C' flanco izquierdo, 'D' cola.\n" +
        "- Pide medios aéreos si el nivel es 1 o superior, o si el combustible es pasto/matorral con viento por encima de 30 km/h.\n" +
        "- Niveles de gravedad potencial: 0 (medios ordinarios, sin población amenazada; es el nivel por defecto de todo foco " +
        "nuevo), 1 (amenaza a bienes no urbanos o requiere medios de otras administraciones), 2 (amenaza grave a población o " +
        "bienes de naturaleza urbana, o medios extraordinarios), 3 (interés nacional). Propón elevar el nivel SOLO de uno en " +
        "uno, SOLO con población en riesgo alto/inminente o medios extraordinarios ya necesarios, y NUNCA en un foco de menos " +
        "de 10 ha sin población en trayectoria; recuerda en el razonamiento que la declaración corresponde al director del plan.\n" +
        "- Retira unidades si el frente puede rolar sobre ellas.\n" +
        "- ATAQUE INICIAL: si el foco no tiene ninguna unidad asignada ni en ruta, SIEMPRE propones despliegues (mínimo dos), " +
        "aunque el peligro sea bajo o el incendio sea pequeño. Solo devuelves listas vacías cuando ya hay dispositivo y no hay nada que cambiar.\n" +
        "- Si no hay nada que cambiar (y ya hay medios asignados), devuelve listas vacías y explica por qué en el razonamiento.\n" +
        "- El razonamiento son 3 a 5 frases claras, en español, que un director de emergencias pueda leer en diez segundos.",
      user: prompt,
      esquema: ESQUEMA,
      nombreEsquema: "plan_coordinacion",
      papel: "razonamiento",
      maxTokens: 4000,
      signal: ctx.abortSignal,
    });
    plan = r.datos;
  } catch (e) {
    ctx.registrar("agente", `El coordinador no ha podido planificar ${incendio.nombre}: ${e instanceof Error ? e.message : String(e)}`, {
      incendioId: incendio.id,
      nivel: "aviso",
    });
    return [];
  }

  // Respaldo determinista: si el modelo ignora la regla de ataque inicial, se despliegan las dos
  // unidades más rápidas por carretera (bomberos/BRIF/agentes forestales primero) y se deja constancia.
  if (ataqueInicial && plan.despliegues.length === 0) {
    const preferidas = new Set<Unidad["tipo"]>(["bomberos", "brif", "agentes_forestales", "proteccion_civil"]);
    const rapidas = [...listaCandidatas]
      .filter((c) => c.unidad.estado === "disponible")
      .sort((a, b) => {
        const pa = preferidas.has(a.unidad.tipo) ? 0 : 1;
        const pb = preferidas.has(b.unidad.tipo) ? 0 : 1;
        return pa - pb || (a.minutosCarretera ?? 1e9) - (b.minutosCarretera ?? 1e9) || a.km - b.km;
      })
      .slice(0, 2);
    if (rapidas.length) {
      if (!plan.sectores.length) plan.sectores = [{ nombre: "A", rumbo: "cabeza", descripcion: "Cabeza del incendio (ataque inicial)" }];
      const sectorA = plan.sectores[0].nombre;
      plan.despliegues = rapidas.map((c) => ({
        unidadId: c.unidad.id,
        sector: sectorA,
        motivo: `Ataque inicial obligatorio: ${c.minutosCarretera !== undefined ? `${c.minutosCarretera} min por carretera` : `${c.km.toFixed(1)} km`} (respaldo determinista, el modelo no propuso despliegue)`,
      }));
      plan.titulo = `Ataque inicial — ${incendio.nombre}`;
      plan.razonamiento = `${plan.razonamiento} Corrección doctrinal: el foco no tenía ninguna unidad asignada, así que se ordena el ataque inicial con las dos unidades más rápidas por carretera.`;
      plan.prioridad = Math.min(plan.prioridad, 2) as Plan["prioridad"];
      ctx.registrar("agente", `Ataque inicial impuesto por doctrina en ${incendio.nombre}: el modelo no propuso despliegue`, { incendioId: incendio.id, nivel: "aviso" });
    }
  }

  // Conversión Plan → acciones: determinista y pura, en ./mapeo-plan.ts (frontera zod).
  // Todo lo que el modelo puede haber nombrado y ya no es cierto (una unidad que dejó
  // de estar disponible) lo descarta allí en silencio.
  const acciones = accionesDelPlan(plan, {
    incendio,
    unidades: estado.unidades,
    candidatas: listaCandidatas.map((c) => ({ unidadId: c.unidad.id, minutosCarretera: c.minutosCarretera })),
    unidadesComprometidas: new Set(
      vivas.flatMap((v) => v.acciones.map((a) => a.objetivo?.unidadId).filter((id): id is string => !!id)),
    ),
    hayMediosAereosVivos: vivas.some((v) => v.acciones.some((a) => a.tipo === "solicitar_medios_aereos")),
    hayElevarNivelVivo: vivas.some((v) => v.acciones.some((a) => a.tipo === "elevar_nivel")),
    ataqueInicial,
  });

  // Sectores: se guardan en el incendio para que los pinte la sala de mando.
  if (acciones.sectores.length) {
    estado.actualizar(estado.incendios, incendio.id, {
      sectores: acciones.sectores.map((s) => ({
        ...s,
        unidades: asignadas.filter((u) => u.sector === s.nombre).map((u) => u.id),
      })),
    });
  }

  const evidencias = evidenciasDe(incendio, listaCandidatas, poblaciones.length ? poblaciones[0] : undefined, ctx.ahoraMundo);
  const decisiones: Decision[] = [];

  const accionesDespliegue = acciones.despliegue;
  if (accionesDespliegue.length) {
    decisiones.push(
      decisionBase(ctx, {
        agenteId: "coordinador",
        incendioId: incendio.id,
        clusterId: incendio.clusterId,
        titulo: plan.titulo || `Dispositivo para ${incendio.nombre}`,
        resumen: plan.resumen,
        razonamiento: plan.razonamiento,
        prioridad: plan.prioridad as Decision["prioridad"],
        riesgo: plan.riesgo,
        acciones: accionesDespliegue,
        evidencias,
        sustituyeA: replan?.sustituyeA,
        motivoReplanificacion: replan?.motivo,
        decisionesPrevias: previas.ids,
      }),
    );
  }

  // ---- Decisión 2: nivel de gravedad, o retiradas por seguridad ----
  const accionesMando = acciones.mando;
  if (accionesMando.length && decisiones.length < MAX_DECISIONES) {
    const hayRetiradas = accionesMando.some((a) => a.tipo === "retirar_unidad");
    decisiones.push(
      decisionBase(ctx, {
        agenteId: "coordinador",
        incendioId: incendio.id,
        titulo: hayRetiradas ? `Seguridad del personal en ${incendio.nombre}` : `Elevar ${incendio.nombre} a nivel ${plan.nivelPropuesto}`,
        resumen: hayRetiradas ? "Retirada de unidades expuestas al giro del frente." : plan.motivoNivel,
        razonamiento: `${plan.motivoNivel} ${plan.razonamiento}`.trim(),
        prioridad: hayRetiradas ? 1 : (Math.min(5, Math.max(1, plan.prioridad)) as Decision["prioridad"]),
        riesgo: hayRetiradas ? Math.max(60, plan.riesgo) : Math.max(70, plan.riesgo),
        acciones: accionesMando,
        evidencias,
        sustituyeA: replan?.sustituyeA && !decisiones.length ? replan.sustituyeA : undefined,
        motivoReplanificacion: replan?.motivo,
        decisionesPrevias: previas.ids,
      }),
    );
  }

  // Replanificación: lo pendiente del plan viejo caduca.
  if (replan && decisiones.length) {
    caducarPendientes(ctx, "coordinador", incendio.id, replan.motivo, decisiones.map((d) => d.id));
  }

  // REVISIÓN OBLIGATORIA CON HUELLA (constructor M, 2026-09-19).
  // Antes, si tras un `viento_gira` el modelo concluía que no había nada que
  // cambiar (listas vacías), el coordinador no dejaba NI UN RASTRO: ni decisión
  // ni evento. Desde fuera era indistinguible de "el coordinador no se ha
  // enterado del giro", y la prueba (e) de integración se quedaba 240 s
  // esperando algo que no iba a llegar. Ahora, si hubo replanificación y no
  // salió ninguna decisión, se registra POR QUÉ: el dispositivo se ha revisado
  // y se mantiene. Es información de mando, no relleno.
  if (replan && !decisiones.length) {
    ctx.registrar(
      "agente",
      `Dispositivo de ${incendio.nombre} revisado tras el cambio, SIN cambios: ${replan.motivo} ` +
        `El coordinador mantiene el despliegue actual (${asignadas.length} unidad(es) asignadas).`,
      {
        incendioId: incendio.id,
        nivel: "aviso",
        datos: {
          replanificacion: true,
          sinCambios: true,
          motivo: replan.motivo,
          sustituyeA: replan.sustituyeA,
          unidadesAsignadas: asignadas.length,
        },
      },
    );
  }

  return decisiones.slice(0, MAX_DECISIONES);
}

function evidenciasDe(incendio: Incendio, cands: Candidata[], primeraPoblacion: { nombre: string; etaFrenteMin?: number; distanciaKm: number } | undefined, ahoraMundo: string): Evidencia[] {
  const ev: Evidencia[] = [];
  if (incendio.meteo) {
    ev.push({
      id: `ev-meteo-${incendio.id}`,
      fuente: incendio.meteo.fuente,
      resumen: `Viento ${incendio.meteo.vientoKmh.toFixed(0)} km/h del ${incendio.meteo.direccionTexto} (rachas ${incendio.meteo.rachasKmh.toFixed(0)}), HR ${incendio.meteo.humedadPct.toFixed(0)} %, ${incendio.meteo.temperaturaC.toFixed(0)} °C.`,
      url: incendio.meteo.url,
      en: incendio.meteo.horaMundo,
      confianza: 0.95,
    });
  }
  const conRuta = cands.filter((c) => c.minutosCarretera !== undefined).slice(0, 4);
  if (conRuta.length) {
    ev.push({
      id: `ev-osrm-${incendio.id}`,
      fuente: "OSRM (rutas por carretera real)",
      resumen: conRuta.map((c) => `${c.unidad.nombre}: ${c.minutosCarretera} min / ${c.distanciaCarreteraKm} km`).join(" · "),
      url: "https://router.project-osrm.org",
      en: ahoraMundo,
      confianza: 0.9,
    });
  }
  if (primeraPoblacion) {
    ev.push({
      id: `ev-pob-${incendio.id}`,
      fuente: "Modelo de propagación (Atalaya)",
      resumen: `${primeraPoblacion.nombre} a ${primeraPoblacion.distanciaKm.toFixed(1)} km` + (primeraPoblacion.etaFrenteMin !== undefined ? `, frente en ~${primeraPoblacion.etaFrenteMin} min.` : ", fuera de la trayectoria."),
      en: ahoraMundo,
      confianza: 0.75,
    });
  }
  if (incendio.frente) {
    ev.push({
      id: `ev-frente-${incendio.id}`,
      fuente: "Modelo de propagación (Atalaya)",
      resumen: `Frente al ${incendio.frente.rumboTexto} (${incendio.frente.rumboGrados.toFixed(0)}°) a ${incendio.frente.velocidadMmin.toFixed(1)} m/min; ${incendio.areaHa.toFixed(0)} ha.`,
      en: incendio.frente.calculadoEn,
      confianza: 0.8,
    });
  }
  return ev;
}

// `rumbo` se reexporta para que el ejecutor pueda calcular puntos de sector sin duplicar geometría.
export { rumbo };
