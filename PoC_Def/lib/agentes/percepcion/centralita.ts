// =====================================================================
// Centralita: todo lo que entra por personas. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// `procesarEntrada` la llaman los webhooks de HappyRobot y de Telegram
// (constructor D) y el formulario web: guarda la Observacion AL INSTANTE
// (para que se vea en la sala aunque el LLM tarde), extrae los datos con el
// modelo rápido al esquema `ExtraccionObservacion`, geocodifica el lugar si
// no venía con coordenadas y registra el evento "observacion".
//
// El agente `centralita` (cada 30 s) repasa las observaciones de estos canales
// que se quedaron sin extracción (porque el LLM falló) y lo reintenta.
//
// `contextoParaVoz` da al agente de voz de HappyRobot lo que necesita decir a
// quien llama: qué incendios hay cerca y qué debe hacer. Solo datos reales del
// estado; si no hay incendios cerca, lo dice.
// Dependencias: lib/ia/llm (papel "rapido"), lib/fuentes/nominatim, lib/fuentes/geo.
// =====================================================================
import { z } from "zod";
import type { Agente, ContextoAgente } from "../../motor/contratos";
import type { CanalObservacion, ExtraccionObservacion, Observacion, Punto } from "../../dominio/tipos";
import { completarJson, proveedorDisponible } from "../../ia/llm";
import { geocodificar } from "../../fuentes/nominatim";
import { haversine } from "../../fuentes/geo";
import { obtenerEstado } from "../../motor/estado";
import { nuevoId } from "../../motor/ids";

export type CanalEntrada = Extract<CanalObservacion, "llamada" | "sms" | "email" | "telegram" | "web">;

export interface EntradaCentralita {
  canal: CanalEntrada;
  texto: string;
  remitente?: string;
  referenciaExterna?: string;
  punto?: Punto;
  urlFuente?: string;
}

const esquemaExtraccion = z.object({
  esIncendio: z.boolean().describe("true si el aviso habla de fuego, humo o riesgo de incendio"),
  tipo: z.enum(["humo", "llamas", "incendio_activo", "olor", "otro"]),
  gravedad: z.enum(["leve", "moderada", "grave", "critica"]),
  lugarTexto: z.string().describe("El lugar tal y como lo dice la persona; cadena vacía si no lo dice"),
  municipio: z.string().describe("Municipio si se puede deducir; cadena vacía si no"),
  personasEnRiesgo: z.boolean(),
  viviendasCerca: z.boolean(),
  tamanoEstimado: z.string().describe("Tamaño en palabras de la persona ('como un campo de fútbol'); vacío si no lo dice"),
  resumen: z.string().describe("Una o dos frases en español para el mando"),
  fiabilidad: z.number().min(0).max(1).describe("0 a 1: credibilidad del aviso según su concreción"),
});

const SISTEMA_CENTRALITA = `Eres un operador del 112 en España especializado en incendios forestales. Recibes avisos por teléfono, SMS, correo, Telegram o el formulario web.
Extrae SOLO lo que dice el mensaje, sin suponer ni completar lo que falte:
- el LUGAR con todas las referencias que dé la persona (carretera y punto kilométrico, paraje, ermita, cortafuegos, urbanización, nombre del pueblo)
- si habla de HUMO, de LLAMAS o de las dos cosas, y si el fuego avanza
- si hay PERSONAS en riesgo (excursionistas, ganado, coches atrapados) o VIVIENDAS cerca
- el TAMAÑO con las palabras de la persona
Gravedad: "leve" = columna pequeña lejos de todo; "moderada" = fuego visible sin gente cerca; "grave" = viviendas o carreteras amenazadas; "critica" = personas en peligro inmediato o evacuación.
Fiabilidad: alta si la persona da lugar concreto y detalles coherentes; baja si es vago, contradictorio o de oídas.
Si el mensaje NO habla de un incendio, esIncendio=false y explícalo en el resumen. Responde SIEMPRE en español.`;

const CANALES_CENTRALITA: CanalObservacion[] = ["llamada", "sms", "email", "telegram", "web"];

const nombreCanal: Record<CanalEntrada, string> = {
  llamada: "Llamada",
  sms: "SMS",
  email: "Correo",
  telegram: "Telegram",
  web: "Formulario web",
};

/** Convierte la salida del LLM (con cadenas vacías) al tipo del dominio. */
function aExtraccion(d: z.infer<typeof esquemaExtraccion>): ExtraccionObservacion {
  return {
    esIncendio: d.esIncendio,
    tipo: d.tipo,
    gravedad: d.gravedad,
    lugarTexto: d.lugarTexto.trim() || undefined,
    municipio: d.municipio.trim() || undefined,
    personasEnRiesgo: d.personasEnRiesgo,
    viviendasCerca: d.viviendasCerca,
    tamanoEstimado: d.tamanoEstimado.trim() || undefined,
    resumen: d.resumen.trim(),
    fiabilidad: Math.max(0, Math.min(1, d.fiabilidad)),
  };
}

