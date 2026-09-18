// Valida el dataset. Uso (desde la raíz del proyecto):
//   npx tsx lib/dataset/validar.ts
// o, sin tsx, con Node ≥ 22.18 y el resolvedor de imports sin extensión que se explica en README.md.
// Sale con código 1 si hay errores. Si existe data/dataset/ (ver exportar.ts), valida también esos JSON.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESCENARIOS, ETIQUETA_CANAL, ETIQUETA_TIPO, EVENTOS_SUELTOS, TODOS_LOS_EVENTOS } from "./index";
import { LUGARES } from "./lugares";
import type { Canal, EventoDataset, TipoEmergencia } from "./tipos";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const errores: string[] = [];
const avisos: string[] = [];
const err = (m: string) => errores.push(m);
const aviso = (m: string) => avisos.push(m);

const LIM = { latMin: 39.8, latMax: 41.2, lonMin: -4.6, lonMax: -3.0 };
const dentroDeMadrid = (lat: number, lon: number) => lat >= LIM.latMin && lat <= LIM.latMax && lon >= LIM.lonMin && lon <= LIM.lonMax;

// Coordenadas conocidas (todas geocodificadas): ningún evento puede usar otras.
const coordsConocidas = new Set(Object.values(LUGARES).map((l) => `${l.lat},${l.lon}`));

// 1. Ids únicos
const idsEscenario = new Set<string>();
for (const e of ESCENARIOS) {
  if (idsEscenario.has(e.id)) err(`Id de escenario repetido: ${e.id}`);
  idsEscenario.add(e.id);
}
const idsEvento = new Map<string, EventoDataset>();
for (const ev of TODOS_LOS_EVENTOS) {
  if (idsEvento.has(ev.id)) err(`Id de evento repetido: ${ev.id}`);
  idsEvento.set(ev.id, ev);
}

function validarEvento(ev: EventoDataset, grupo: EventoDataset[], duracion: number | undefined) {
  const p = `[${ev.id}]`;
  // Duplicados
  if (ev.veracidad === "duplicado") {
    if (!ev.duplicaDe) err(`${p} veracidad "duplicado" sin duplicaDe`);
  } else if (ev.duplicaDe) err(`${p} tiene duplicaDe pero veracidad "${ev.veracidad}"`);
  if (ev.duplicaDe) {
    const orig = grupo.find((g) => g.id === ev.duplicaDe);
    if (!orig) err(`${p} duplicaDe "${ev.duplicaDe}" no existe en el mismo escenario`);
    else if (orig.offsetSeg > ev.offsetSeg) err(`${p} duplica un evento posterior (${orig.id})`);
    else if (orig.id === ev.id) err(`${p} se duplica a sí mismo`);
  }
  // Bulos
  if (ev.veracidad === "bulo" && !ev.motivoBulo?.trim()) err(`${p} bulo sin motivoBulo`);
  if (ev.veracidad !== "bulo" && ev.motivoBulo) err(`${p} motivoBulo en un evento que no es bulo`);
  // Offsets
  if (duracion === undefined) {
    if (ev.offsetSeg !== 0) err(`${p} evento suelto con offsetSeg ${ev.offsetSeg} (debe ser 0)`);
  } else if (ev.offsetSeg < 0 || ev.offsetSeg > duracion) err(`${p} offsetSeg ${ev.offsetSeg} fuera de [0, ${duracion}]`);
  // Coordenadas
  const { lat, lon, precisionM } = ev.lugar;
  if (!dentroDeMadrid(lat, lon)) err(`${p} coordenadas fuera de la Comunidad de Madrid: ${lat}, ${lon}`);
  if (!coordsConocidas.has(`${lat},${lon}`)) err(`${p} coordenadas que no salen de lugares.ts (¿inventadas?): ${lat}, ${lon}`);
  if (precisionM < 10 || precisionM > 500) aviso(`${p} precisionM ${precisionM} fuera del rango habitual 10-500`);
  if (!ev.lugar.nombre.trim()) err(`${p} lugar sin nombre`);
  // Canal y sensor
  if (ev.canal === "sensor" && !ev.sensor) err(`${p} canal sensor sin campo sensor`);
  if (ev.tipoObservacion === "sensor" && ev.canal !== "sensor") err(`${p} tipoObservacion sensor en canal ${ev.canal}`);
  if (ev.tipoObservacion === "imagen" && !ev.imagen) err(`${p} tipoObservacion imagen sin imagen`);
  // Imágenes
  if (ev.imagen) {
    const ruta = join(RAIZ, "public", ev.imagen.archivo);
    if (!ev.imagen.archivo.startsWith("/dataset/img/")) err(`${p} imagen fuera de /dataset/img/: ${ev.imagen.archivo}`);
    if (!existsSync(ruta)) err(`${p} la imagen no existe: public${ev.imagen.archivo}`);
    if (!ev.imagen.licencia || !ev.imagen.autor || !ev.imagen.urlOrigen) err(`${p} imagen sin licencia, autor o urlOrigen`);
  }
  // Textos. El título viaja en la observación: no puede delatar la respuesta al pipeline.
  if (!ev.titulo.trim() || !ev.texto.trim()) err(`${p} sin título o texto`);
  if (/(?<!\p{L})(bulos?|rumor|ruido|duplicad[oa]s?)(?!\p{L})/iu.test(ev.titulo)) err(`${p} el título delata la veracidad: «${ev.titulo}»`);
  if (ev.etiquetas.length === 0) aviso(`${p} sin etiquetas`);
  if (ev.veracidad === "ruido" && ev.gravedadEsperada !== "nula") aviso(`${p} ruido con gravedadEsperada ${ev.gravedadEsperada}`);
}

