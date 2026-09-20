// =====================================================================
// ATALAYA INCENDIOS · Modelo de CONTENCIÓN y EXTINCIÓN
// ---------------------------------------------------------------------
// DUEÑO: constructor K. Función pura, sin red ni dependencias externas:
// solo el Incendio, sus Unidades y la meteo real de Open-Meteo.
//
// POR QUÉ EXISTE: hasta ahora el fuego de Atalaya solo crecía y únicamente
// se paraba si el mando lo marcaba a mano. Un incendio real se apaga porque
// alguien construye LÍNEA DE CONTROL alrededor del perímetro; cuando la
// línea cierra el perímetro el incendio está ESTABILIZADO, cuando la línea
// aguanta sin riesgo de reproducción está CONTROLADO y cuando se remata y
// enfría la franja interior está EXTINGUIDO. Este módulo modela esa carrera
// entre el perímetro que crece y los metros de línea que se construyen.
//
// -------------------------- EL MODELO --------------------------------
//
//  1. RITMO DE LÍNEA de cada unidad en `en_intervencion` sobre el foco:
//
//       ritmo_u = R0(tipo) · Dotación_u · Fcombustible · Fviento · Fataque
//
//     R0(tipo) — metros de línea por minuto de mundo, en MATORRAL, con la
//     dotación de referencia de ese tipo de medio:
//
//       bomberos (autobomba, 5 personas) ....  5 m/min   (4-6 en la literatura)
//       BRIF/brigada helitransportada (12) ..  9 m/min   (8-10)
//       agentes forestales (2) ..............  3 m/min   (quema de ensanche / remate)
//       maquinaria pesada (1 buldócer) ...... 20 m/min   (15-25)
//       medios aéreos ....................... 0 m/min    (no construyen línea: ver punto 3)
//       guardia civil / policía / ambulancia
//       / protección civil .................. 0 m/min    (aseguran accesos, cortes y
//                                                         sanitario; NO extinguen)
//
//     Órdenes de magnitud tomados de la literatura de producción de línea:
//       · NWCG, "Fireline Handbook" (PMS 410-1), tablas de *fireline production
//         rates* en cadenas/hora (1 cadena = 20,12 m).
//       · Broyles, G. (2011) "Fireline Production Rates", USDA Forest Service
//         NTDP 1151-1805 — producción por persona y por tipo de recurso.
//       · Hirsch, K.G. & Martell, D.L. (1996) "A review of initial attack fire
//         crew productivity and effectiveness", Int. J. Wildland Fire 6(4):199-215.
//       · Plucinski, M.P. (2019) "Contain and Control: Wildfire Suppression
//         Effectiveness at Incidents and Across Landscapes", Current Forestry Reports.
//     Están CALIBRADOS para minutos de mundo de la demo: son valores razonables
//     y defendibles, no una tabla oficial.
//
//     Dotación_u = recorte(personas_u / personas_referencia, 0,4, 1,8)
//     (para maquinaria y medios aéreos se escala por vehículos, no por personas).
//
//     Fcombustible — abrir línea no cuesta lo mismo en pasto que en pinar:
//       pasto 1,6 · agrícola 1,8 · matorral 1,0 · bosque 0,6 · urbano 0,8
//
//     Fviento — con viento fuerte la línea no aguanta y el trabajo directo se
//     hace imposible (U = viento efectivo = max(viento, 0,85 · rachas)):
//       U ≤ 30 km/h ......... 1,00
//       30 < U ≤ 50 ......... 1,00 → 0,55 (lineal)
//       U > 50 .............. 0,55 → 0,20 (lineal hasta 70 km/h)
//
//     Fataque — ATAQUE DIRECTO frente a LÍNEA INDIRECTA. En un foco pequeño y
//     poco intenso la dotación ataca el borde con agua y herramienta y avanza
//     casi a paso de persona; en un gran incendio hay que retirarse a abrir
//     línea en combustible sin quemar, que es mucho más lento. Se modela con
//     el tamaño del perímetro (proxy del paso de ataque inicial a ampliado):
//       perímetro ≤ 2.000 m ... 2,5   (ataque inicial, todo el borde trabajable)
//       2.000 → 6.000 m ....... 2,5 → 1,0 (lineal)
//       perímetro > 6.000 m ... 1,0   (gran incendio: construcción de línea)
//     Doctrina estándar (ataque inicial vs. ataque ampliado) y coherente con
//     Hirsch & Martell (1996), que miden productividades de ataque inicial
//     muy por encima de las de línea sostenida.
//
//     ritmo total = Σ ritmo_u de las unidades en_intervencion sobre ESE foco.
//
//  2. PERÍMETRO CONTROLADO
//       perimetroTotalM      = longitud del polígono actual (geometria.perimetroM)
//       perimetroControladoM += ritmo · minutos de mundo   (acumula, tope = total)
//       fraccion             = controlado / total
//     El perímetro sigue creciendo mientras el fuego avanza, así que la línea
//     nueva tiene que cubrir también lo que crece: la fracción puede BAJAR.
//       estimadoControlMin = (total − controlado) / (ritmo − crecimiento)
//     donde `crecimiento` es el ritmo observado de crecimiento del perímetro
//     (m/min) entre este ciclo y el anterior. Si ritmo ≤ crecimiento no
//     converge y se devuelve `undefined`: el incendio se les va de las manos.
//
//  3. EFECTO SOBRE LA PROPAGACIÓN (`factorExtincion`)
//       velocidad efectiva de cabeza = velocidad del modelo elíptico
//                                      × (1 − fraccion)^1,5
//                                      × Faéreos
//                                      × Flluvia
//     · (1 − fraccion)^1,5: con medio perímetro cogido el fuego no avanza a la
//       mitad, avanza a un 35 %; con el perímetro cerrado (fraccion = 1) se para.
//     · Faéreos = 0,6 nominal (0,50 con calma, 0,70 acercándose a 40 km/h):
//       las descargas de hidroaviones y helicópteros reducen la velocidad de la
//       cabeza entre un 30 % y un 50 % MIENTRAS el viento sea < 40 km/h y sea
//       de día (ventana operativa orto-ocaso; aquí, hora de mundo 07-21 en
//       Europe/Madrid). Con viento > 40 km/h o de noche, Faéreos = 1: las
//       descargas se dispersan y los medios no vuelan.
//       (Plucinski, M.P. & Pastor, E. (2013) "Criteria and methodology for
//       evaluating aerial wildfire suppression", Int. J. Wildland Fire 22:1144-1154.)
//     · Flluvia = 0,2 si ha llovido > 5 mm en las 24 h previas (lluvia real de
//       Open-Meteo), 1 en caso contrario.
//
//  4. HITOS
//     fraccion ≥ 1 ............ ESTABILIZADO (el perímetro deja de crecer)
//     + 60 min de mundo ....... se propone DECLARAR CONTROLADO  (decisión humana)
//     + 120 min de mundo ...... se propone DECLARAR EXTINGUIDO  (liquidación hecha)
//     REBROTE: si estando estabilizado el viento efectivo sube más de 20 km/h
//     respecto al momento de estabilizar, o el índice de peligro pasa a
//     "extremo", la fracción controlada cae un 20 % y el foco vuelve a "activo".
//
// LIMITACIONES ASUMIDAS: no hay modelo de intensidad de llama por tramo (la
// decisión ataque directo/indirecto se aproxima por el tamaño del foco), la
// línea no tiene calidad ni anchura, y no se modela el relevo ni la fatiga de
// las brigadas. Es un modelo OPERATIVO para que la sala vea la carrera entre
// el fuego y los medios, no un simulador de extinción.
// =====================================================================
import type { Decision, Incendio, TipoUnidad, Unidad } from "../dominio/tipos";
import { perimetroM, recortar } from "./geometria";
import { vientoEfectivoKmh } from "./propagacion";

