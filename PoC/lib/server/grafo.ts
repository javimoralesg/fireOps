// Grafo de ciudad y efecto dominó detrás de una interfaz.
// Implementación actual: en memoria (BFS 1..3 OUTBOUND). Si se mantiene
// ArangoDB, solo cambia GrafoArango; la firma impactoDomino() es la misma que
// la query AQL de docs/spec.md: riesgo = (4 - profundidad) * 25.

import type { AristaGrafo, ImpactoDomino, NodoGrafo, TipoNodo } from "../types";

export interface ProveedorGrafo {
  nodos(): NodoGrafo[];
  aristas(): AristaGrafo[];
  impactoDomino(incidenteId: string, profundidadMax?: number): ImpactoDomino[];
  vecinosDesplegados(nodoId: string): NodoGrafo[];
}

// Infraestructuras críticas: las de la spec + las del grafo real OSM (poc-07).
export const TIPOS_CRITICOS: TipoNodo[] = ["Hospital", "Centro_Comunicaciones", "Ruta_Evacuacion", "Residencia", "Colegio", "Subestacion", "Estacion"];

export class GrafoMemoria implements ProveedorGrafo {
  private readonly porId: Map<string, NodoGrafo>;
  private readonly salientes: Map<string, AristaGrafo[]>;
  private readonly entrantes: Map<string, AristaGrafo[]>;

  constructor(private readonly _nodos: NodoGrafo[], private readonly _aristas: AristaGrafo[]) {
    this.porId = new Map(_nodos.map((n) => [n.id, n]));
    this.salientes = new Map();
    this.entrantes = new Map();
    for (const a of _aristas) {
      if (!this.salientes.has(a.from)) this.salientes.set(a.from, []);
      this.salientes.get(a.from)!.push(a);
      if (!this.entrantes.has(a.to)) this.entrantes.set(a.to, []);
      this.entrantes.get(a.to)!.push(a);
    }
  }

  nodos() {
    return this._nodos;
  }
  aristas() {
    return this._aristas;
  }

  /** Equivalente a: FOR v,e,p IN 1..3 OUTBOUND @inc GRAPH 'Ciudad_Graph' FILTER v.tipo IN [...] */
  impactoDomino(incidenteId: string, profundidadMax = 3): ImpactoDomino[] {
    const out: ImpactoDomino[] = [];
    const visitar = (id: string, ruta: string[], prof: number) => {
      if (prof > profundidadMax) return;
      for (const a of this.salientes.get(id) ?? []) {
        // Solo seguimos aristas de impacto (BLOQUEA_A / SUMINISTRA_A); DESPLEGADO_EN es de recursos.
        if (a.tipo === "DESPLEGADO_EN") continue;
        const v = this.porId.get(a.to);
        if (!v || ruta.includes(v.nombre)) continue;
        const nuevaRuta = [...ruta, v.nombre];
        if (TIPOS_CRITICOS.includes(v.tipo)) {
          out.push({ infraestructura: v.nombre, riesgo: (4 - prof) * 25, ruta: nuevaRuta });
        }
        visitar(v.id, nuevaRuta, prof + 1);
      }
    };
    const inicio = this.porId.get(incidenteId);
    if (!inicio) return [];
    visitar(incidenteId, [inicio.nombre], 1);
    return out.sort((a, b) => b.riesgo - a.riesgo);
  }

  vecinosDesplegados(nodoId: string): NodoGrafo[] {
    return (this.entrantes.get(nodoId) ?? [])
      .filter((a) => a.tipo === "DESPLEGADO_EN")
      .map((a) => this.porId.get(a.from))
      .filter((n): n is NodoGrafo => Boolean(n));
  }
}
