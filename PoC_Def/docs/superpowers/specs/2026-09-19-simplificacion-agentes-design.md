# Diseño: simplificación del sistema de agentes

Fecha: 2026-09-19
Estado: borrador para revisión del equipo; no implica implementación ni cambios de política activos.
Ámbito: aplicación `PoC_Def`.
Base: auditoría del código y esquema manual del equipo, con las aclaraciones sobre autonomía,
SEPRONA y despliegue de bomberos en el perímetro.

## 1. Objetivo y decisiones de producto

Reducir los 16 agentes registrados a cuatro roles operativos comprensibles:
**Voz → Analista → Planificador → Ejecutor**. El objetivo es eliminar bucles y responsabilidades
duplicadas, no solamente cambiar los nombres de las tarjetas.

- La plataforma ejecuta automáticamente las acciones que cumplen reglas configuradas.
  El humano resuelve excepciones, puede corregir planes y conserva el control.
- Se mantienen los cuatro roles del esquema manual. No se añade un agente Supervisor,
  Portavoz, Memoria o Percepción para completar una cifra de agentes.
- Se conserva el análisis de patrones y la capacidad de proponer actuaciones ante SEPRONA.
- Las unidades de extinción reciben destinos de trabajo alrededor del perímetro, no el
  centro del incendio como destino implícito.
- Se reutilizan fuentes, integraciones, ejecución, persistencia, informes y aprendizaje.
- Cuatro roles no significan cuatro bucles LLM: Voz puede vivir en HappyRobot y el Ejecutor
  puede ser determinista. Analista y Planificador concentran el razonamiento operativo.

## 2. Diagnóstico verificado

| Hallazgo | Consecuencia para el diseño |
|---|---|
| El registro reúne ocho índices de agentes | Sustituir la organización por responsabilidades reales, con un registro pequeño |
| Satélite, meteorología, propagación y movimiento son trabajos programados | Mantenerlos como servicios; no requieren identidad de agente cognitivo |
| La centralita ya expone ingesta directa y usa su ciclo para reintentos | Reutilizar esa entrada y gestionar los reintentos en ingesta |
| El asesor legal corre independientemente del pipeline | Dar a la revisión un punto explícito de ejecución; evitar modificaciones tardías de autorización |
| El asesor reutiliza fundamentos existentes si los hay | La recuperación duplicada es condicional; no prometer ahorro fijo de búsquedas |
| El supervisor mezcla evaluación de decisiones y vigilancia de salud | Separar revisión invocable y monitorización del motor |
| Una decisión puede contener varias acciones y se autoriza como conjunto | Representar como decisiones distintas los pasos autorizables por separado |
| El ejecutor continúa tras fallos y una decisión puede terminar ejecutada con éxito parcial | Hacer explícitos resultados, requisitos de avance y fallos de cada paso |
| Hay un temporizador compartido que comprueba cadencias | No justificar la reducción con un supuesto temporizador por agente |
| Las lecciones se filtran por identificador de agente | Mantener compatibilidad con identificadores históricos |
| El coordinador calcula destinos por sector, pero existen estimaciones y un fallback al centro | Unificar selección, estimación y ejecución sobre el destino operativo real |

Referencias principales, relativas a `PoC_Def`:

- `lib/agentes/registro.ts`, `lib/motor/contratos.ts`.
- `lib/motor/orquestador.ts`: temporizador, pipeline, aprobación y ejecución.
- `lib/agentes/planificacion/asesor-legal.ts`: reutilización de fundamentos y ciclo independiente.
- `lib/agentes/supervision/supervisor.ts`: evaluación y salud.
- `lib/dominio/politica.ts`, `lib/dominio/politica-defecto.ts`.
- `lib/agentes/planificacion/coordinador.ts`: `puntoDeSector`, `candidatas`.
- `lib/agentes/ejecucion/ejecutor.ts`: despliegue y resultados de proveedores.
- `lib/aprendizaje/memoria.ts`: `leccionesPara`.

No se fijan ahorros de líneas, latencia o llamadas LLM sin medir el flujo resultante.

## 3. Arquitectura y responsabilidades