/** Contención tal y como viaja en el dominio (`Incendio.contencion`). */
export type Contencion = NonNullable<Incendio["contencion"]>;

/** Minutos de mundo estabilizado antes de proponer "controlado". */
export const MINUTOS_ESTABILIZADO_A_CONTROLADO = 60;
/** Minutos de mundo controlado (liquidación) antes de proponer "extinguido". */
export const MINUTOS_CONTROLADO_A_EXTINGUIDO = 120;
/** Subida de viento efectivo (km/h) sobre el momento de estabilizar que provoca rebrote. */
export const SUBIDA_VIENTO_REBROTE_KMH = 20;
/** Fracción de línea que se pierde en un rebrote. */
export const PERDIDA_POR_REBROTE = 0.2;
/** Lluvia acumulada en 24 h (mm) a partir de la cual el fuego casi no avanza. */
export const LLUVIA_QUE_APAGA_MM = 5;
/** Velocidad residual (fracción) con lluvia significativa. */
export const FACTOR_LLUVIA = 0.2;
/** Viento efectivo (km/h) por encima del cual los medios aéreos dejan de ser eficaces. */
export const VIENTO_MAXIMO_AEREOS_KMH = 40;
/** Ventana operativa diurna de los medios aéreos (hora de mundo en Europe/Madrid). */
export const HORA_AEREOS = { desde: 7, hasta: 21 };