// 2. Escenarios
if (ESCENARIOS.length < 14) err(`Solo hay ${ESCENARIOS.length} escenarios (mínimo 14)`);
if (!ESCENARIOS.some((e) => e.id === "incendio-industrial-mendez-alvaro")) err(`Falta el escenario principal incendio-industrial-mendez-alvaro`);
let escenariosConBulo = 0;
for (const esc of ESCENARIOS) {
  const p = `[${esc.id}]`;
  const n = esc.eventos.length;
  if (n < 8 || n > 16) err(`${p} tiene ${n} eventos (se piden 8-16)`);
  if (esc.duracionSeg < 300 || esc.duracionSeg > 900) err(`${p} duracionSeg ${esc.duracionSeg} fuera de 300-900`);
  if (!dentroDeMadrid(esc.zona.lat, esc.zona.lon)) err(`${p} zona fuera de la Comunidad de Madrid`);
  if (!esc.objetivoDemo.trim()) err(`${p} sin objetivoDemo`);
  if (esc.eventos[0]?.offsetSeg !== 0) aviso(`${p} el primer evento no empieza en 0 s`);
  for (let i = 1; i < n; i++) {
    if (esc.eventos[i].offsetSeg < esc.eventos[i - 1].offsetSeg) err(`${p} offsets desordenados en ${esc.eventos[i].id}`);
  }
  for (const ev of esc.eventos) {
    if (ev.escenarioId !== esc.id) err(`[${ev.id}] escenarioId "${ev.escenarioId}" distinto de ${esc.id}`);
    validarEvento(ev, esc.eventos, esc.duracionSeg);
  }
  if (!esc.eventos.some((ev) => ev.veracidad === "duplicado")) err(`${p} no tiene ningún duplicado`);
  if (esc.eventos.some((ev) => ev.veracidad === "bulo")) escenariosConBulo++;
}
if (escenariosConBulo < 8) err(`Solo ${escenariosConBulo} escenarios tienen bulo (mínimo 8)`);

// 3. Sueltos
if (EVENTOS_SUELTOS.length < 25 || EVENTOS_SUELTOS.length > 40) err(`Hay ${EVENTOS_SUELTOS.length} eventos sueltos (se piden 25-40)`);
for (const ev of EVENTOS_SUELTOS) {
  if (ev.escenarioId !== undefined) err(`[${ev.id}] evento suelto con escenarioId`);
  validarEvento(ev, EVENTOS_SUELTOS, undefined);
}
const canalesSueltos = new Set(EVENTOS_SUELTOS.map((e) => e.canal));
for (const c of Object.keys(ETIQUETA_CANAL) as Canal[]) if (!canalesSueltos.has(c)) aviso(`Ningún evento suelto usa el canal ${c}`);