/**
 * Sitúa la observación en el mapa probando varias consultas, de la más fiable
 * a la más vaga: municipio limpio → municipio + lugar → lugar tal cual. La
 * gente dice "carretera de A a B", que Nominatim no entiende, pero el nombre
 * del pueblo sí. Si nada cuadra, se queda sin punto (nunca se inventa uno).
 */
async function situar(extraccion: ExtraccionObservacion): Promise<Punto | undefined> {
  const municipios = (extraccion.municipio ?? "")
    .split(/[/,;]| o | y /i)
    .map((m) => m.trim())
    .filter((m) => m.length > 2);
  const lugar = (extraccion.lugarTexto ?? "").trim();
  const candidatas = [
    ...municipios,
    ...(lugar && municipios[0] ? [`${lugar}, ${municipios[0]}`] : []),
    ...(lugar ? [lugar] : []),
  ];
  for (const c of candidatas.slice(0, 4)) {
    try {
      const encontrado = await geocodificar(c.includes("España") ? c : `${c}, España`);
      if (encontrado) return encontrado.punto;
    } catch (e) {
      console.warn("[centralita] geocodificación fallida:", e instanceof Error ? e.message : e);
    }
  }
  return undefined;
}

/** Extrae y geocodifica una observación ya guardada. Devuelve la actualizada. */
async function enriquecerObservacion(observacion: Observacion): Promise<Observacion> {
  const estado = obtenerEstado();
  const extraccion = aExtraccion(
    (
      await completarJson({
        system: SISTEMA_CENTRALITA,
        user: `Canal: ${observacion.canal}. Remitente: ${observacion.remitente ?? "desconocido"}.\n\nMensaje recibido:\n"""\n${observacion.texto}\n"""`,
        esquema: esquemaExtraccion,
        nombreEsquema: "extraccion_observacion",
        papel: "rapido",
      })
    ).datos,
  );

  const punto = observacion.punto ?? (await situar(extraccion));

  const actualizada = estado.actualizar(estado.observaciones, observacion.id, { extraccion, punto }) ?? { ...observacion, extraccion, punto };
  const critico = extraccion.esIncendio && (extraccion.gravedad === "grave" || extraccion.gravedad === "critica");
  estado.registrarEvento(
    "observacion",
    `${nombreCanal[observacion.canal as CanalEntrada] ?? observacion.canal} de ${observacion.remitente ?? "un ciudadano"}: ${extraccion.resumen}`,
    {
      agenteId: "centralita",
      nivel: critico ? "critico" : extraccion.esIncendio ? "aviso" : "info",
      datos: {
        observacionId: observacion.id,
        gravedad: extraccion.gravedad,
        esIncendio: extraccion.esIncendio,
        punto,
        fiabilidad: extraccion.fiabilidad,
      },
    },
  );
  return actualizada;
}

/**
 * Punto de entrada único de los avisos humanos.
 * Guarda la observación inmediatamente; si el LLM falla, la observación se
 * queda registrada SIN extracción y el agente `centralita` lo reintenta.
 */
export async function procesarEntrada(entrada: EntradaCentralita): Promise<Observacion> {
  const estado = obtenerEstado();
  const texto = (entrada.texto ?? "").trim();
  if (!texto) throw new Error("La entrada no trae texto: no se puede registrar una observación vacía");

  const observacion: Observacion = {
    id: nuevoId("obs"),
    canal: entrada.canal,
    recibidaEn: new Date().toISOString(),
    texto,
    remitente: entrada.remitente,
    urlFuente: entrada.urlFuente,
    punto: entrada.punto,
    referenciaExterna: entrada.referenciaExterna,
  };
  estado.guardar(estado.observaciones, observacion);

  if (!proveedorDisponible()) {
    estado.registrarEvento("observacion", `${nombreCanal[entrada.canal]} de ${entrada.remitente ?? "un ciudadano"} registrada sin analizar (sin proveedor de IA)`, {
      agenteId: "centralita",
      nivel: "aviso",
      datos: { observacionId: observacion.id },
    });
    return observacion;
  }

  try {
    return await enriquecerObservacion(observacion);
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    estado.marcarServicio("Centralita", false, detalle);
    estado.registrarEvento("observacion", `${nombreCanal[entrada.canal]} registrada, pendiente de analizar: ${detalle}`, {
      agenteId: "centralita",
      nivel: "aviso",
      datos: { observacionId: observacion.id },
    });
    return observacion;
  }
}

// ---------------------------------------------------------------------
// Contexto para el agente de voz (lo expone D en /api/happyrobot/contexto)
// ---------------------------------------------------------------------

export interface ContextoVoz {
  incendiosCercanos: { nombre: string; distanciaKm: number; estado: string; consejo: string }[];
  consejoGeneral: string;
}

const CONSEJO_POR_RIESGO: Record<string, string> = {
  inminente: "Salga ya de la zona por la carretera que se aleja del humo y llame al 112 cuando esté a salvo.",
  alto: "Prepárese para salir: cierre puertas y ventanas, moje el entorno de la casa y esté pendiente del teléfono.",
  medio: "Manténgase informado y no se acerque a la zona; deje las carreteras libres para los medios.",
  bajo: "No hay peligro inmediato en su posición; evite acercarse a la zona del incendio.",
};