interface RitmoTipo {
  /** Metros de línea por minuto de mundo, en matorral, con la dotación de referencia. */
  mmin: number;
  /** Dotación de referencia. */
  referencia: number;
  /** Si la dotación se escala por vehículos en vez de por personas. */
  porVehiculos?: boolean;
  nota: string;
}

/** Ritmo de construcción de línea por tipo de medio (ver cabecera). */
export const RITMO_LINEA: Record<TipoUnidad, RitmoTipo> = {
  bomberos: { mmin: 5, referencia: 5, nota: "Autobomba con tendido de manguera y herramienta manual" },
  brif: { mmin: 9, referencia: 12, nota: "Brigada de refuerzo helitransportada, línea manual rápida" },
  agentes_forestales: { mmin: 3, referencia: 2, nota: "Quema de ensanche, contrafuego y remate" },
  maquinaria: { mmin: 20, referencia: 1, porVehiculos: true, nota: "Buldócer o tractor de cadenas abriendo faja" },
  medios_aereos: { mmin: 0, referencia: 1, porVehiculos: true, nota: "No construyen línea: enfrían la cabeza (ver factorExtincion)" },
  guardia_civil: { mmin: 0, referencia: 2, nota: "Corte de accesos y seguridad ciudadana" },
  policia: { mmin: 0, referencia: 2, nota: "Corte de accesos y tráfico" },
  ambulancia: { mmin: 0, referencia: 2, nota: "Soporte sanitario al operativo y a la población" },
  proteccion_civil: { mmin: 0, referencia: 6, nota: "Apoyo logístico, avisos y albergue" },
};

/** Cuánto cuesta abrir línea en cada combustible dominante (×). */
export const FACTOR_COMBUSTIBLE: Record<NonNullable<Incendio["combustible"]>["dominante"], number> = {
  pasto: 1.6,
  agricola: 1.8,
  matorral: 1.0,
  bosque: 0.6,
  urbano: 0.8,
};

/** Eficacia de la línea según el viento efectivo (ver cabecera). */
export function factorVientoLinea(vientoEfectivo: number): number {
  const u = Math.max(0, vientoEfectivo);
  if (u <= 30) return 1;
  if (u <= 50) return +recortar(1 - (0.45 * (u - 30)) / 20, 0.55, 1).toFixed(3);
  return +recortar(0.55 - (0.35 * (u - 50)) / 20, 0.2, 0.55).toFixed(3);
}

/** Ataque directo (foco pequeño) frente a línea indirecta (gran incendio). */
export function factorAtaque(perimetroTotalM: number): number {
  const p = Math.max(0, perimetroTotalM);
  if (p <= 2000) return 2.5;
  if (p >= 6000) return 1;
  return +(2.5 - (1.5 * (p - 2000)) / 4000).toFixed(3);
}

