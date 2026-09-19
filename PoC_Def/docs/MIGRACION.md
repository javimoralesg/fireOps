# Migración de agentes · de 16 fichas a 5 que razonan

Rama `migracion/16-a-5-agentes`. Objetivo: **cinco fichas operativas, menos
complejidad visible y el mismo comportamiento de las dieciséis capacidades**.

La rama ya incorpora `main` (merge `f656c67`). Este documento separa lo que
está implementado de lo que todavía debe demostrarse con una ejecución viva.

---

## 1. El método, en una regla

Cada sustitución lleva **dos** conjuntos de pruebas, ambos escritos *antes* de
tocar el código de producción:

- **Red de no regresión**: pasa antes y después, y **nadie la edita**. Es lo que
  demuestra que no se perdió nada.
- **Prueba de intención**: **falla antes** y pasa después. Si no existe, la
  sustitución no está lista: significa que no sabemos decir en qué se notará.

No se puede usar *golden master* en todo, porque media arquitectura la escribe un
LLM. La verificación se parte en tres clases:

| Clase | Qué afirma | Dónde |
|---|---|---|
| 1 · Caracterización exacta | misma entrada → misma salida, byte a byte | todo lo que está **por debajo de la frontera zod** |
| 2 · Invariantes | lo que es cierto de *cualquier* salida válida | agentes que llaman al modelo |
| 3 · Presupuesto | llamadas y tokens por decisión | `tests/integracion/90-presupuesto.test.ts` |

**La frontera zod** es el concepto que sostiene todo: el tipo validado que el
modelo rellena separa lo impredecible de lo puro. Por encima, pruebas vivas con
invariantes. Por debajo, unitarias exactas con objetos construidos a mano — que
no es simular una respuesta del modelo, sino pasarle a una función pura un dato
de su tipo declarado. Ver `lib/agentes/planificacion/mapeo-plan.ts`.

---

## 2. Fases hechas

| Fase | Qué | Medido |
|---|---|---|
| **F0** | Preparar el oráculo: exportar lo intestable, congelar el inventario, línea base | Cierra los fallos L-1 y L-2 |
| **F1a** | El acta de una acción deja de pedir narrativa al modelo | 3 actas con IA → **0** |
| **F1b** | `memoria` deja de aprender de que todo salió bien | 3 llamadas / 7.605 tok → **0** |
| **F1c** | El veto legal se aplica antes de enrutar | Carrera arreglada |
| **F1.5** | Pulsar «Parar» deja de ser una avería | Cierra L-5 y L-6 |
| **F2** | Distinguir agentes de entradas deterministas | 16 fichas, **12 razonan** |
| **F3** | Protección de población: una llamada por foco, no por pueblo | 2 llamadas / 7.410 tok por 2 pueblos → **1 / 2.423 por 4** |
| **F4** | Prensa y redes: una llamada por lote, no por artículo | hasta 6 llamadas/ciclo → **1** |
| **F5** | El supervisor evalúa por muestreo | bloqueante en todas → solo donde importa |
| **F6** | Integrar `main` en la rama de migración | merge `f656c67`; resolución de protección de población y Overpass |
| **F7** | Competencia, riesgo y dependencias por acción | Implementado y cubierto por unitarias/type-check |
| **F8** | Registro de 5 fichas / 16 capacidades y aliases | Implementado; replay determinista legacy/five en verde |

**Resultado sobre el mismo escenario de la línea base** (ataque inicial de 2
acciones), atribuido por decisión:

```
actas que gastan IA ............... 3 → 0
razonamiento en el camino crítico . 11 llamadas → 1
tokens de salida .................. 24.072 → 535
```

Además, tres arreglos de **Overpass** que no estaban en el plan y salieron al
verificar: el orden de espejos caducado, el orden que ahora se corrige solo con
la latencia medida, y la cuota por IP que se confundía con un servidor muerto.

---

## 3. En qué se ejecutó distinto al plan, y por qué

De seis fases, **tres se hicieron de otra forma**. En los tres casos el código
tenía una razón que el plan ignoraba. Queda escrito para que nadie lo «arregle»
de vuelta:

**F2 · No se sacaron los deterministas del bucle.** El plan decía bajar de 16 a
12 agentes sacando `satelite`, `meteorologo`, `propagacion` y `despachador`. Al
medir: esos cuatro hacen **cero llamadas al modelo**. Sacarlos no ahorra ni un
token ni un hueco de la cola, y costaría riesgo real — el «Simulacro» apaga
fuentes desactivando su agente, y el caso (d) comprueba la pausa sobre la lista
de agentes. Se hizo lo que sí aportaba: que la diferencia **se vea** en la sala.

**F3 · No se fundió protección dentro del coordinador.** `evaluarCompetencia`
aplica la acción **más restrictiva** a toda la decisión. Fundir el plan con los
avisos significaría que una evacuación (humano) convierte en humano también el
envío de camiones (supervisada), y **el ataque inicial dejaría de ser
autónomo**. Esa fusión necesita ANTES la competencia por acción. Se cogió el
ahorro que no cuesta autonomía.

**F4 · El verificador no se agrupa.** Su propio comentario lo explica: procesa
uno a uno *a propósito*, porque un aviso puede crear el foco que el siguiente
debe confirmar. Agruparlo reintroduciría el bug de «dos avisos del mismo fuego
abren dos focos», que ya está arreglado. Hay una prueba que lo deja escrito.

