// Barril de componentes reutilizables de la sala de mando. DUEÑO: constructor E.
// C y D pueden importar de aquí: `import { Boton, Tarjeta } from "@/components/ui";`

export { Boton } from "./Boton";
export type { BotonProps, VarianteBoton, TamanoBoton } from "./Boton";

export { Tarjeta } from "./Tarjeta";
export type { TarjetaProps } from "./Tarjeta";

export {
  Insignia,
  TEXTO_ESTADO_INCENDIO,
  TEXTO_PELIGRO,
  TEXTO_RIESGO,
  TEXTO_COMPETENCIA,
  TEXTO_ESTADO_UNIDAD,
  TEXTO_ESTADO_DECISION,
  tonoEstadoIncendio,
  tonoPeligro,
  tonoRiesgo,
  tonoCompetencia,
  tonoEstadoUnidad,
  tonoEstadoDecision,
  tonoPrioridad,
} from "./Insignia";
export type { InsigniaProps, TonoInsignia } from "./Insignia";

export { Dialogo } from "./Dialogo";
export type { DialogoProps } from "./Dialogo";

export { ProveedorToast, useToast } from "./Toast";
export type { Toast, TipoToast } from "./Toast";

export { Pestanas, PanelPestana } from "./Pestanas";
export type { Pestana, PestanasProps } from "./Pestanas";

export { Interruptor } from "./Interruptor";
export type { InterruptorProps } from "./Interruptor";

export { Desplegable } from "./Desplegable";
export type { DesplegableProps } from "./Desplegable";

export { Tooltip } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";

export { Vacio } from "./Vacio";
export type { VacioProps } from "./Vacio";

export { EnlaceExterno, EnlaceInterno, CLASE_ENLACE } from "./Enlace";
export type { EnlaceExternoProps, EnlaceInternoProps } from "./Enlace";
