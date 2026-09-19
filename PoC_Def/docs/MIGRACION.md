# Migración de agentes · de 16 fichas a 5 que razonan

Rama `migracion/16-a-5-agentes`. Objetivo: **menos agentes, menos tokens, más
rápido, sin perder comportamiento.**

Este documento dice qué se ha hecho, qué se midió, **en qué el plan estaba
equivocado** y qué queda. Si retomas esto, empieza por §4.

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

## 4. Qué queda

**Competencia por acción.** Es lo único pendiente, y es lo que desbloquea la
fusión grande del mando. Cuatro piezas:

1. `Accion.competencia?` — campo opcional, aditivo, anotar en `REPARTO.md`.
2. La política evalúa por acción y devuelve el **suelo**: el agente propone, la
   política solo puede subir, nunca bajar.
3. La ejecución se detiene en la primera acción que requiera una persona.
4. Con eso hecho, se puede fundir coordinador + protección en un plan único.

**Riesgo de contrato**: ampliar `EstadoAccion` **no es aditivo**. Rompe los
`switch` exhaustivos de `lib/agentes/ejecucion/ejecutor.ts` y la UI de acciones.
El instrumento es `npm run test:tipos`, y la auditoría de cada `switch` forma
parte de la fase.

**Pregunta sin resolver** que hay que contestar antes de implementar: si el paso
1 es automático, el 2 humano y el 3 automático, ¿el 3 espera al 2? ¿Y si el
humano deniega el 2, se revierte el 1 (camiones ya en carretera)? Y `caducarPendientes`
solo mira estados de decisión: tal cual, **una acción pendiente no caducaría nunca**.

**Cabo suelto menor**: la revisión legal en línea tarda ~40 s (medido). Para un
comunicado da igual, pero una decisión de evacuación también los espera.
Propuesta sin decidir: cuando todas las acciones ya sean de competencia humana,
que la revisión llegue a posteriori — la va a leer una persona igualmente.

---

## 5. Cómo verificar

```bash
npm run test:unit      # 524 en verde, sin red, < 1 s
npm run test:tipos     # el guardián de los contratos
ATALAYA_URL=http://localhost:3100 npm run test:integracion
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
