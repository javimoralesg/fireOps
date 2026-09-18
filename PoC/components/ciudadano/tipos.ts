// Forma de GET /api/publico (contrato en docs/COORDINACION.md). El adaptador
// (./adaptador.ts) produce exactamente esta forma a partir de /api/estado mientras
// el endpoint no exista, así el portal solo cambia de fuente.

import type { CondicionesEntorno, Incidente, Organismo, TareaVoluntarios } from "@/lib/tipos-sistema";

/** Situación operativa RD 524/2023 (0-3). El backend puede mandar el número o un objeto. */
export type SituacionOperativa =
  | number
  | {
      nivel: number;
      nombre?: string;
      etiqueta?: string;
      descripcion?: string;
    };

export type NivelAviso = "info" | "aviso" | "alerta" | string;

export interface AvisoPublico {
  id: string;
  titulo: string;
  texto: string;
  nivel: NivelAviso;
  publicadoEn: string; // ISO
  zonas?: string[];
}

export interface NoticiaVerificada {
  id: string;
  titulo: string;
  fuente: string;
  timestamp: string; // ISO
  verificado: boolean;
}

export interface BuloDesmentido {
  id: string;
  texto: string;
  desmentido: string;
}

export interface IncidentePublico {
  titulo: string;
  tipo: Incidente["tipo"] | string;
  /** Texto o el objeto de Incidente ({ nombre, lat, lon }). */
  ubicacion: string | { nombre: string; lat?: number; lon?: number };
  fase: Incidente["fase"] | string;
  activo: boolean;
}

export type TareaPublica = Pick<TareaVoluntarios, "id" | "titulo" | "descripcion" | "lugar" | "cupo" | "aceptados" | "estado"> &
  Partial<Pick<TareaVoluntarios, "creadaEn">>;

export interface VistaPublica {
  organismo: Organismo;
  incidente: IncidentePublico | null;
  situacionOperativa?: SituacionOperativa | null;
  avisos: AvisoPublico[];
  recomendaciones: string[];
  noticiasVerificadas: NoticiaVerificada[];
  bulosDesmentidos: BuloDesmentido[];
  entorno: Pick<CondicionesEntorno, "viento" | "aire"> | null;
  tareasVoluntarios: TareaPublica[];
  actualizadoEn: string;
}