/** Hora del día (0-23) en Europe/Madrid para un instante de mundo ISO. */
export function horaDeMundo(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 12;
  const h = new Intl.DateTimeFormat("es-ES", { hour: "numeric", hour12: false, timeZone: "Europe/Madrid" }).format(new Date(t));
  const n = Number(h.replace(/\D/g, ""));
  return Number.isFinite(n) ? n % 24 : 12;
}

/** ¿Estamos en la ventana operativa diurna de los medios aéreos? */
export const esVentanaAerea = (iso: string): boolean => {
  const h = horaDeMundo(iso);
  return h >= HORA_AEREOS.desde && h < HORA_AEREOS.hasta;
};

/**
 * ¿Hay medios aéreos trabajando sobre el foco? Dos vías, las dos reales:
 * una unidad de tipo `medios_aereos` en intervención, o una acción
 * `solicitar_medios_aereos` EJECUTADA en alguna decisión de ese incendio.
 */
export function hayMediosAereos(incendioId: string, unidades: Unidad[], decisiones: Decision[]): boolean {
  if (unidades.some((u) => u.tipo === "medios_aereos" && u.incendioId === incendioId && (u.estado === "en_intervencion" || u.estado === "en_ruta"))) return true;
  return decisiones.some(
    (d) => d.incendioId === incendioId && d.acciones.some((a) => a.tipo === "solicitar_medios_aereos" && a.estado === "ejecutada"),
  );
}

/** Aportación de una unidad concreta a la línea de control. */
export interface AporteUnidad {
  unidadId: string;
  nombre: string;
  tipo: TipoUnidad;
  /** Metros de línea por minuto de mundo que aporta ESTA unidad, ya con todos los factores. */
  ritmoMmin: number;
  motivo: string;
}

export interface OpcionesContencion {
  /** ISO de mundo del cálculo (por defecto, `incendio.actualizadoEn`). */
  ahoraMundo?: string;
  /** Medios aéreos trabajando sobre el foco (ver `hayMediosAereos`). */
  mediosAereos?: boolean;
  /** Lluvia acumulada en las 24 h previas (mm), de Open-Meteo. */
  lluvia24Mm?: number;
}

export interface ResultadoContencion {
  /** Lo que hay que guardar en `incendio.contencion`. */
  contencion: Contencion;
  /** Desglose por unidad (para el registro y los informes; no viaja al dominio). */
  aportes: AporteUnidad[];
  /** true si en ESTE paso se ha cerrado el perímetro por primera vez. */
  estabilizaAhora: boolean;
  /** true si en ESTE paso se ha detectado un rebrote. */
  rebroteAhora: boolean;
  motivoRebrote?: string;
}

/** Ritmo de línea que aporta una unidad sobre un foco concreto. */
export function aporteDeUnidad(unidad: Unidad, combustible: keyof typeof FACTOR_COMBUSTIBLE, vientoEfectivo: number, perimetroTotalM: number): AporteUnidad {
  const tabla = RITMO_LINEA[unidad.tipo] ?? RITMO_LINEA.bomberos;
  const dotacionReal = tabla.porVehiculos ? (unidad.dotacion?.vehiculos ?? 1) : (unidad.dotacion?.personas ?? tabla.referencia);
  const escala = tabla.referencia > 0 ? recortar(dotacionReal / tabla.referencia, 0.4, 1.8) : 1;
  const fCombustible = FACTOR_COMBUSTIBLE[combustible] ?? 1;
  const fViento = factorVientoLinea(vientoEfectivo);
  const fAtaque = factorAtaque(perimetroTotalM);
  const ritmo = +(tabla.mmin * escala * fCombustible * fViento * fAtaque).toFixed(2);
  const motivo =
    tabla.mmin === 0
      ? `${tabla.nota}: no construye línea de control`
      : `${tabla.nota}: ${tabla.mmin} m/min base × ${escala.toFixed(2)} dotación × ${fCombustible.toFixed(2)} ${combustible} × ${fViento.toFixed(2)} viento × ${fAtaque.toFixed(2)} ataque`;
  return { unidadId: unidad.id, nombre: unidad.nombre, tipo: unidad.tipo, ritmoMmin: ritmo, motivo };
}