```text
Voz / cámaras / prensa / satélite / mensajes entrantes
                         |
               Ingesta y extracción
                         |
                      Analista <--- meteo, propagación, poblaciones, protocolos
                         |
                 Evaluación de riesgo
                         |
                    Planificador <--- recursos, rutas, redacción, lecciones
                         |
                  Pasos propuestos
                         |
             Política y revisión explícita
                   /             \
             Automático      Decisión humana
                   \             /
                      Ejecutor
                         |
             Resultados y confirmaciones
                         |
       Estado del incidente + retroalimentación + lecciones
                         |
               Reevaluación / replanificación
```

### 3.1 Voz e ingesta

Voz conversa, aclara datos y registra el aviso. No decide despliegues ni ejecuta órdenes
operativas por interpretar una llamada. Se reutilizan HappyRobot y la centralita.

Cada fuente produce observaciones normalizadas con origen, fecha y extracción cuando
corresponda. Visión y extracción de texto pueden usar LLM sin convertirse en agentes.
Se conservan reintentos, geocodificación, límites territoriales, conmutadores de fuentes y
la vía de verificación inmediata de observaciones urgentes.

### 3.2 Analista

Es dueño de la evaluación del incidente: verifica, corrobora, deduplica y crea o actualiza
focos mediante las funciones de dominio. Integra previsiones, población amenazada y
patrones entre focos. No abre una segunda cadena independiente de órdenes operativas.

Se activa por nuevas observaciones o cambios materiales de situación. Una captura repetida
sin nueva evidencia no obliga por sí sola a repetir todo el razonamiento.

### 3.3 Planificador

Es dueño de las propuestas de actuación: coordina medios, protección de población,
comunicaciones y notificaciones SEPRONA. Consume la evaluación de riesgo y consulta recursos,
rutas, protocolos y lecciones. Las órdenes manuales siguen siendo posibles y auditables.

Absorbe `coordinador` y `proteccion_poblacion`. Puede mantener funciones y esquemas internos
especializados; consolidar no exige un prompt gigante ni un archivo único.
La redacción y traducción de comunicaciones son herramientas que usa cuando propone un aviso.

### 3.4 Ejecutor

Ejecuta el contenido autorizado mediante los adaptadores existentes. No reinterpreta la orden,
no inventa destinos y no modifica su alcance después de la aprobación. Devuelve referencias,
errores, resultados y confirmaciones, y continúa el plan según sus requisitos de avance.

Los estados de movimiento se actualizan por el servicio de despacho y el reloj de mundo.
El éxito de una petición a un proveedor no demuestra por sí solo que se haya completado la
operación externa; se distingue el envío de la confirmación.

### 3.5 Servicios compartidos

- Recuperación de datos, visión, extracción, meteo, propagación, rutas y movimiento.
- Política determinista y funciones invocables de revisión jurídica/calidad.
- Redacción, traducción y actas deterministas con narrativa adicional cuando se solicite.
- Registro de retroalimentación, extracción de lecciones y recuperación de memoria.
- Persistencia, SSE, trazas, cancelación, concurrencia limitada y salud del motor.

La actualización de meteo, propagación y movimiento no depende de que un LLM la solicite.
Se reutiliza la infraestructura de programación existente; no se crea un segundo framework
de tareas con todas las fichas, permisos y ciclos de los agentes retirados.

## 4. Contratos conceptuales

### 4.1 Evaluación de riesgo

Registro estructurado con identificador, incendio, revisión, fecha, referencias a evidencias,
confianza e incertidumbres, perímetro evaluado, previsión relevante, poblaciones amenazadas,
datos ausentes y cambios respecto a la evaluación anterior. Puede referenciar clusters.

La salida visible puede ser Markdown, pero el Planificador recibe los datos estructurados.
Una evaluación nueva permite comprobar si un plan anterior continúa siendo aplicable.

### 4.2 Plan y pasos

Un plan referencia la evaluación que lo originó y agrupa pasos ordenados. Cada paso referencia
una `Decision` existente, con su justificación, acciones, evidencias, autorización y resultados.
Se añaden metadatos de agrupación y dependencias sin duplicar el ciclo de decisión.

- Una unidad autorizable de forma independiente equivale a una decisión/paso.
- Varias acciones pueden compartir paso si tienen la misma autorización y no requieren
  confirmaciones intermedias. Si necesitan avanzar por separado, se separan los pasos.
- Cada dependencia identifica el paso previo y si exige envío aceptado, ejecución completada
  o confirmación externa. Se rechazan referencias inexistentes y ciclos.
- La disponibilidad de un paso se deriva de sus dependencias y del estado de su decisión;
  no se persiste otra máquina de estados equivalente.
