# Política de autonomía de la IA

Responde a la pregunta del mando: **¿qué puede gestionar la IA sola, qué propone para que lo firme una persona y qué queda reservado a personas?** Es la capa de gobernanza que el jurado puntúa como *supervisión* (33 %) y la que exige el Reglamento UE 2024/1689 (art. 14, supervisión humana). Dueño: poc-c5. Fuente de verdad en código: [`lib/politica-autonomia.ts`](../lib/politica-autonomia.ts).

## Modelo en tres capas

| Capa | Qué fija | Dónde |
|---|---|---|
| **Catálogo de actuaciones** (ranking) | 15 tipos de actuación con un **riesgo mínimo** 0-100 (su posición en el ranking y el *suelo* de riesgo de cualquier decisión que los contenga), un **modo** y, en las graves, una **firma mínima** | `CATALOGO` + ajustes guardados en `data/politica.json` |
| **Modo** por actuación | `autonoma` · la IA ejecuta si el riesgo no supera el umbral · `supervisada` · la IA propone y firma una persona, siempre · `humano` · reservada: la IA prepara el expediente, nunca ejecuta | editable en `/politica` con permiso `fijar_umbral` |
| **Umbral de autonomía** y **límites por rol** | `EstadoSistema.umbralAutonomia` (slider del Header y de `/politica`) y `riesgoMaxDecision` / `escalarA()` de `lib/roles.ts` | ya existían; la política los usa |

Principios:

1. **Lista blanca, no lista negra.** Lo que no está en el catálogo nunca se ejecuta solo (`supervisada` por defecto).
2. **La IA no se rebaja el riesgo.** El riesgo efectivo es `max(riesgo estimado por la IA, suelo de la actuación más grave)`. Ejemplo real de la demo: el comunicado con ES-Alert lo valora la IA en 15, pero *Alerta masiva* tiene suelo 85 y modo reservado → lo firma la Dirección del Plan.
3. **Manda la actuación más restrictiva.** Una decisión con varias actuaciones (comunicado + ES-Alert + confinamiento) cae en el modo de la más grave y hereda la firma mínima más alta de todas.
4. **Se clasifica lo que se ejecuta**, no la narrativa: foco, título, acciones del plan y mensaje de alerta. Ni el resumen ni las alternativas descartadas (mencionar "evacuar" para descartarlo no es evacuar).

## Catálogo por defecto

| # | Actuación | Riesgo mín. | Modo | Firma mínima | Base |
|---|---|---|---|---|---|
| 1 | Informes y actas | 5 | autónoma | — | PEMAM · CECOP |
| 2 | Verificación y recogida de información | 10 | autónoma | — | RD 524/2023 |
| 3 | Comunicación interna a servicios | 15 | autónoma | — | PEMAM · CECOP |
| 4 | Tareas para voluntariado | 15 | autónoma | — | Ley 17/2015 |
| 5 | Comunicación a la población | 30 | firma humana | según riesgo | PEMAM · Gabinete de Información |
| 6 | Despliegue de medios propios | 35 | firma humana | según riesgo | PEMAM · Dirección Técnica |
| 7 | Protección de infraestructuras críticas | 35 | firma humana | según riesgo | Ley 8/2011 |
| 8 | Restricción parcial de tráfico | 45 | firma humana | según riesgo | PEMAM · tráfico |
| 9 | Confinamiento de población | 60 | **reservada** | según riesgo | Ley 17/2015 art. 7 bis |
| 10 | Corte total de vías principales | 65 | firma humana | Dirección Técnica | PEMAM · DGT |
| 11 | Evacuación de población | 75 | **reservada** | Dirección Técnica | PEMAM EV-01 |
| 12 | Corte de suministros básicos | 75 | **reservada** | Dirección Técnica | Ley 8/2011 |
| 13 | Alerta masiva (ES-Alert, sirenas) | 85 | **reservada** | Dirección del Plan | Red de Alerta Nacional |
| 14 | Situación operativa y medios estatales | 90 | **reservada** | Dirección del Plan | RD 524/2023 |
| 15 | Requisa y restricción de derechos | 95 | **reservada** | Dirección del Plan | Ley 17/2015 art. 7 bis/ter |

Cada actuación lleva además `reversible`, `afectaDerechos`, ejemplos y los patrones de clasificación. La Dirección del Plan puede cambiar modo, riesgo mínimo y firma mínima de cada una; los cambios quedan en el historial de la política y en la timeline del incidente.

## Veredicto por decisión

`evaluarCompetencia(decision, politica, umbral)` es pura y determinista: el motor y la UI obtienen el mismo resultado.

```ts
interface VeredictoCompetencia {
  modo: "autonoma" | "supervisada" | "humano";
  categorias: CategoriaId[];        // detectadas, de más a menos restrictiva
  categoriaDominante: CategoriaId | null;
  riesgoPropuesto: number;          // lo que estimó la IA
  riesgoEfectivo: number;           // max(propuesto, suelo de la dominante)
  umbral: number;
  firmaMinima: RolId | null;        // null si la IA ejecuta sola
  motivo: string;                   // frase para timeline y tooltips
  evaluadaEn: string;
}
```

Con el catálogo por defecto y umbral 20, las decisiones del guion quedan así:

| Decisión (riesgo IA) | Actuaciones detectadas | Modo | Riesgo efectivo | Firma mínima |
|---|---|---|---|---|
| Despliegue inicial (35) | despliegue | firma humana | 35 | Jefatura del PMA |
| Corte parcial M-30 (45) | tráfico parcial, aviso interno | firma humana | 45 | Dirección Técnica |
| Corte total M-30 (72) | tráfico total | firma humana | 72 | Dirección del Plan |
| Proteger hospital (30) | protección infraestructura, despliegue, consulta | firma humana | 35 | Jefatura del PMA |
| Evacuación residencia (55) | evacuación, confinamiento, consulta | **reservada** | 75 | Dirección del Plan |
| Replanificación viento (60) | evacuación, confinamiento, tráfico parcial, despliegue | **reservada** | 75 | Dirección del Plan |
| Comunicado + ES-Alert (15) | alerta masiva, confinamiento, comunicación pública | **reservada** | 85 | Dirección del Plan |
| SITREP (5) | informes | **autónoma** | 5 | — |

## Superficie `/politica`

- Tres tarjetas con el recuento por modo.
- **Umbral de autonomía**: slider grande con la escala de límites por rol (25 Sala 112 · 40 PMA · 70 Dir. Técnica · 100 Dir. Plan). Misma llamada que el Header (`POST /api/config { umbralAutonomia }`).
- **Matriz de competencias**: ranking ascendente por riesgo mínimo con la línea del umbral entre filas. Por fila: actuación, chips *Irreversible* / *Derechos*, base normativa (tooltip), riesgo mínimo (editable), modo (tres chips), firma mínima (selector) y **quién la gestiona** con el umbral actual.
- **Decisiones bajo esta política**: las propuestas activas de la consola con su veredicto; avisa si una se ejecutó sola y con la política actual no habría podido.
- **Cambios de la política**: historial con rol y hora.

La ve todo rol con `ver_mando`; la edita solo `fijar_umbral` (Dirección del Plan). Sin backend, muestra el catálogo por defecto en solo lectura.

## API

| Método | Ruta | Body | Permiso | Devuelve |
|---|---|---|---|---|
| GET | `/api/politica` | — | libre | `{ politica: PoliticaAutonomia, umbralAutonomia }` |
| PUT | `/api/politica` | `{ categoria, ajuste: { modo?, riesgoMinimo?, firmaMinima? } }` o `{ restablecer: true }` | `fijar_umbral` (403 con `escalarA` si no) | igual que GET |

`firmaMinima: null` = "según riesgo". Los ajustes que coinciden con el valor por defecto se descartan. Persistencia: `data/politica.json` (ignorado por git, como `estado.json`).

**Al cambiar la política** (`lib/server/politica.ts`): se anota en la timeline y se **reevalúan las decisiones pendientes** con la política nueva (veredicto, riesgo efectivo y firma mínima), partiendo del riesgo que estimó la IA para que bajar un suelo también baje la decisión. Nunca se ejecuta nada con efecto retroactivo: una propuesta anterior al cambio que pase a ser autónoma sigue esperando firma. Las que no tenían veredicto (creadas antes del enganche) lo reciben.

## Integración (hecha el 2026-09-18, 22:05)

**poc-55 · motor** (`lib/server/motor.ts`, `crearDecision`): la comparación directa con el umbral se sustituyó por el veredicto.

```ts
import { evaluarCompetencia } from "../politica-autonomia";
import { politicaActual } from "./politica";
// …
const v = evaluarCompetencia(d, await politicaActual(), e.umbralAutonomia);
d.competencia = v;          // Decision.competencia?: VeredictoCompetencia (tipos-sistema.ts)
d.riesgo = v.riesgoEfectivo; // así ZonaAccion, exigirDecidir y escalarA siguen funcionando sin cambios
registrar(e, "propuesta", v.motivo, d.id);
if (v.modo === "autonoma") { /* ejecución automática como hasta ahora */ }
```

En `aprobar`/`denegar`, `exigirDecidir(rol, d.riesgo, d.competencia)` (`lib/server/autorizacion.ts`) aplica el riesgo efectivo y, con `puedeFirmar`, la firma mínima por categoría: un rol con riesgo suficiente pero sin la firma mínima recibe 403 "exige la firma de …". El proponente (poc-c8) devuelve además `categorias: CategoriaId[]` etiquetadas por el modelo (Claude u Ollama; la plantilla las deja vacías) y el motor las copia a `Decision.categorias` antes del veredicto: cuando existen, `evaluarCompetencia` las usa y la heurística de texto queda solo de respaldo.

**poc-3a · consola** (`components/consola/DecisionAhora`): `<SelloCompetencia />` bajo el título de la decisión, con `veredictoDe(d, politica, umbral)` y la política de `usePolitica()` leída una vez en `app/page.tsx`; enlace "Política de la IA" junto al sello y en el menú Ajustes de `BarraSuperior`. **poc-18**: fila en `docs/roles.md` y acceso directo en `/acceso`. **poc-26** (pendiente, no bloquea): el mismo sello en `DetalleDecision` / `ZonaAccion`.

Contrato estable para los consumidores: firmas de `SelloCompetencia`, `veredictoDe`, `usePolitica` y `evaluarCompetencia`; si cambian, se avisa en el tablero.

## Momento de demo

1. Abrir `/politica` como Dirección del Plan: "aquí el alcalde define qué puede hacer la IA sola".
2. Subir el umbral a 40: *Comunicación interna* y *Voluntariado* pasan a ejecutarse solas; *Evacuación* sigue reservada aunque la IA la valore en 55.
3. Avanzar al tick 5 en la consola: la IA propone comunicado + ES-Alert con riesgo 15. El sello dice **Reservada a personas · Dirección del Plan**: la política ha corregido a la IA.
4. Cambiar *Confinamiento* a firma humana: el historial y la timeline registran quién lo hizo y cuándo.