/**
 * Avanza la contención del incendio `minutosMundo` minutos de mundo.
 * Función PURA: no toca el estado, devuelve lo que hay que guardar.
 *
 * @param incendio      foco con su perímetro y su meteo reales
 * @param unidades      TODAS las unidades del sistema (se filtran las que trabajan en este foco)
 * @param minutosMundo  minutos de mundo transcurridos desde el cálculo anterior
 */
export function calcularContencion(incendio: Incendio, unidades: Unidad[], minutosMundo: number, opciones: OpcionesContencion = {}): ResultadoContencion {
  const ahora = opciones.ahoraMundo || incendio.actualizadoEn || new Date().toISOString();
  const minutos = Math.max(0, minutosMundo || 0);
  const previa = incendio.contencion;

  const combustible = incendio.combustible?.dominante ?? "matorral";
  const viento = vientoEfectivoKmh({ vientoKmh: incendio.meteo?.vientoKmh ?? 0, rachasKmh: incendio.meteo?.rachasKmh ?? 0 });

  const perimetroTotalM = Math.max(1, perimetroM(incendio.perimetro));
  const trabajando = unidades.filter((u) => u.incendioId === incendio.id && u.estado === "en_intervencion");
  const aportes = trabajando.map((u) => aporteDeUnidad(u, combustible, viento, perimetroTotalM));
  const ritmoMmin = +aportes.reduce((s, a) => s + a.ritmoMmin, 0).toFixed(2);
  const conLinea = aportes.filter((a) => a.ritmoMmin > 0).length;

  const mediosAereos = opciones.mediosAereos ?? unidades.some((u) => u.tipo === "medios_aereos" && u.incendioId === incendio.id && u.estado === "en_intervencion");
  const lluvia24Mm = opciones.lluvia24Mm ?? previa?.lluvia24Mm;

  // --- 1. Línea construida (acumula; nunca se desconstruye salvo rebrote) ---
  let controlado = Math.min(previa?.perimetroControladoM ?? 0, perimetroTotalM);
  controlado = Math.min(perimetroTotalM, controlado + ritmoMmin * minutos);

  // --- 2. Rebrote: el viento se levanta o el peligro se dispara ---------
  let estabilizadoEn = previa?.estabilizadoEn;
  let controladoEn = previa?.controladoEn;
  let vientoEstabilizadoKmh = previa?.vientoEstabilizadoKmh;
  let rebrotes = previa?.rebrotes ?? 0;
  let rebroteAhora = false;
  let motivoRebrote: string | undefined;

  if (estabilizadoEn && !previa?.extinguidoEn) {
    const subida = vientoEstabilizadoKmh !== undefined ? viento - vientoEstabilizadoKmh : 0;
    const peligroExtremo = incendio.peligro?.nivel === "extremo";
    if (subida > SUBIDA_VIENTO_REBROTE_KMH || peligroExtremo) {
      rebroteAhora = true;
      rebrotes += 1;
      motivoRebrote =
        subida > SUBIDA_VIENTO_REBROTE_KMH
          ? `el viento efectivo ha subido de ${(vientoEstabilizadoKmh ?? 0).toFixed(0)} a ${viento.toFixed(0)} km/h`
          : `el índice de peligro ha pasado a extremo (${incendio.peligro?.valor ?? "?"}/100)`;
      controlado = Math.max(0, controlado * (1 - PERDIDA_POR_REBROTE));
      estabilizadoEn = undefined;
      controladoEn = undefined;
      vientoEstabilizadoKmh = undefined;
    }
  }

  const fraccion = +recortar(controlado / perimetroTotalM, 0, 1).toFixed(4);

  // --- 3. Hito de estabilización ---------------------------------------
  const estabilizaAhora = !rebroteAhora && fraccion >= 1 && !estabilizadoEn;
  if (estabilizaAhora) {
    estabilizadoEn = ahora;
    vientoEstabilizadoKmh = +viento.toFixed(1);
  }

  // --- 4. Estimación de control total ----------------------------------
  const crecimientoMmin = previa && minutos > 0 ? Math.max(0, (perimetroTotalM - previa.perimetroTotalM) / minutos) : 0;
  const pendiente = Math.max(0, perimetroTotalM - controlado);
  const neto = ritmoMmin - crecimientoMmin;
  const estimadoControlMin = pendiente <= 0 ? 0 : neto > 0.01 ? Math.round(pendiente / neto) : undefined;

  const explicacion = explicar({
    fraccion,
    perimetroTotalM,
    ritmoMmin,
    unidadesTrabajando: conLinea,
    totalUnidades: trabajando.length,
    mediosAereos,
    estimadoControlMin,
    estabilizadoEn,
    controladoEn,
    lluvia24Mm,
  });

  return {
    contencion: {
      perimetroTotalM: +perimetroTotalM.toFixed(1),
      perimetroControladoM: +controlado.toFixed(1),
      fraccion,
      ritmoMmin,
      unidadesTrabajando: conLinea,
      mediosAereos,
      estimadoControlMin,
      estabilizadoEn,
      controladoEn,
      extinguidoEn: previa?.extinguidoEn,
      calculadoEn: ahora,
      vientoEstabilizadoKmh,
      rebrotes: rebrotes || undefined,
      lluvia24Mm,
      explicacion,
    },
    aportes,
    estabilizaAhora,
    rebroteAhora,
    motivoRebrote,
  };
}