// 4. Cobertura de tipos y cifras globales
const porTipo = new Map<TipoEmergencia, number>();
const porCanal = new Map<Canal, number>();
const porVeracidad = new Map<string, number>();
for (const ev of TODOS_LOS_EVENTOS) {
  porTipo.set(ev.tipoEmergencia, (porTipo.get(ev.tipoEmergencia) ?? 0) + 1);
  porCanal.set(ev.canal, (porCanal.get(ev.canal) ?? 0) + 1);
  porVeracidad.set(ev.veracidad, (porVeracidad.get(ev.veracidad) ?? 0) + 1);
}
for (const t of Object.keys(ETIQUETA_TIPO) as TipoEmergencia[]) if (!porTipo.has(t)) err(`Ningún evento cubre el tipo ${t}`);
const bulos = porVeracidad.get("bulo") ?? 0;
if (bulos < 8) err(`Solo hay ${bulos} bulos (mínimo 8)`);

// 5. Imágenes huérfanas o sin créditos
const dirImg = join(RAIZ, "public", "dataset", "img");
const usadas = new Set(TODOS_LOS_EVENTOS.flatMap((e) => (e.imagen ? [e.imagen.archivo.split("/").pop()!] : [])));
const creditos = existsSync(join(dirImg, "CREDITOS.md")) ? readFileSync(join(dirImg, "CREDITOS.md"), "utf8") : "";
if (!creditos) err("Falta public/dataset/img/CREDITOS.md");
for (const f of existsSync(dirImg) ? readdirSync(dirImg) : []) {
  if (!/\.jpe?g$/i.test(f)) continue;
  if (!usadas.has(f)) aviso(`Imagen sin usar: ${f}`);
  if (!creditos.includes(f)) err(`La imagen ${f} no está en CREDITOS.md`);
}

// 6. JSON exportados (data/dataset/*.json), si existen
const dirJson = join(RAIZ, "data", "dataset");
let jsonRevisados = 0;
if (existsSync(dirJson)) {
  for (const f of readdirSync(dirJson).filter((x) => x.endsWith(".json"))) {
    try {
      const j = JSON.parse(readFileSync(join(dirJson, f), "utf8")) as { id?: string; eventos?: { id: string; observacion?: { imagenUrl?: string } }[] };
      jsonRevisados++;
      if (!j.id || !Array.isArray(j.eventos)) err(`data/dataset/${f}: sin id o sin eventos`);
      for (const ev of j.eventos ?? []) {
        const url = ev.observacion?.imagenUrl;
        if (url && !existsSync(join(RAIZ, "public", url))) err(`data/dataset/${f} [${ev.id}]: imagenUrl no existe en public/: ${url}`);
      }
    } catch (e) {
      err(`data/dataset/${f}: JSON inválido (${(e as Error).message})`);
    }
  }
}

// Informe
const fila = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(" · ");
console.log(`Escenarios: ${ESCENARIOS.length} · eventos de escenario: ${TODOS_LOS_EVENTOS.length - EVENTOS_SUELTOS.length} · sueltos: ${EVENTOS_SUELTOS.length} · total: ${TODOS_LOS_EVENTOS.length}`);
console.log(`Veracidad → ${fila(porVeracidad)} · escenarios con bulo: ${escenariosConBulo}`);
console.log(`Tipos → ${fila(porTipo as Map<string, number>)}`);
console.log(`Canales → ${fila(porCanal as Map<string, number>)}`);
console.log(`Imágenes usadas: ${usadas.size} · lugares geocodificados: ${Object.keys(LUGARES).length}${jsonRevisados ? ` · JSON exportados revisados: ${jsonRevisados}` : ""}`);
for (const a of avisos) console.log(`AVISO ${a}`);
if (errores.length) {
  for (const e of errores) console.error(`ERROR ${e}`);
  console.error(`\n✗ ${errores.length} errores`);
  process.exit(1);
}
console.log(`\n✓ Dataset válido (${avisos.length} avisos)`);