- Un resultado parcial no satisface una dependencia que exige todas las acciones completadas.
- La UI muestra pendiente, espera de dependencia, espera humana, en ejecución, espera de
  confirmación, completado, rechazado o fallido a partir de esos datos.

### 4.3 Retroalimentación

Registro vinculado a incidente, plan, decisión o acción, con origen, fecha, comentario o
resultado observado y evidencia. Sirve tanto para replanificar ahora como para producir una
lección reutilizable. Un rechazo no se reduce a una nota que el sistema leerá otro día.

Los contratos TypeScript definitivos se especificarán en el plan de implementación siguiendo
la restricción actual: extensiones aditivas y opcionales de los contratos compartidos,
documentadas en `docs/REPARTO.md`. Los consumidores aceptan registros antiguos sin plan.

## 5. Autonomía, revisión e intervención humana

La automatización es una capacidad central. El Planificador conoce las reglas y propone
acciones que el motor contrasta con la política activa y el estado vigente antes de ejecutarlas.

Una regla define tipo y propósito de actuación, condiciones verificables, ámbito, requisitos
de autorización, modo automático/humano y motivo de la decisión. Las condiciones pueden
incluir disponibilidad de recursos, evidencia requerida, destino válido y ausencia de duplicados.
Si la regla automática no se cumple o no puede evaluarse, el paso requiere decisión humana.

No hay una jerarquía universal que haga más autónomo desplegar bomberos que cerrar una vía:
depende de la actuación concreta, su impacto y la autorización configurada. Se diferencia:

- Solicitar un corte a la autoridad competente.
- Activar un corte ya autorizado dentro de un protocolo.
- Ordenar un corte nuevo fuera de ese ámbito.

También se distingue transmitir una evacuación ya aprobada de decidir una evacuación.
El canal de comunicación no cambia la naturaleza de la orden.

Los umbrales y delegaciones concretos no se deducen de ejemplos conversacionales. Durante
la migración se conserva la política configurada, y se hace explícita la excepción actual
de ataque inicial como regla, no como un bypass oculto. Cambiar las reglas de cierre de vías,
despliegue o evacuación exige configuración de producto, no un cambio implícito al fusionar agentes.

La revisión LLM existente se conserva inicialmente como función invocable, sin agente propio.
La validación de condiciones y permisos siempre precede a la ejecución. La revisión jurídica
que una regla exija también precede a ella; la revisión de calidad puede ser posterior cuando
la regla lo permita expresamente, como en el ataque inicial. Suprimir o reducir esas llamadas
será un cambio posterior evaluado con resultados, no un ahorro supuesto por renombrar módulos.

Se reutilizan fundamentos pertinentes entre fases. Desaparece el ciclo jurídico que modifica
decisiones de forma independiente después de enrutarlas. Cambiar contenido autorizado o
invalidar sus condiciones obliga a reevaluar el paso antes de enviarlo.

## 6. Ejecución, fallos y replanificación

1. El motor encuentra un paso cuyas dependencias se cumplen.
2. Comprueba vigencia del plan, condiciones actuales y autorización del contenido exacto.
3. Si requiere humano, mantiene el paso a la espera; otros pasos independientes pueden avanzar.
4. Registra el intento antes de invocar el adaptador y evita despachos concurrentes duplicados.
5. Guarda el resultado; si se requiere confirmación, espera el webhook o evento correspondiente.
6. Actualiza las dependencias y emite retroalimentación hacia el Planificador.

Los identificadores de plan/paso/acción permiten correlacionar resultados y deduplicar webhooks.
Tras un reinicio, un envío de resultado incierto se reconcilia con el proveedor si es posible;
no se reenvía a ciegas una operación externa. No se promete ejecución exactamente una vez
cuando la API del proveedor no ofrece mecanismos para garantizarla.

El fallo de un requisito bloquea los pasos dependientes y activa revisión del plan, pero no
detiene automáticamente tareas independientes. Un rechazo humano conserva el motivo y
genera una nueva propuesta que responda a él. Una replanificación referencia al plan anterior,
invalida pasos pendientes obsoletos y conserva la historia de lo ya ejecutado. No vuelve a
proponer acciones ya realizadas sin un cambio explícito de objetivo o situación.