function explicar(d: {
  fraccion: number;
  perimetroTotalM: number;
  ritmoMmin: number;
  unidadesTrabajando: number;
  totalUnidades: number;
  mediosAereos: boolean;
  estimadoControlMin?: number;
  estabilizadoEn?: string;
  controladoEn?: string;
  lluvia24Mm?: number;
}): string {
  const km = (d.perimetroTotalM / 1000).toFixed(2);
  const pct = Math.round(d.fraccion * 100);
  if (d.controladoEn) return `Controlado: ${km} km de perímetro cerrados; ${d.unidadesTrabajando} unidad(es) en liquidación y remate.`;
  if (d.estabilizadoEn) return `Estabilizado: el 100 % de ${km} km de perímetro está cogido por ${d.unidadesTrabajando} unidad(es); el perímetro ya no crece.`;
  if (d.totalUnidades === 0) return `Sin medios en el terreno: ${pct} % de ${km} km de perímetro controlado y el fuego sigue creciendo.`;
  if (d.ritmoMmin <= 0) return `${d.totalUnidades} unidad(es) en el foco, ninguna construye línea (seguridad, accesos o sanitario): ${pct} % de ${km} km controlado.`;
  const cola =
    d.estimadoControlMin === undefined
      ? "el perímetro crece más rápido que la línea: no se prevé control con los medios actuales"
      : d.estimadoControlMin <= 0
        ? "perímetro cerrado"
        : `control total estimado en ~${d.estimadoControlMin} min`;
  return (
    `${d.unidadesTrabajando} unidad(es) construyen línea a ${d.ritmoMmin.toFixed(1)} m/min: ${pct} % de ${km} km de perímetro controlado; ${cola}` +
    (d.mediosAereos ? ", con descargas aéreas sobre la cabeza" : "") +
    ((d.lluvia24Mm ?? 0) > LLUVIA_QUE_APAGA_MM ? `, y ${d.lluvia24Mm?.toFixed(1)} mm de lluvia en 24 h` : "") +
    "."
  );
}

// ---------------------------------------------------------------------
// Efecto de la extinción sobre la propagación
// ---------------------------------------------------------------------

