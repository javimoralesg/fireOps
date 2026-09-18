// Catálogo de roles de Atalaya, adaptado de la organización de protección civil
// española: Ley 17/2015 del Sistema Nacional de Protección Civil, Norma Básica
// (RD 524/2023: dirección única, situaciones operativas 0-3) y el Plan Territorial
// de Emergencia Municipal de Madrid (PEMAM, 2023). Ver docs/roles.md.
//
// Archivo COMPARTIDO y de solo datos (sin imports de servidor ni de React):
// lo usan app/api/* para autorizar y la UI para mostrar/ocultar acciones.
// Dueño: poc-18. Cambios → avisar en docs/COORDINACION.md.

export type RolId =
  | "ciudadano"
  | "director_plan"
  | "director_tecnico"
  | "jefe_pma"
  | "jefe_sala_112"
  | "operador_112"
  | "gabinete_informacion"
  | "comite_asesor"
  | "coordinador_voluntariado"
  | "enlace_delegacion"
  | "administrador";

export type Permiso =
  | "ver_publico" // portal ciudadano: avisos oficiales, noticias verificadas, recomendaciones
  | "ver_mando" // consola del centro de mando
  | "decidir" // aprobar / denegar propuestas (limitado por riesgoMaxDecision)
  | "editar_doctrina" // activar, desactivar o reescribir reglas aprendidas
  | "fijar_umbral" // umbral de autonomía de la IA
  | "elevar_situacion" // declarar / cambiar situación operativa 0-3
  | "verificar_eventos" // validar o descartar eventos de ingesta (anti-bulos)
  | "redactar_aviso" // borrador de aviso a la población
  | "publicar_aviso" // publicar en el portal ciudadano
  | "autorizar_es_alert" // difusión masiva al móvil (ES-Alert): solo la dirección del plan
  | "interrogar_ia" // preguntar a los agentes por qué proponen algo
  | "ver_trazas_ia" // modelos, prompts, latencias, evidencia usada
  | "gestionar_voluntarios"
  | "generar_informes"
  | "firmar_informes" // acta / post-mortem con validez de firma
  | "controlar_simulacion" // tick, auto-avance, reset (solo demo / formación)
  | "administrar"; // usuarios, conectores, organismo

export type Ambito = "publico" | "direccion" | "coordinacion" | "apoyo" | "plataforma";

export interface DefinicionRol {
  id: RolId;
  nombre: string; // nombre del puesto en la plataforma
  cargoReal: string; // a quién corresponde en la administración española
  base: string; // referencia normativa / de plan
  ambito: Ambito;
  descripcion: string; // qué hace en Atalaya, en una frase
  permisos: Permiso[];
  /** Riesgo máximo (0-100) de las decisiones que puede aprobar. 0 = no decide. */
  riesgoMaxDecision: number;
  /** Ruta con la que entra en la plataforma. */
  vistaInicial: "/" | "/ciudadano" | "/auditoria";
  iniciales: string; // avatar de demo
}

const TODO: Permiso[] = [
  "ver_publico", "ver_mando", "decidir", "editar_doctrina", "fijar_umbral", "elevar_situacion",
  "verificar_eventos", "redactar_aviso", "publicar_aviso", "autorizar_es_alert", "interrogar_ia",
  "ver_trazas_ia", "gestionar_voluntarios", "generar_informes", "firmar_informes",
];