La pausa impide iniciar nuevos efectos. Las confirmaciones de operaciones externas ya
lanzadas se registran aunque el mundo esté pausado; no implican iniciar el siguiente paso.
Sin proveedor o destino disponible, el fallo es visible y no se fabrica un resultado satisfactorio.

## 7. Bomberos en el perímetro

Se extrae una capacidad compartida de posicionamiento por sector, basada en el perímetro
actual y accesos disponibles. El Planificador selecciona destinos de trabajo exteriores y
compara tiempos de viaje a esos destinos, no al centro.

- Se reutiliza `puntoDeSector`; su margen fijo actual de 150 m es una aproximación geométrica,
  no una garantía de idoneidad operativa.
- Se comprueba el destino alcanzable devuelto por el proveedor de rutas; un ajuste a carretera
  no debe aceptarse silenciosamente si lo deja dentro del perímetro.
- Un destino exterior no demuestra por sí solo que todo el trayecto sea adecuado. Se contrasta
  la ruta con el perímetro y restricciones conocidas; los casos no resolubles se señalan.
- Si falta destino o la ruta no es utilizable, se solicita recalcular o intervenir; desaparece
  el fallback implícito a `incendio.centro`.
- Cuando cambian frente y perímetro, se reevaluan las posiciones afectadas y se propone una
  reasignación, automática si cumple las reglas.
- El mapa distingue posición actual, destino asignado y ruta. No recoloca ni teletransporta
  unidades para hacer que los iconos coincidan con el borde actualizado.

## 8. Patrones y SEPRONA

Se conserva la capacidad dentro de Analista, activada por cambios relevantes en los focos.
El resultado distingue duplicación de un incendio, convergencia física y serie que merece
investigación. Cercanía temporal o espacial no se presenta como prueba de intencionalidad.

Cada hallazgo incluye evidencias, incertidumbre, explicaciones alternativas y recomendación.
El Planificador decide si propone abrir/actualizar un ticket o notificar a SEPRONA; la política
determina su autonomía y el Ejecutor realiza la integración disponible. No se da por existente
un canal externo específico a SEPRONA solo por poder crear un ticket interno.

Se conserva un identificador estable del caso y la evidencia ya notificada. Nuevas observaciones
actualizan ese caso; no generan tickets equivalentes cada vez que corre el análisis.

## 9. Memoria, informes y observabilidad

El contexto de incidente y las lecciones reutilizables son dos clases de información sobre
la infraestructura existente, no dos agentes ni dos motores de búsqueda. Markdown es una
vista o exportación, no una copia independiente que pueda divergir del estado estructurado.

La extracción de lecciones procesa retroalimentación relevante y deduplica hechos. Los
resultados positivos pueden aportar evidencia, igual que los fallos y correcciones humanas.
Se mantienen procedencia, alcance y relación con decisiones/acciones al recuperar lecciones.

Las actas siguen derivándose de hechos registrados. Las narrativas y traducciones no bloquean
las actuaciones urgentes. El Planificador conserva los disparadores de comunicación por
cambios importantes; retirar Portavoz no elimina los boletines ni el portal ciudadano.

La UI representa cuatro roles y muestra el estado de fuentes/servicios sin fingir que todos
son agentes LLM. Expone evaluación → plan → paso → autorización → resultado, además de las
acciones humanas, trazas e historial. Se conservan `/aprendizaje` y las consultas históricas.

## 10. Consolidación y compatibilidad

| Componente actual | Destino |
|---|---|
| `vigia_camaras`, `prensa_redes`, `satelite` | Fuentes y extracción sin agente autónomo |
| `centralita` | Ingesta, normalización, contexto de voz y reintentos |
| `meteorologo`, `propagacion` | Servicios de actualización del entorno |
| `verificador`, `patrones` | Analista, con funciones especializadas |
| `coordinador`, `proteccion_poblacion` | Planificador |
| `asesor_legal`, evaluación de `supervisor` | Revisión invocable en el flujo de decisión |
| Vigilancia de salud de `supervisor` | Monitorización del motor |
| `portavoz`, `redactor` | Herramientas de redacción, traducción e informes |
| `despachador`, `ejecutorAcciones` | Ejecutor y servicio de movimiento |
| `memoria` | Procesamiento de retroalimentación y recuperación de lecciones |

Se retiran wrappers e índices obsoletos después de migrar sus consumidores; no las funciones
de dominio necesarias. Los tipos sin consumidores `MensajeBus` y `Suscriptor` de
`motor/contratos.ts` son candidatos a eliminación; el suscriptor real de `estado.ts` permanece.