/** Riesgo aproximado por distancia (el mismo criterio que usa el núcleo). */
function riesgoPorDistancia(km: number): keyof typeof CONSEJO_POR_RIESGO {
  if (km <= 2) return "inminente";
  if (km <= 5) return "alto";
  if (km <= 12) return "medio";
  return "bajo";
}

/**
 * Qué contar a quien llama: incendios activos cerca de su posición (o del
 * lugar que dice) y el consejo que corresponde. Todo sale del estado real.
 */
export async function contextoParaVoz(referencia: Punto | string): Promise<ContextoVoz> {
  const estado = obtenerEstado();
  let punto: Punto | undefined;
  if (typeof referencia === "string") {
    const texto = referencia.trim();
    if (texto) {
      try {
        const lugar = await geocodificar(texto.includes("España") ? texto : `${texto}, España`);
        punto = lugar?.punto;
      } catch (e) {
        console.warn("[centralita] contextoParaVoz sin geocodificar:", e instanceof Error ? e.message : e);
      }
    }
  } else {
    punto = referencia;
  }

  const activos = estado.incendiosActivos();
  if (!punto) {
    return {
      incendiosCercanos: [],
      consejoGeneral: activos.length
        ? `No he podido situar su ubicación. Ahora mismo hay ${activos.length} incendio(s) activo(s) en España: ${activos.map((i) => i.nombre).join(", ")}. Si ve humo o llamas, llame al 112 y aléjese en dirección contraria al humo.`
        : "No hay ningún incendio activo registrado en este momento. Si ve humo o llamas, llame al 112.",
    };
  }

  const cercanos = activos
    .map((i) => ({ i, d: haversine(punto as Punto, i.centro) }))
    .filter((x) => x.d <= 50)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(({ i, d }) => {
      const riesgo = riesgoPorDistancia(d);
      const viento = i.meteo ? ` El viento sopla del ${i.meteo.direccionTexto} con rachas de ${Math.round(i.meteo.rachasKmh)} kilómetros por hora.` : "";
      return { nombre: i.nombre, distanciaKm: +d.toFixed(1), estado: i.estado, consejo: `${CONSEJO_POR_RIESGO[riesgo]}${viento}` };
    });

  const consejoGeneral = cercanos.length
    ? `Tiene ${cercanos.length === 1 ? "un incendio" : `${cercanos.length} incendios`} activos cerca. El más próximo, ${cercanos[0].nombre}, está a ${cercanos[0].distanciaKm} kilómetros. ${cercanos[0].consejo}`
    : "No hay ningún incendio activo a menos de 50 kilómetros de esa posición. Si ve humo, descríbame dónde y avisamos a los medios.";

  return { incendiosCercanos: cercanos, consejoGeneral };
}

// ---------------------------------------------------------------------
// Agente: repaso de observaciones sin extracción
// ---------------------------------------------------------------------

export const agenteCentralita: Agente = {
  id: "centralita",
  nombre: "Centralita",
  categoria: "percepcion",
  descripcion:
    "Recoge llamadas, SMS, correos, mensajes de Telegram y avisos web, extrae el lugar y la gravedad y sitúa cada aviso en el mapa.",
  modelo: "rapido",
  cadenciaSeg: 30,

  async ciclo(ctx: ContextoAgente) {
    if (!proveedorDisponible()) {
      ctx.informarTarea("Sin proveedor de IA: las entradas se registran, pero no se analizan");
      return { resumen: "Sin proveedor de IA para extraer los avisos" };
    }

    const pendientes = [...ctx.estado.observaciones.values()]
      .filter((o) => CANALES_CENTRALITA.includes(o.canal) && !o.extraccion)
      .slice(-10);

    if (!pendientes.length) {
      const total = [...ctx.estado.observaciones.values()].filter((o) => CANALES_CENTRALITA.includes(o.canal)).length;
      const resumen = total ? `Al día: ${total} avisos de personas procesados` : "A la escucha de llamadas, SMS, correos y Telegram";
      ctx.informarTarea(resumen);
      return { resumen };
    }

    ctx.informarTarea(`Analizando ${pendientes.length} aviso(s) que quedaron pendientes`);
    let hechos = 0;
    for (const o of pendientes) {
      if (ctx.abortSignal.aborted) break;
      try {
        await enriquecerObservacion(o);
        hechos += 1;
        ctx.estado.marcarServicio("Centralita", true, `Aviso de ${o.remitente ?? "un ciudadano"} analizado`);
      } catch (e) {
        ctx.estado.marcarServicio("Centralita", false, e instanceof Error ? e.message : String(e));
      }
    }
    const resumen = `Reintentados ${hechos} de ${pendientes.length} avisos pendientes`;
    ctx.informarTarea(resumen);
    return { resumen };
  },
};
