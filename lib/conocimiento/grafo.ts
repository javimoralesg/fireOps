// =====================================================================
// ATALAYA INCENDIOS · Grafo de conocimiento para la pantalla
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Convierte el índice (documentos + fragmentos + entidades + relaciones) en
// el `GrafoConocimiento` que dibuja /conocimiento. Se limita a ~400 nodos
// porque más no se lee: un grafo ilegible no informa a nadie.
//
// Tipos de arista:
//   contiene   documento → fragmento
//   sigue      fragmento → fragmento contiguo del mismo documento
//   referencia fragmento → fragmento citado ("véase el artículo 46")
//   menciona   fragmento → entidad
// =====================================================================

import type { AristaGrafo, GrafoConocimiento, NodoGrafo } from "../dominio/tipos";
import { listarChunks, listarDocumentos } from "./almacen";

const MAX_NODOS = Number(process.env.CONOCIMIENTO_MAX_NODOS ?? 400);

/**
 * Grafo completo o el de un documento concreto.
 * Sin `documentoId` se muestran los documentos, sus entidades más repetidas y
 * una muestra de fragmentos; con `documentoId` se ve el documento entero.
 */
export async function obtenerGrafo(documentoId?: string): Promise<GrafoConocimiento> {
  const documentos = await listarDocumentos();
  const chunks = await listarChunks(documentoId);
  const nodos: NodoGrafo[] = [];
  const aristas: AristaGrafo[] = [];
  const vistos = new Set<string>();

  const anadirNodo = (n: NodoGrafo): boolean => {
    if (vistos.has(n.id)) return true;
    if (nodos.length >= MAX_NODOS) return false;
    vistos.add(n.id);
    nodos.push(n);
    return true;
  };

  const docsVisibles = documentoId ? documentos.filter((d) => d.id === documentoId) : documentos;
  for (const d of docsVisibles) {
    anadirNodo({ id: d.id, tipo: "documento", etiqueta: d.titulo, documentoId: d.id });
  }

  // Presupuesto de fragmentos: si hay muchos documentos se reparte entre todos
  // para que ninguno acapare el grafo.
  const presupuesto = Math.max(0, MAX_NODOS - nodos.length - 40);
  const porDocumento = new Map<string, typeof chunks>();
  for (const c of chunks) {
    const lista = porDocumento.get(c.documentoId) ?? [];
    lista.push(c);
    porDocumento.set(c.documentoId, lista);
  }
  const cupo = Math.max(4, Math.floor(presupuesto / Math.max(1, porDocumento.size)));

  const incluidos = new Set<string>();
  for (const [docId, lista] of porDocumento) {
    const paso = Math.max(1, Math.ceil(lista.length / cupo));
    for (let i = 0; i < lista.length; i += paso) {
      const c = lista[i];
      const etiqueta = c.seccion?.slice(0, 48) || `Fragmento ${c.indice + 1}`;
      if (!anadirNodo({ id: c.id, tipo: "chunk", etiqueta, documentoId: docId })) break;
      incluidos.add(c.id);
      aristas.push({ origen: docId, destino: c.id, tipo: "contiene" });
    }
  }

  // Aristas entre fragmentos incluidos.
  const porId = new Map(chunks.map((c) => [c.id, c]));
  for (const id of incluidos) {
    const c = porId.get(id);
    if (!c) continue;
    for (const rel of c.relacionados) {
      if (!incluidos.has(rel)) continue;
      const otro = porId.get(rel);
      if (!otro) continue;
      const contiguo = otro.documentoId === c.documentoId && Math.abs(otro.indice - c.indice) === 1;
      if (contiguo && otro.indice < c.indice) continue; // "sigue" se dibuja una vez
      aristas.push({ origen: c.id, destino: rel, tipo: contiguo ? "sigue" : "referencia" });
    }
  }

  // Entidades: las más repetidas, para que el grafo cuente algo.
  const frecuencia = new Map<string, number>();
  for (const c of chunks) for (const e of c.entidades) frecuencia.set(e, (frecuencia.get(e) ?? 0) + 1);
  const destacadas = [...frecuencia.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([e]) => e);

  for (const entidad of destacadas) {
    const idEntidad = `ent:${entidad}`;
    if (!anadirNodo({ id: idEntidad, tipo: "entidad", etiqueta: entidad })) break;
    for (const id of incluidos) {
      const c = porId.get(id);
      if (c?.entidades.includes(entidad)) aristas.push({ origen: c.id, destino: idEntidad, tipo: "menciona" });
    }
  }

  return { nodos, aristas };
}

