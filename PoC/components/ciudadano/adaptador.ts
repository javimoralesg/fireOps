// Adaptador EstadoSistema (GET /api/estado) → VistaPublica (forma de GET /api/publico).
// Solo se usa mientras /api/publico no exista. Reglas (docs/roles.md, principio 4):
// la ciudadanía solo ve lo verificado — nunca decisiones pendientes ni eventos sin verificar.

import type { EventoIngesta, FuenteIngesta } from "@/lib/types";
import type { Decision, EstadoSistema } from "@/lib/tipos-sistema";
import { humoHacia, lugarCorto, lecturasAire, textoUbicacion, zonaCorta } from "./interpretar";
import type { AvisoPublico, BuloDesmentido, NoticiaVerificada, VistaPublica } from "./tipos";

/** Focos de decisión que, una vez ejecutados, son comunicación a la población. */
const FOCOS_PUBLICOS = new Set(["comunicado", "evacuacion"]);
const DECISION_EJECUTADA = new Set<Decision["estado"]>(["ejecutada", "auto"]);

const FUENTE_PUBLICA: Record<FuenteIngesta, string> = {
  Exa: "Redes sociales, contrastado",
  FalAI: "Imagen analizada y confirmada",
  Ciudadano: "Aviso ciudadano confirmado",
  HappyRobot: "Llamada al 112 confirmada",
  MadridTrafico: "Informo Madrid",
  OpenMeteo: "Open-Meteo",
  REE: "Red Eléctrica",
  IGN: "Instituto Geográfico Nacional",
  AEMET: "AEMET",
  Periferico: "Aviso desde un dispositivo ciudadano",
  CamaraTrafico: "Cámara de tráfico municipal",
  Organismo: "Aviso oficial",
};

/** Quita prefijos técnicos ("Visión: …") y detalles de modelo del titular. */
function titularPublico(ev: EventoIngesta): string {
  let t = ev.titulo.replace(/^(visión|vision|exa|falai)\s*:\s*/i, "").trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (ev.ubicacion && !t.toLowerCase().includes(ev.ubicacion.split(",")[0].toLowerCase())) {
    t = `${t} · ${ev.ubicacion.split(",")[0]}`;
  }
  return t;
}

