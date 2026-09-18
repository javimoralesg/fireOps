// Exporta el dataset a JSON para el reproductor del backend, que lee JSON y no TS:
//   data/dataset/<escenarioId>.json  (uno por escenario)
//   data/dataset/sueltos.json        (eventos sueltos)
// Uso (desde la raíz del proyecto): npx tsx lib/dataset/exportar.ts
// La observación va SIN timestamp: lo pone el reproductor al inyectarla.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESCENARIOS, EVENTOS_SUELTOS } from "./index";
import type { Canal, EventoDataset } from "./tipos";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const DESTINO = join(RAIZ, "data", "dataset");

/** Canal en el formato del reproductor (más corto en app y cámara). */
export type CanalJson = "llamada_112" | "app" | "red_social" | "camara" | "sensor" | "aviso_oficial" | "efectivo";
const CANAL_JSON: Record<Canal, CanalJson> = {
  llamada_112: "llamada_112",
  app_ciudadana: "app",
  red_social: "red_social",
  camara_trafico: "camara",
  sensor: "sensor",
  aviso_oficial: "aviso_oficial",
  efectivo: "efectivo",
};

export function eventoAJson(ev: EventoDataset) {
  const canal = CANAL_JSON[ev.canal];
  return {
    id: ev.id,
    offsetSeg: ev.offsetSeg,
    canal,
    titulo: ev.titulo,
    fuente: ev.fuente,
    lugar: { nombre: ev.lugar.nombre, ...(ev.lugar.direccion ? { direccion: ev.lugar.direccion } : {}), ...(ev.lugar.osmId ? { osmId: ev.lugar.osmId } : {}) },
    observacion: {
      perifericoId: "simulador",
      tipo: ev.tipoObservacion,
      posicion: { lat: ev.lugar.lat, lon: ev.lugar.lon, precisionM: ev.lugar.precisionM },
      ubicacion: ev.lugar.nombre, // nombre legible del lugar (el pipeline lo usa si no hace geocodificación inversa)
      texto: `${ev.titulo}\n${ev.texto}`,
      ...(ev.autor ? { autor: ev.autor } : {}),
      ...(ev.sensor ? { sensor: ev.sensor } : {}),
      ...(ev.imagen ? { imagenUrl: ev.imagen.archivo } : {}),
      tipoEmergencia: ev.tipoEmergencia,
      simulacro: true as const,
      datasetId: ev.id,
      canal,
    },
    ...(ev.veracidad === "ruido" ? { ruido: true as const } : {}),
    ...(ev.duplicaDe ? { duplicaDe: ev.duplicaDe } : {}),
    ...(ev.veracidad === "bulo" ? { bulo: { motivo: ev.motivoBulo ?? "" } } : {}),
    esperado: {
      categoria: ev.categoria,
      gravedad: ev.gravedadEsperada,
      ...(ev.decisionEsperada ? { foco: ev.decisionEsperada } : {}),
    },
  };
}

function escribir(nombre: string, datos: unknown) {
  const ruta = join(DESTINO, nombre);
  writeFileSync(ruta, JSON.stringify(datos, null, 2) + "\n", "utf8");
  return ruta;
}

mkdirSync(DESTINO, { recursive: true });
const escritos: string[] = [];
for (const esc of ESCENARIOS) {
  escritos.push(
    escribir(`${esc.id}.json`, {
      id: esc.id,
      nombre: esc.titulo,
      tipo: esc.tipoEmergencia,
      descripcion: esc.descripcion,
      objetivoDemo: esc.objetivoDemo,
      centro: { lat: esc.zona.lat, lon: esc.zona.lon, nombre: esc.zona.nombre },
      duracionSeg: esc.duracionSeg,
      eventos: esc.eventos.map(eventoAJson),
    }),
  );
}
escritos.push(escribir("sueltos.json", { id: "sueltos", nombre: "Eventos sueltos", eventos: EVENTOS_SUELTOS.map(eventoAJson) }));

// Comprobación: todo parsea y cada imagenUrl existe en public/
let fallos = 0;
let eventos = 0;
for (const ruta of escritos) {
  const j = JSON.parse(readFileSync(ruta, "utf8")) as { eventos: ReturnType<typeof eventoAJson>[] };
  for (const ev of j.eventos) {
    eventos++;
    const url = "imagenUrl" in ev.observacion ? ev.observacion.imagenUrl : undefined;
    if (url && !existsSync(join(RAIZ, "public", url))) {
      fallos++;
      console.error(`ERROR ${ev.id}: no existe public${url}`);
    }
  }
}
console.log(`${escritos.length} archivos JSON en data/dataset/ (${eventos} eventos)`);
if (fallos) process.exit(1);