Los identificadores históricos de agentes se conservan en auditoría. Una correspondencia
central permite recuperar lecciones de `verificador`/`patrones` para Analista y de
`coordinador`/`proteccion_poblacion`/`portavoz` para Planificador, además de lecciones globales.
La lectura de URLs y registros antiguos utiliza esa correspondencia sin reescribir la autoría.
Las funciones trasladadas conservan el contexto temático de las lecciones que necesitan.

Se actualizan los consumidores de identificadores: fuentes y escenarios, despertar por viento,
grafos de flujo, historial, fichas, persistencia y pruebas. La retirada de fichas activas antiguas
no debe permitir que la hidratación las reintroduzca como agentes ejecutables.

La separación del orquestador sigue responsabilidades: programación, autorización,
ejecución de planes y ciclo de incidentes. Se preservan las entradas públicas existentes
durante la migración. La versión inicial reutiliza las colas LLM y la persistencia actuales.

## 11. Criterios de aceptación

1. Un aviso de voz/cámara/prensa recorre ingesta → Analista → evaluación → Planificador sin
   necesitar agentes autónomos por fuente; los conmutadores siguen funcionando.
2. Un paso que satisface una regla automática se ejecuta sin aprobación humana; otro del
   mismo plan que requiere humano espera, sin bloquear pasos independientes autorizados.
3. Un cambio de política, contenido o condiciones relevantes invalida una autorización obsoleta.
4. Una confirmación duplicada no repite la actuación ni avanza dos veces el plan.
5. Un paso que exige confirmación no se completa solo porque se haya lanzado una llamada.
6. Los fallos parciales se muestran y no habilitan dependencias que exigen éxito completo.
7. Rechazar un paso con motivo provoca replanteamiento y conserva la evidencia para aprendizaje.
8. Reiniciar o pausar no provoca nuevos envíos duplicados; los resultados tardíos se correlacionan.
9. Los destinos de extinción se validan alrededor del perímetro, las estimaciones usan dichos
   destinos y ninguna ausencia de coordenadas termina en un despliegue silencioso al centro.
10. Cambiar el perímetro puede provocar reasignación; la visualización mantiene la posición real.
11. Una serie de focos produce un hallazgo SEPRONA trazable; repetir evidencia no duplica el caso.
12. Las lecciones con identificadores antiguos siguen siendo recuperables tras la consolidación.
13. Se conservan comunicaciones, actas, trazas, fallos visibles y acceso a registros anteriores.
14. Ninguno de los agentes retirados sigue ejecutando un bucle paralelo con la misma responsabilidad.

La verificación combina pruebas de reglas, dependencias, posiciones e idempotencia; integración
de planes, webhooks, reinicio y escenarios; y comprobación de la UI de aprobación, mapas y
auditoría. Las pruebas automatizadas usan dobles explícitos de proveedor, sin confundirlos con
actuaciones reales ni disparar comunicaciones externas durante una prueba unitaria.

La comparación antes/después mide llamadas LLM, propuestas repetidas y tiempo desde observación
hasta primera actuación autorizada en escenarios equivalentes. Menos tarjetas no demuestra
por sí solo una mejora de coste o eficacia.

## 12. Secuencia de entrega y revisión

1. Aprobar este diseño y concretar los contratos aditivos de evaluación y agrupación de pasos.
2. Implementar autorización y avance de pasos sobre decisiones/ejecutor existentes.
3. Consolidar Analista y Planificador, integrando posicionamiento y SEPRONA.
4. Conectar retroalimentación, aprendizaje, informes y compatibilidad histórica.
5. Actualizar UI, retirar wrappers obsoletos y documentar la arquitectura resultante.

Antes de ampliar autonomía en una instalación, el equipo define su catálogo de reglas:
solicitud/activación de cortes, despliegue inicial, reasignaciones y medidas de población.
Esto es configuración operativa a revisar; no bloquea construir el flujo con la política
actual ni autoriza a inferir umbrales nuevos durante la refactorización.

El siguiente documento será el plan de implementación con tareas, archivos y comprobaciones,
una vez revisado este borrador. Este documento fija el comportamiento y los límites del diseño;
no modifica el código ni sustituye todavía a `docs/ARQUITECTURA.md`.