---

## 4. Corte estructural ya implementado

La reducción no crea cinco *mega-prompts*. Se han separado la ficha que ve la
sala y la unidad que ejecuta trabajo:

| Ficha lógica | Capacidades que conserva |
|---|---|
| `observador` | `vigia_camaras`, `satelite`, `prensa_redes`, `centralita`, `meteorologo`, `verificador` |
| `planificador_operativo` | `propagacion`, `patrones`, `coordinador`, `proteccion_poblacion`, `despachador` |
| `comunicador` | `portavoz` |
| `guardian` | `asesor_legal`, `supervisor` |
| `cronista` | `memoria`, `redactor` |

- En topología `five`, `Estado.agentes` registra estas cinco fichas; las 16
  capacidades siguen teniendo su propia cadencia, disparadores, límite de
  tiempo y llave de concurrencia. Una capacidad lenta no bloquea a sus
  hermanas.
- Los ids antiguos son aliases estables para URL, API, históricos y enlaces
  guardados. Una petición a `coordinador`, por ejemplo, se atribuye al padre
  `planificador_operativo` cuando ya no exista una ficha propia.
- La competencia ya se evalúa por acción. `Accion.competencia`, `riesgo` y
  `dependeDe` son aditivos; la política solo puede elevar el suelo indicado por
  el agente. Las acciones autónomas independientes se ejecutan antes de la
  espera humana, y las dependientes esperan o se cancelan si su dependencia
  termina mal.
- El oráculo diferencial normaliza decisiones (ids legacy/canónicos, orden,
  prosa y campos volátiles) y compara productor, objetivos, acciones,
  competencia, riesgo, evidencias y fundamentos. El modo `shadow` construye
  un snapshot clonado y congelado y solo permite devolver un plan candidato no
  aplicable: no recibe estado mutable ni ejecutores.

`AGENT_TOPOLOGY` controla el despliegue: `legacy` conserva 16 fichas, `shadow`
mantiene autoridad legacy y habilita la infraestructura de planes candidatos
aislados, y `five` publica las cinco fichas. La ausencia de la variable selecciona `five`; un valor
desconocido aborta el arranque de forma explícita. `legacy` permanece como
rollback y referencia de comparación.

## 5. Qué queda por verificar

No se debe confundir el corte de código con una equivalencia ya demostrada.
Quedan estas puertas, que deben registrarse con sus salidas reales:

1. Completar el build de Next sobre el estado final. Webpack compila el código,
   pero el proceso local queda bloqueado al leer tipos de dependencias durante
   el type-check interno; `test:tipos` sí pasó antes de los últimos cambios de
   fixture/documentación.
2. **Hecho:** unitarias completas en `legacy` y `five`: 710 pasan y 5 están
   omitidas en cada topología. El replay diferencial añade 3/3 casos en verde
   contra el contrato pre-corte de las 16 capacidades.
3. Ampliar la comparación viva desde la sonda LLM aislada al escenario operativo completo. La sonda, sin efectos externos,
   devolvió el mismo JSON en ambas pasadas con HelmCode/qwen3.6 (76 tokens de
   entrada, 49 de salida; 968 ms y 152 ms). El escenario integral debe usar el mismo LLM en ambas
   topologías, en procesos limpios y con fuentes de detección apagadas. Las
   llamadas/SMS/email deben interceptarse o dirigirse al destino de demo; el
   informe debe incluir decisiones, acciones, llamadas/tokens y latencia.
4. Hacer una pasada de integración/UI en `five`. Los resultados históricos de
   este documento y de `PRUEBAS.md` son anteriores al corte y no sustituyen esa
   puerta.

---

## 6. Cómo verificar

```bash
AGENT_TOPOLOGY=legacy npm run test:unit
AGENT_TOPOLOGY=five npm run test:unit
AGENT_TOPOLOGY=five npm run test:tipos
AGENT_TOPOLOGY=five npm run build
AGENT_TOPOLOGY=five ATALAYA_URL=http://localhost:3100 npm run test:integracion
```

**Avisos de método, aprendidos a base de tropezar:**

- **Una sola instancia a la vez.** Overpass da 2 conexiones por IP. Dos
  servidores compitiendo dejan a los focos sin pueblos. Para una segunda
  instancia, usar un *worktree* de git: Next 16 no deja dos `next dev` en el
  mismo directorio.
- **El proceso hay que reiniciarlo entre fases.** Tocar `.env.local` también lo
  reinicia, y los contadores de IA se ponen a cero, pero la ejecución sobrevive
  rehidratada desde Supabase con el **mismo id**. El id NO sirve para saber si
  hubo reinicio: mirar `proceso.tiempoEnPieS` en `/api/salud`.
- **El contador global de `/api/salud` no es una medida comparable.** En un
  sistema vivo el satélite y la prensa siguen descubriendo focos y el gasto sube
  aunque la decisión que mides haya terminado (medido: 42 → 83 llamadas en 9
  minutos). La cifra que vale es la **atribuida por decisión**, desde la cadena
  de auditoría y las trazas por agente.
- Para medir sin ruido, apagar las fuentes de detección («Simulacro») y declarar
  un solo foco a mano.
