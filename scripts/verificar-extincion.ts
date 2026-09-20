// =====================================================================
// ATALAYA INCENDIOS · Verificación del modelo de extinción y de fusión
// ---------------------------------------------------------------------
// DUEÑO: constructor K. Ejecutar con:
//     npx tsx scripts/verificar-extincion.ts
// No toca la red ni el estado vivo: simula minutos de mundo llamando a las
// mismas funciones puras que usa el agente `propagacion`.
// =====================================================================
import type { Combustible, Incendio, Unidad } from "../lib/dominio/tipos";
import { perimetroInicial } from "../lib/simulacion/propagacion";
import { propagar } from "../lib/simulacion/propagacion";
import { calcularContencion, factorExtincion } from "../lib/simulacion/contencion";
import { planificarFusiones, unirPerimetros } from "../lib/simulacion/fusion";
import { areaHa as areaDePoligono, perimetroM } from "../lib/simulacion/geometria";

const CENTRO = { lat: 40.4, lon: -4.9 }; // sierra de Ávila
const INICIO = "2026-09-19T11:00:00.000Z"; // 13:00 en Madrid: ventana aérea abierta

const combustible = (dominante: Combustible["dominante"]): Combustible => ({
  bosque: dominante === "bosque" ? 0.8 : 0.1,
  matorral: dominante === "matorral" ? 0.8 : 0.1,
  pasto: dominante === "pasto" ? 0.8 : 0.05,
  agricola: 0.02,
  urbano: 0.03,
  dominante,
});

/** Perímetro circular de la superficie pedida (ha). */
function perimetroDeArea(centro: { lat: number; lon: number }, ha: number) {
  const radioM = Math.sqrt((ha * 10_000) / Math.PI);
  return perimetroInicial(centro, radioM);
}

function foco(opciones: {
  id?: string;
  centro?: { lat: number; lon: number };
  areaHa?: number;
  dominante?: Combustible["dominante"];
  vientoKmh: number;
  direccionGrados?: number;
}): Incendio {
  const centro = opciones.centro ?? CENTRO;
  const perimetro = perimetroDeArea(centro, opciones.areaHa ?? 2);
  const viento = opciones.vientoKmh;
  return {
    id: opciones.id ?? "inc-prueba",
    nombre: opciones.id ? `Foco ${opciones.id}` : "Incendio de prueba",
    centro,
    municipio: "Navalacruz",
    provincia: "Ávila",
    comunidad: "Castilla y León",
    estado: "activo",
    nivelGravedad: 1,
    origen: "manual",
    confianza: 0.9,
    detectadoEn: INICIO,
    actualizadoEn: INICIO,
    perimetro,
    areaHa: +areaDePoligono(perimetro).toFixed(2),
    observaciones: [],
    radioOperativoKm: 30,
    combustible: combustible(opciones.dominante ?? "matorral"),
    pendientePct: 8,
    meteo: {
      temperaturaC: 30,
      humedadPct: 35,
      vientoKmh: viento,
      direccionGrados: opciones.direccionGrados ?? 225,
      direccionTexto: "SO",
      rachasKmh: +(viento * 1.3).toFixed(1),
      precipitacionMm: 0,
      horaMundo: INICIO,
      fuente: "Open-Meteo (simulado en el script)",
      url: "https://open-meteo.com",
    },
  };
}

function autobomba(n: number, incendioId: string): Unidad {
  return {
    id: `uni-bul-${n}`,
    nombre: `Parque de Bomberos de Ávila · BUL-${n}`,
    tipo: "bomberos",
    base: { nombre: "Parque de Ávila", punto: { lat: 40.65, lon: -4.7 } },
    posicion: CENTRO,
    estado: "disponible",
    incendioId,
    velocidadKmh: 70,
    dotacion: { personas: 5, vehiculos: 1 },
    fuente: "OSM",
  };
}

const sumarMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

interface Resultado {
  estabilizadoEnMin?: number;
  areaFinalHa: number;
  fraccionFinal: number;
  traza: string[];
}