// =====================================================================
// AÑADIDO (constructor I) · Fragmentos obligatorios en el grafo
// ---------------------------------------------------------------------
// `obtenerGrafo` muestrea los fragmentos cuando hay más de los que caben
// (682 fragmentos no se leen en una pantalla). Pero el visor tiene un modo
// "consulta": resalta con un número de orden los fragmentos que la IA miró
// para responder. Si justo esos se han quedado fuera del muestreo, el jurado
// ve el grafo sin lo importante. Esta función los vuelve a meter con sus
// relaciones, sin tocar el resto del grafo ni la función original.
// =====================================================================

/**
 * Devuelve el mismo grafo garantizando que los fragmentos indicados están
 * dentro, con su arista `contiene` al documento, las relaciones con los
 * fragmentos ya presentes y las menciones a las entidades ya dibujadas.
 */
export async function ampliarGrafoConFragmentos(
  grafo: GrafoConocimiento,
  idsChunk: string[],
): Promise<GrafoConocimiento> {
  const faltan = idsChunk.filter((id) => id && !grafo.nodos.some((n) => n.id === id));
  if (!faltan.length) return grafo;

  const chunks = await listarChunks();
  const porId = new Map(chunks.map((c) => [c.id, c]));
  const documentos = await listarDocumentos();
  const tituloDocumento = new Map(documentos.map((d) => [d.id, d.titulo]));

  const nodos: NodoGrafo[] = [...grafo.nodos];
  const aristas: AristaGrafo[] = [...grafo.aristas];
  const presentes = new Set(nodos.map((n) => n.id));
  const entidadesDibujadas = new Set(nodos.filter((n) => n.tipo === "entidad").map((n) => n.etiqueta));
  // Una relación no se dibuja dos veces (dos fragmentos contiguos se apuntan
  // el uno al otro y el muelle tiraría el doble).
  const clave = (o: string, d: string, t: string) => (o < d ? `${o}|${d}|${t}` : `${d}|${o}|${t}`);
  const vistas = new Set(aristas.map((x) => clave(x.origen, x.destino, x.tipo)));
  const anadirArista = (x: AristaGrafo) => {
    const k = clave(x.origen, x.destino, x.tipo);
    if (vistas.has(k)) return;
    vistas.add(k);
    aristas.push(x);
  };

  for (const id of faltan) {
    const c = porId.get(id);
    if (!c) continue;
    if (!presentes.has(c.documentoId)) {
      nodos.push({
        id: c.documentoId,
        tipo: "documento",
        etiqueta: tituloDocumento.get(c.documentoId) ?? c.documentoId,
        documentoId: c.documentoId,
      });
      presentes.add(c.documentoId);
    }
    nodos.push({
      id: c.id,
      tipo: "chunk",
      etiqueta: c.seccion?.slice(0, 48) || `Fragmento ${c.indice + 1}`,
      documentoId: c.documentoId,
    });
    presentes.add(c.id);
    anadirArista({ origen: c.documentoId, destino: c.id, tipo: "contiene" });
  }

  // Relaciones del fragmento recién añadido con lo que ya se veía.
  for (const id of faltan) {
    const c = porId.get(id);
    if (!c || !presentes.has(c.id)) continue;
    for (const rel of c.relacionados) {
      if (!presentes.has(rel)) continue;
      const otro = porId.get(rel);
      const contiguo = otro ? otro.documentoId === c.documentoId && Math.abs(otro.indice - c.indice) === 1 : false;
      anadirArista({ origen: c.id, destino: rel, tipo: contiguo ? "sigue" : "referencia" });
    }
    for (const entidad of c.entidades) {
      if (!entidadesDibujadas.has(entidad)) continue;
      anadirArista({ origen: c.id, destino: `ent:${entidad}`, tipo: "menciona" });
    }
  }

  return { nodos, aristas };
}