export const ROLES: Record<RolId, DefinicionRol> = {
  ciudadano: {
    id: "ciudadano",
    nombre: "Ciudadanía",
    cargoReal: "Población afectada y público general",
    base: "Ley 17/2015: derecho a la información (art. 5) y deber de colaboración (art. 7 bis)",
    ambito: "publico",
    descripcion: "Consulta avisos oficiales, noticias verificadas y qué hacer, en tiempo real y sin registro.",
    permisos: ["ver_publico"],
    riesgoMaxDecision: 0,
    vistaInicial: "/ciudadano",
    iniciales: "CI",
  },
  director_plan: {
    id: "director_plan",
    nombre: "Dirección del Plan",
    cargoReal: "Alcalde/sa (PEMAM, situaciones 0–1); consejero/a autonómico/a en situación 2",
    base: "RD 524/2023 (dirección única); PEMAM, Dirección del Plan",
    ambito: "direccion",
    descripcion: "Autoridad final: firma las decisiones de mayor riesgo, fija la autonomía de la IA, eleva la situación y autoriza ES-Alert.",
    permisos: TODO,
    riesgoMaxDecision: 100,
    vistaInicial: "/",
    iniciales: "DP",
  },
  director_tecnico: {
    id: "director_tecnico",
    nombre: "Dirección Técnica",
    cargoReal: "Jefatura de Emergencias (Bomberos / SAMUR-PC / Policía Municipal)",
    base: "PEMAM, Dirección Técnica y CECOP",
    ambito: "direccion",
    descripcion: "Decide la respuesta operativa hasta riesgo alto y enseña a la IA con su doctrina.",
    permisos: [
      "ver_publico", "ver_mando", "decidir", "editar_doctrina", "verificar_eventos", "redactar_aviso",
      "interrogar_ia", "ver_trazas_ia", "gestionar_voluntarios", "generar_informes", "firmar_informes",
    ],
    riesgoMaxDecision: 70,
    vistaInicial: "/",
    iniciales: "DT",
  },
  jefe_pma: {
    id: "jefe_pma",
    nombre: "Jefatura del PMA",
    cargoReal: "Mando del Puesto de Mando Avanzado en el lugar del suceso",
    base: "Norma Básica, Puesto de Mando Avanzado",
    ambito: "coordinacion",
    descripcion: "Ojos en el terreno: confirma lo que pasa, aprueba acciones tácticas de bajo riesgo y reporta.",
    permisos: ["ver_publico", "ver_mando", "decidir", "verificar_eventos", "interrogar_ia", "generar_informes"],
    riesgoMaxDecision: 40,
    vistaInicial: "/",
    iniciales: "PM",
  },
  jefe_sala_112: {
    id: "jefe_sala_112",
    nombre: "Jefatura de Sala 112",
    cargoReal: "Supervisor/a de sala del Centro de Coordinación (112 / CECOP)",
    base: "Centro de Coordinación Operativa (CECOP)",
    ambito: "coordinacion",
    descripcion: "Controla la ingesta: valida o descarta avisos, frena bulos y aprueba comunicaciones internas.",
    permisos: [
      "ver_publico", "ver_mando", "decidir", "verificar_eventos", "redactar_aviso",
      "interrogar_ia", "ver_trazas_ia", "gestionar_voluntarios", "generar_informes",
    ],
    riesgoMaxDecision: 25,
    vistaInicial: "/",
    iniciales: "JS",
  },
  operador_112: {
    id: "operador_112",
    nombre: "Operación 112",
    cargoReal: "Operador/a de sala 112",
    base: "Centro de Coordinación Operativa (CECOP)",
    ambito: "coordinacion",
    descripcion: "Atiende y clasifica la entrada (llamadas, sensores, redes); no decide, marca y escala.",
    permisos: ["ver_publico", "ver_mando", "verificar_eventos", "interrogar_ia"],
    riesgoMaxDecision: 0,
    vistaInicial: "/",
    iniciales: "OP",
  },
  gabinete_informacion: {
    id: "gabinete_informacion",
    nombre: "Gabinete de Información",
    cargoReal: "Portavocía y Comunicación del Ayuntamiento",
    base: "PEMAM / Norma Básica, Gabinete de Información",
    ambito: "apoyo",
    descripcion: "Única voz oficial: redacta y publica avisos a la ciudadanía y desmiente bulos. ES-Alert lo autoriza la dirección.",
    permisos: ["ver_publico", "ver_mando", "verificar_eventos", "redactar_aviso", "publicar_aviso", "interrogar_ia", "generar_informes"],
    riesgoMaxDecision: 0,
    vistaInicial: "/",
    iniciales: "GI",
  },
  comite_asesor: {
    id: "comite_asesor",
    nombre: "Comité Asesor · Supervisión IA",
    cargoReal: "Comité Asesor del plan: técnicos, jurídico y responsable de supervisión humana de la IA",
    base: "PEMAM, Comité Asesor; Reglamento UE 2024/1689 (IA), art. 14 supervisión humana",
    ambito: "apoyo",
    descripcion: "Cuestiona a los agentes: por qué proponen algo, con qué datos y qué reglas aplicaron. Audita, no ejecuta.",
    permisos: ["ver_publico", "ver_mando", "interrogar_ia", "ver_trazas_ia", "generar_informes"],
    riesgoMaxDecision: 0,
    vistaInicial: "/auditoria",
    iniciales: "CA",
  },
  coordinador_voluntariado: {
    id: "coordinador_voluntariado",
    nombre: "Coordinación de Voluntariado",
    cargoReal: "Jefatura de la Agrupación de Voluntarios de Protección Civil",
    base: "Ley 17/2015 (voluntariado de protección civil)",
    ambito: "apoyo",
    descripcion: "Abre y cierra tareas de bajo riesgo para voluntarios y controla el cupo.",
    permisos: ["ver_publico", "ver_mando", "gestionar_voluntarios", "interrogar_ia"],
    riesgoMaxDecision: 0,
    vistaInicial: "/",
    iniciales: "CV",
  },
  enlace_delegacion: {
    id: "enlace_delegacion",
    nombre: "Enlace Delegación del Gobierno",
    cargoReal: "Representante de la Delegación del Gobierno (medios estatales, UME)",
    base: "RD 524/2023, situaciones 2–3 (interés nacional)",
    ambito: "apoyo",
    descripcion: "Observa en tiempo real para anticipar la petición de medios estatales si la situación escala.",
    permisos: ["ver_publico", "ver_mando", "interrogar_ia", "generar_informes"],
    riesgoMaxDecision: 0,
    vistaInicial: "/",
    iniciales: "DG",
  },
  administrador: {
    id: "administrador",
    nombre: "Administración de la plataforma",
    cargoReal: "Servicio TIC del organismo",
    base: "—",
    ambito: "plataforma",
    descripcion: "Configura organismo, usuarios y conectores, y lanza simulacros. No decide en emergencias reales.",
    permisos: ["ver_publico", "ver_mando", "ver_trazas_ia", "controlar_simulacion", "administrar"],
    riesgoMaxDecision: 0,
    vistaInicial: "/",
    iniciales: "AD",
  },
};