/** Simula `horas` de mundo con paso de 1 min. Las unidades llegan en `llegadaMin`. */
function simular(opciones: { vientoKmh: number; unidades: number; horas: number; llegadaMin: number; lluvia24Mm?: number; mediosAereos?: boolean }): Resultado {
  let incendio = foco({ vientoKmh: opciones.vientoKmh });
  const unidades = Array.from({ length: opciones.unidades }, (_, i) => autobomba(i + 1, incendio.id));
  const traza: string[] = [];
  let estabilizadoEnMin: number | undefined;
  const paso = 1;

  for (let t = paso; t <= opciones.horas * 60; t += paso) {
    const ahora = sumarMin(INICIO, t);
    // Las unidades llegan al foco y empiezan a trabajar.
    for (const u of unidades) if (t >= opciones.llegadaMin) u.estado = "en_intervencion";

    const f = factorExtincion(incendio, { ahoraMundo: ahora, mediosAereos: opciones.mediosAereos, lluvia24Mm: opciones.lluvia24Mm });
    const avance = propagar({ ...incendio, actualizadoEn: ahora }, paso, f.factor);
    incendio = { ...incendio, ...avance, actualizadoEn: ahora };

    const r = calcularContencion(incendio, unidades, paso, { ahoraMundo: ahora, mediosAereos: opciones.mediosAereos, lluvia24Mm: opciones.lluvia24Mm });
    incendio = { ...incendio, contencion: r.contencion };
    if (r.estabilizaAhora) {
      estabilizadoEnMin = t;
      incendio = { ...incendio, estado: "estabilizado" };
    }
    if (t % 30 === 0 || r.estabilizaAhora) {
      traza.push(
        `  t+${String(t).padStart(3)} min · ${incendio.areaHa.toFixed(1).padStart(6)} ha · perímetro ${(r.contencion.perimetroTotalM / 1000).toFixed(2)} km · ` +
          `línea ${(r.contencion.perimetroControladoM / 1000).toFixed(2)} km (${String(Math.round(r.contencion.fraccion * 100)).padStart(3)} %) · ` +
          `ritmo ${r.contencion.ritmoMmin.toFixed(1)} m/min · cabeza ${(incendio.frente?.velocidadMmin ?? 0).toFixed(2)} m/min` +
          (r.estabilizaAhora ? "  ← ESTABILIZADO" : ""),
      );
    }
  }
  return { estabilizadoEnMin, areaFinalHa: incendio.areaHa, fraccionFinal: incendio.contencion?.fraccion ?? 0, traza };
}

// ---------------------------------------------------------------------
let fallos = 0;
const comprobar = (nombre: string, ok: boolean, detalle: string) => {
  console.log(`${ok ? "✔" : "✘"} ${nombre}: ${detalle}`);
  if (!ok) fallos += 1;
};

console.log("\n=== ESCENARIO 1 · 2 ha de matorral, 2 autobombas a los 30 min, viento 15 km/h ===");
const a = simular({ vientoKmh: 15, unidades: 2, horas: 3, llegadaMin: 30 });
console.log(a.traza.join("\n"));
comprobar(
  "Se estabiliza en un tiempo plausible (1-3 h de mundo)",
  a.estabilizadoEnMin !== undefined && a.estabilizadoEnMin >= 60 && a.estabilizadoEnMin <= 180,
  a.estabilizadoEnMin !== undefined ? `estabilizado a los ${a.estabilizadoEnMin} min de mundo, ${a.areaFinalHa.toFixed(0)} ha` : `NO se estabiliza en 3 h (${Math.round(a.fraccionFinal * 100)} %)`,
);

console.log("\n=== ESCENARIO 2 · lo mismo con viento de 50 km/h ===");
const b = simular({ vientoKmh: 50, unidades: 2, horas: 3, llegadaMin: 30 });
console.log(b.traza.join("\n"));
comprobar(
  "Con 50 km/h NO se estabiliza",
  b.estabilizadoEnMin === undefined,
  b.estabilizadoEnMin === undefined ? `${Math.round(b.fraccionFinal * 100)} % de perímetro controlado tras 3 h, ${b.areaFinalHa.toFixed(0)} ha` : `se estabilizó a los ${b.estabilizadoEnMin} min (NO debería)`,
);

console.log("\n=== ESCENARIO 3 · sin medios el fuego sigue creciendo ===");
const c = simular({ vientoKmh: 15, unidades: 0, horas: 3, llegadaMin: 0 });
comprobar("Sin medios no se estabiliza y crece", c.estabilizadoEnMin === undefined && c.areaFinalHa > a.areaFinalHa, `${c.areaFinalHa.toFixed(0)} ha frente a ${a.areaFinalHa.toFixed(0)} ha con 2 autobombas`);

console.log("\n=== ESCENARIO 4 · lluvia real > 5 mm en 24 h ===");
const d = simular({ vientoKmh: 15, unidades: 0, horas: 3, llegadaMin: 0, lluvia24Mm: 12 });
comprobar("Con 12 mm de lluvia el fuego apenas avanza", d.areaFinalHa < c.areaFinalHa * 0.35, `${d.areaFinalHa.toFixed(0)} ha con lluvia frente a ${c.areaFinalHa.toFixed(0)} ha sin lluvia`);