function noticias(eventos: EventoIngesta[]): NoticiaVerificada[] {
  return eventos
    .filter((e) => e.verificacion?.estado === "verificado")
    .map((e) => ({
      id: e.id,
      titulo: titularPublico(e),
      fuente: FUENTE_PUBLICA[e.fuente] ?? e.fuente,
      timestamp: e.timestamp,
      verificado: true,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function bulos(eventos: EventoIngesta[]): BuloDesmentido[] {
  return eventos
    .filter((e) => e.verificacion?.estado === "sospechoso")
    .map((e) => ({
      id: e.id,
      texto: e.detalle?.replace(/^"|"$/g, "") || e.titulo,
      desmentido:
        e.verificacion?.motivo ??
        "No coincide con la información contrastada por los servicios de emergencia. No lo compartas.",
    }));
}

function avisos(estado: EstadoSistema): AvisoPublico[] {
  const { incidente, organismo } = estado;
  const zona = zonaCorta(incidente.ubicacion, organismo.municipio);

  const deDecisiones: AvisoPublico[] = estado.decisiones
    .filter((d) => FOCOS_PUBLICOS.has(d.foco) && DECISION_EJECUTADA.has(d.estado))
    .map((d) => ({
      id: d.id,
      titulo: d.foco === "evacuacion" ? `Evacuación: ${d.tarjeta.titulo}` : d.tarjeta.titulo,
      texto: d.tarjeta.plan.mensajeAlerta,
      nivel: d.foco === "evacuacion" || d.urgencia === "critica" ? "alerta" : "aviso",
      publicadoEn: d.decididaPor?.timestamp ?? d.creadaEn,
      zonas: [zona],
    }));

  // Aviso de apertura: el organismo ha activado el incidente (dato oficial, no una propuesta).
  const apertura: AvisoPublico = {
    id: `${incidente.id}-apertura`,
    titulo: incidente.activo ? "Servicios de emergencia activados" : "Incidente cerrado",
    texto: incidente.activo
      ? `${incidente.titulo.split("—")[0].trim()} en ${lugarCorto(incidente.ubicacion)} (${zona}). Los servicios de emergencia están actuando en el lugar. Sigue las indicaciones de este canal.`
      : `Se da por finalizada la emergencia en ${lugarCorto(incidente.ubicacion)}. Gracias por tu colaboración.`,
    nivel: "info",
    publicadoEn: incidente.iniciadoEn,
    zonas: [zona],
  };

  return [...deDecisiones, apertura].sort((a, b) => b.publicadoEn.localeCompare(a.publicadoEn));
}

/** Recomendaciones por tipo de incidente, ajustadas al viento y a la calidad del aire. */
export function recomendacionesDerivadas(estado: Pick<EstadoSistema, "incidente" | "entorno" | "organismo">): string[] {
  const { incidente, entorno, organismo } = estado;
  if (!incidente.activo || incidente.fase === "cierre") {
    return [
      String(incidente.tipo).startsWith("incendio")
        ? "Puedes volver a la normalidad. Ventila tu vivienda si notas olor a humo."
        : "Puedes volver a la normalidad.",
      "Infórmate solo por canales oficiales. No compartas mensajes sin fuente.",
    ];
  }
  const zona = zonaCorta(incidente.ubicacion, organismo.municipio);
  const lugar = lugarCorto(incidente.ubicacion) || zona;
  const recs: string[] = [];

  if (incidente.tipo === "incendio_industrial") {
    const humo = entorno?.viento ? humoHacia(entorno.viento.direccionGrados) : null;
    recs.push(
      humo
        ? `Cierra puertas y ventanas si estás al ${humo.nombre} del incendio. El viento lleva el humo en esa dirección. Apaga la ventilación y el aire acondicionado.`
        : "Cierra puertas y ventanas. Apaga la ventilación y el aire acondicionado.",
    );
    recs.push(`Evita la zona de ${lugar}. Deja las calles libres para bomberos y ambulancias.`);
    const aire = entorno?.aire ? lecturasAire(entorno.aire) : [];
    if (aire.some((l) => l.ratio > 1)) {
      recs.push("No hagas ejercicio al aire libre. Si tienes asma o problemas respiratorios, ten a mano tu medicación.");
    } else {
      recs.push("Si notas olor a humo o irritación, entra en un edificio y mantente en interior.");
    }
  } else if (incidente.tipo === "apagon") {
    recs.push("Desconecta los aparatos eléctricos para evitar picos al volver la luz.");
    recs.push("No uses ascensores. Usa linternas en lugar de velas.");
    recs.push("Conserva la batería del móvil: úsalo solo para lo imprescindible.");
  } else if (incidente.tipo === "inundacion") {
    recs.push("Sube a pisos altos. No bajes a garajes ni sótanos.");
    recs.push("No cruces calles inundadas ni a pie ni en coche.");
    recs.push(`Evita la zona de ${lugar} hasta nuevo aviso.`);
  }

  recs.push("Llama al 112 solo si es una emergencia. No colapses la línea para pedir información.");
  recs.push("Infórmate solo por canales oficiales. No compartas mensajes sin fuente.");
  return recs.slice(0, 5);
}

export function adaptarEstado(estado: EstadoSistema): VistaPublica {
  const { incidente, organismo, entorno } = estado;
  return {
    organismo,
    incidente: {
      titulo: incidente.titulo,
      tipo: incidente.tipo,
      ubicacion: textoUbicacion(incidente.ubicacion),
      fase: incidente.fase,
      activo: incidente.activo,
    },
    situacionOperativa: null, // aún no existe en EstadoSistema: la UI lo deriva de la fase
    avisos: avisos(estado),
    recomendaciones: recomendacionesDerivadas(estado),
    noticiasVerificadas: noticias(estado.eventos ?? []),
    bulosDesmentidos: bulos(estado.eventos ?? []),
    entorno: entorno ? { viento: entorno.viento, aire: entorno.aire } : null,
    tareasVoluntarios: (estado.tareasVoluntarios ?? [])
      .filter((t) => t.estado === "abierta" || t.estado === "cubierta")
      .map(({ id, titulo, descripcion, lugar, cupo, aceptados, estado: e, creadaEn }) => ({
        id,
        titulo,
        descripcion,
        lugar,
        cupo,
        aceptados,
        estado: e,
        creadaEn,
      })),
    actualizadoEn: estado.actualizadoEn,
  };
}