export const ROLES_LISTA: DefinicionRol[] = Object.values(ROLES);

export const AMBITO_ETIQUETA: Record<Ambito, string> = {
  publico: "Público",
  direccion: "Dirección",
  coordinacion: "Coordinación operativa",
  apoyo: "Apoyo y supervisión",
  plataforma: "Plataforma",
};

/** Roles antiguos (antes de este catálogo) → rol nuevo equivalente. */
export const ROL_LEGADO: Record<string, RolId> = {
  alcalde: "director_plan",
  director_emergencias: "director_tecnico",
  tecnico_112: "jefe_sala_112",
};

export function normalizarRol(valor: string | null | undefined): RolId {
  if (valor && valor in ROLES) return valor as RolId;
  if (valor && valor in ROL_LEGADO) return ROL_LEGADO[valor];
  return "director_plan";
}

export function puede(rol: RolId, permiso: Permiso): boolean {
  return ROLES[rol].permisos.includes(permiso);
}

/** ¿Puede este rol aprobar/denegar una decisión con este riesgo? */
export function puedeDecidir(rol: RolId, riesgo: number): boolean {
  return puede(rol, "decidir") && riesgo <= ROLES[rol].riesgoMaxDecision;
}

/** Rol mínimo al que hay que escalar una decisión que excede el propio. */
export function escalarA(riesgo: number): RolId {
  const candidatos = ROLES_LISTA.filter((r) => puede(r.id, "decidir") && r.riesgoMaxDecision >= riesgo).sort(
    (a, b) => a.riesgoMaxDecision - b.riesgoMaxDecision,
  );
  return candidatos[0]?.id ?? "director_plan";
}

/** Cabecera HTTP con la que la UI declara el rol activo (demo sin autenticación real). */
export const CABECERA_ROL = "x-atalaya-rol";