console.log("\n=== ESCENARIO 5 · medios aéreos sobre la cabeza ===");
const e = simular({ vientoKmh: 15, unidades: 2, horas: 3, llegadaMin: 30, mediosAereos: true });
comprobar(
  "Con medios aéreos se estabiliza antes",
  e.estabilizadoEnMin !== undefined && a.estabilizadoEnMin !== undefined && e.estabilizadoEnMin < a.estabilizadoEnMin,
  `${e.estabilizadoEnMin} min con aéreos frente a ${a.estabilizadoEnMin} min sin ellos`,
);

console.log("\n=== ESCENARIO 6 · fusión de dos focos en pasto con viento 40 km/h ===");
let f1 = foco({ id: "inc-A", centro: CENTRO, areaHa: 2, dominante: "pasto", vientoKmh: 40, direccionGrados: 270 });
// A 1 km al este de A: el frente va hacia el E (viento del O).
let f2 = foco({ id: "inc-B", centro: { lat: CENTRO.lat, lon: CENTRO.lon + 0.0118 }, areaHa: 2, dominante: "pasto", vientoKmh: 40, direccionGrados: 270 });
f2 = { ...f2, detectadoEn: sumarMin(INICIO, 20) };
let fusionEnMin: number | undefined;
let areaFusionada = 0;
for (let t = 1; t <= 180; t++) {
  const ahora = sumarMin(INICIO, t);
  f1 = { ...f1, ...propagar({ ...f1, actualizadoEn: ahora }, 1), actualizadoEn: ahora };
  f2 = { ...f2, ...propagar({ ...f2, actualizadoEn: ahora }, 1), actualizadoEn: ahora };
  const planes = planificarFusiones([f1, f2]);
  if (planes.length) {
    fusionEnMin = t;
    const p = planes[0];
    areaFusionada = p.areaHa;
    console.log(`  Fusión a los ${t} min: sobrevive ${p.superviviente.id} (detectado ${p.superviviente.detectadoEn.slice(11, 16)}), absorbe ${p.absorbido.id}`);
    console.log(`  Borde a borde ${p.distanciaBordeM.toFixed(0)} m · área unida ${p.areaHa.toFixed(1)} ha (antes ${f1.areaHa.toFixed(1)} + ${f2.areaHa.toFixed(1)} ha) · perímetro ${(perimetroM(p.perimetro) / 1000).toFixed(2)} km`);
    break;
  }
}
comprobar("Dos focos a 1 km se fusionan al crecer", fusionEnMin !== undefined, fusionEnMin !== undefined ? `a los ${fusionEnMin} min de mundo, ${areaFusionada.toFixed(0)} ha` : "no se fusionaron en 3 h");
comprobar(
  "El foco unido es mayor que cualquiera de los dos",
  areaFusionada > Math.max(f1.areaHa, f2.areaHa),
  `${areaFusionada.toFixed(1)} ha > max(${f1.areaHa.toFixed(1)}, ${f2.areaHa.toFixed(1)})`,
);

const union = unirPerimetros(f1, f2);
comprobar("La unión conserva geometría válida", union.perimetro.length >= 3 && union.areaHa > 0, `${union.perimetro.length} vértices, ${union.areaHa.toFixed(1)} ha`);