export interface DetalleExtincion {
  /** Multiplicador total que se aplica a la velocidad del modelo elíptico. */
  factor: number;
  factorContencion: number;
  factorAereos: number;
  factorLluvia: number;
  /** true si los medios aéreos están en su ventana operativa y el viento lo permite. */
  aereosOperativos: boolean;
  explicacion: string;
}

/**
 * Multiplicador que la extinción impone al modelo de propagación:
 *   (1 − fraccion)^1,5 × Faéreos × Flluvia
 */
export function factorExtincion(incendio: Incendio, opciones: { ahoraMundo?: string; mediosAereos?: boolean; lluvia24Mm?: number } = {}): DetalleExtincion {
  const c = incendio.contencion;
  const ahora = opciones.ahoraMundo || incendio.actualizadoEn || new Date().toISOString();
  const fraccion = recortar(c?.fraccion ?? 0, 0, 1);
  const factorContencion = +Math.pow(1 - fraccion, 1.5).toFixed(4);

  const viento = vientoEfectivoKmh({ vientoKmh: incendio.meteo?.vientoKmh ?? 0, rachasKmh: incendio.meteo?.rachasKmh ?? 0 });
  const aereos = opciones.mediosAereos ?? c?.mediosAereos ?? false;
  const aereosOperativos = aereos && viento < VIENTO_MAXIMO_AEREOS_KMH && esVentanaAerea(ahora);
  // 0,50 con calma → 0,70 acercándose a 40 km/h (reducción del 50 % al 30 %).
  const factorAereos = aereosOperativos ? +recortar(0.5 + (0.2 * (viento - 20)) / 20, 0.5, 0.7).toFixed(3) : 1;

  const lluvia = opciones.lluvia24Mm ?? c?.lluvia24Mm ?? 0;
  const factorLluvia = lluvia > LLUVIA_QUE_APAGA_MM ? FACTOR_LLUVIA : 1;

  const factor = +(factorContencion * factorAereos * factorLluvia).toFixed(4);
  const partes: string[] = [];
  if (fraccion > 0) partes.push(`${Math.round(fraccion * 100)} % del perímetro controlado (×${factorContencion.toFixed(2)})`);
  if (aereos) partes.push(aereosOperativos ? `descargas aéreas (×${factorAereos.toFixed(2)})` : `medios aéreos sin efecto (${viento >= VIENTO_MAXIMO_AEREOS_KMH ? `viento ${viento.toFixed(0)} km/h` : "fuera de la ventana diurna"})`);
  if (factorLluvia < 1) partes.push(`${lluvia.toFixed(1)} mm de lluvia en 24 h (×${factorLluvia.toFixed(2)})`);

  return {
    factor,
    factorContencion,
    factorAereos,
    factorLluvia,
    aereosOperativos,
    explicacion: partes.length ? partes.join(", ") : "sin efecto de extinción todavía",
  };
}

/** Minutos de mundo transcurridos entre dos instantes ISO (0 si alguno falta). */
export function minutosEntre(desdeIso: string | undefined, hastaIso: string | undefined): number {
  if (!desdeIso || !hastaIso) return 0;
  const a = Date.parse(desdeIso);
  const b = Date.parse(hastaIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 60_000);
}

/** ¿Toca proponer ya el paso a "controlado"? */
export const tocaDeclararControlado = (incendio: Incendio, ahoraMundo: string): boolean =>
  incendio.estado === "estabilizado" &&
  !!incendio.contencion?.estabilizadoEn &&
  !incendio.contencion?.controladoEn &&
  minutosEntre(incendio.contencion.estabilizadoEn, ahoraMundo) >= MINUTOS_ESTABILIZADO_A_CONTROLADO;

/** ¿Toca proponer ya el paso a "extinguido" (liquidación terminada)? */
export const tocaDeclararExtinguido = (incendio: Incendio, ahoraMundo: string): boolean =>
  incendio.estado === "controlado" &&
  !!incendio.contencion?.controladoEn &&
  minutosEntre(incendio.contencion.controladoEn, ahoraMundo) >= MINUTOS_CONTROLADO_A_EXTINGUIDO;