// ---------------------------------------------------------------------
// ESCENARIO 7 · el CICLO REAL del agente `propagacion` sobre un Estado vivo
// ---------------------------------------------------------------------
async function cicloReal(): Promise<void> {
  const { Estado, establecerEstado } = await import("../lib/motor/estado");
  const { analistaPropagacion } = await import("../lib/agentes/analisis/propagacion");

  const estado = new Estado();
  establecerEstado(estado);
  const incendio = foco({ id: "inc-ciclo", vientoKmh: 15 });
  estado.guardar(estado.incendios, { ...incendio, estado: "confirmado" });
  for (const u of [autobomba(1, incendio.id), autobomba(2, incendio.id)]) estado.guardar(estado.unidades, { ...u, estado: "en_intervencion" });

  let reloj = INICIO;
  const paso = 5;
  const eventos: string[] = [];
  const decisionesVistas: string[] = [];

  const correr = async (minutos: number) => {
    reloj = sumarMin(reloj, minutos);
    estado.reloj.ahoraMundo = reloj;
    const ctx = {
      estado,
      snapshot: estado.snapshot(),
      ahoraMundo: reloj,
      minutosMundoDesdeUltimoCiclo: minutos,
      registrar: (tipo: string, mensaje: string) => { if (tipo === "incendio_actualizado") eventos.push(`${reloj.slice(11, 16)} ${mensaje}`); },
      informarTarea: () => {},
      lecciones: [],
      abortSignal: new AbortController().signal,
    } as unknown as Parameters<typeof analistaPropagacion.ciclo>[0];
    const r = await analistaPropagacion.ciclo(ctx);
    for (const d of (r && "decisiones" in r ? (r.decisiones ?? []) : [])) {
      estado.guardar(estado.decisiones, d);
      decisionesVistas.push(`${d.titulo} [${d.competencia}/${d.estado}]`);
    }
  };

  // 3 h de mundo en pasos de 5 min: debe estabilizarse.
  for (let t = 0; t < 36 && !estado.incendios.get(incendio.id)?.contencion?.estabilizadoEn; t++) await correr(paso);
  const tras3h = estado.incendios.get(incendio.id)!;
  comprobar("El agente rellena `incendio.contencion`", !!tras3h.contencion, tras3h.contencion?.explicacion ?? "sin contención");
  comprobar("El foco pasa de confirmado a activo y luego a estabilizado", tras3h.estado === "estabilizado", `estado = ${tras3h.estado}, ${tras3h.areaHa.toFixed(0)} ha`);
  comprobar("Hay evento de estabilización en el hilo", eventos.some((e) => e.includes("Estabilizado")), eventos.filter((e) => e.includes("Estabilizado") || e.includes("ACTIVO")).join(" | ") || "ninguno");

  // +60 min estabilizado → decisión "declarar controlado", que por política es HUMANA.
  for (let t = 0; t < 14 && !decisionesVistas.length; t++) await correr(paso);
  comprobar("Propone declarar CONTROLADO y la firma una persona", decisionesVistas.some((d) => d.includes("CONTROLADO") && d.includes("humano")), decisionesVistas.join(" · ") || "ninguna");

  // Se ejecuta la decisión: el foco pasa a controlado (liquidación, los medios se quedan).
  const c = estado.incendios.get(incendio.id)!.contencion!;
  estado.actualizar(estado.incendios, incendio.id, { estado: "controlado", contencion: { ...c, controladoEn: reloj } });
  decisionesVistas.length = 0;
  for (let t = 0; t < 30 && !decisionesVistas.length; t++) await correr(paso);
  comprobar("Tras la liquidación propone declarar EXTINGUIDO", decisionesVistas.some((d) => d.includes("EXTINGUIDO")), decisionesVistas.join(" · ") || "ninguna");

  // Rebrote: el viento se dobla sobre un foco ya estabilizado.
  const estado2 = new Estado();
  establecerEstado(estado2);
  const f = foco({ id: "inc-rebrote", vientoKmh: 15 });
  estado2.guardar(estado2.incendios, {
    ...f,
    estado: "estabilizado",
    contencion: { perimetroTotalM: 2000, perimetroControladoM: 2000, fraccion: 1, ritmoMmin: 20, unidadesTrabajando: 2, mediosAereos: false, calculadoEn: INICIO, estabilizadoEn: INICIO, vientoEstabilizadoKmh: 19.5 },
  });
  estado2.guardar(estado2.unidades, { ...autobomba(1, f.id), estado: "en_intervencion" });
  estado2.actualizar(estado2.incendios, f.id, { meteo: { ...f.meteo!, vientoKmh: 55, rachasKmh: 70 } });
  const critico: string[] = [];
  const ahora2 = sumarMin(INICIO, 5);
  estado2.reloj.ahoraMundo = ahora2;
  await analistaPropagacion.ciclo({
    estado: estado2, snapshot: estado2.snapshot(), ahoraMundo: ahora2, minutosMundoDesdeUltimoCiclo: 5,
    registrar: (_t: string, m: string) => critico.push(m), informarTarea: () => {}, lecciones: [], abortSignal: new AbortController().signal,
  } as unknown as Parameters<typeof analistaPropagacion.ciclo>[0]);
  const tras = estado2.incendios.get(f.id)!;
  comprobar("Rebrote al subir el viento > 20 km/h", tras.estado === "activo" && (tras.contencion?.rebrotes ?? 0) === 1, critico.find((m) => m.includes("REBROTE"))?.slice(0, 120) ?? `estado ${tras.estado}`);
}

console.log("\n=== ESCENARIO 7 · ciclo real del agente `propagacion` ===");
cicloReal()
  .catch((e) => {
    console.error("✘ El ciclo del agente ha fallado:", e);
    fallos += 1;
  })
  .finally(() => {
    console.log(`\n${fallos === 0 ? "TODO CORRECTO" : `${fallos} COMPROBACIÓN(ES) FALLIDA(S)`}\n`);
    process.exit(fallos === 0 ? 0 : 1);
  });
