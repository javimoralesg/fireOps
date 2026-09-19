# Atalaya Incendios · Guion de demostración (10 minutos)

Actualizado el 2026-09-19. Para quien presenta ante el jurado de HackSpain 2026.
Dos personas: **quien narra** (habla y hace clic) y **quien apoya** (móvil, Telegram, mira el
reloj). Se puede hacer solo, pero con dos se gana un minuto largo.

**La idea que hay que dejar clara en los diez minutos:** Atalaya no es un panel que muestra
incendios. Son 17 agentes que **deciden, se coordinan entre ellos y actúan fuera del
sistema** — llaman por teléfono de verdad, mandan SMS de verdad, mueven medios por carreteras
reales — con un humano que manda y un sistema que aprende de lo que ese humano le corrige.

---

## 1. Preparación (empezar 30 minutos antes)

### 1.1 Claves y servicios

Todo el detalle está en `docs/CLAVES.md`. Antes de la demo, mínimo imprescindible:

| Servicio | Variable | Sin esto no se puede enseñar |
|---|---|---|
| HelmCode | `HELMCODE_API_KEY` | Nada que razone: es el corazón |
| HappyRobot | `HAPPYROBOT_API_KEY` + slugs voz/SMS + `HAPPYROBOT_WEBHOOK_SECRET` | La ejecución real (el criterio más diferencial) |
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID_DEMO` | El canal ciudadano |
| Supabase | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | El aprendizaje entre ejecuciones y el histórico de auditoría (actas y trazas) |
| FIRMS | `FIRMS_MAP_KEY` | El satélite (aunque en septiembre puede no haber focos reales) |
| Demo | `DESTINO_DEMO` = **tu móvil** en E.164 | Que las llamadas te lleguen a ti y no a un ayuntamiento real |

### 1.2 Arrancar

```bash
cd /Users/javimg/Documents/Personal/HackSpain/PoC/atalaya-incendios
npm run dev -- --port 3456      # terminal 1
scripts/tunel.sh 3456           # terminal 2 → imprime la URL https://*.trycloudflare.com
```

Con la URL del túnel ya viva:

```bash
# Telegram apunta al túnel de hoy (la URL cambia cada vez que se reabre)
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  -d "{\"url\":\"$(cat data/url-publica.txt)/api/webhooks/telegram\",
       \"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\",\"drop_pending_updates\":true}"
```

Y en HappyRobot, editar la URL del nodo Webhook de cada workflow para que apunte a
`<url del túnel>/api/webhooks/happyrobot/resultado`.

### 1.3 Comprobación previa (el semáforo)

1. Abrir **http://localhost:3456/api/salud**. Todo lo de la lista de arriba en verde. Si algo
   está en rojo, **en la demo va a fallar**: arreglarlo o quitarlo del guion.
2. Abrir la sala en **http://localhost:3456/** a pantalla completa (`⌘⌃F`), zoom del navegador
   al 90 % para que quepa el mapa y la columna derecha.
3. Mirar la barra superior: hora de mundo, factor ×12, ejecución activa, servicios en verde.
4. Abrir **/auditoria** una vez antes de empezar, para que la pestaña esté cargada y el paso 5 sea instantáneo.

### 1.4 Móvil por QR

1. En la sala, el panel de cámaras tiene un **QR** con la URL del túnel + `/movil`.
2. Escanearlo con la cámara del iPhone, abrir en Safari y **aceptar ubicación y cámara**
   (Safari lo pide dos veces: permitir las dos). Debe salir "Enviando · cada 15 s".
3. En la sala aparece una cámara nueva `movil:...` con el nombre del dispositivo, ya vigilada.
4. Dejar el móvil apoyado apuntando a algo. En el momento de la demo, enseñar una foto de
   humo en la pantalla de un portátil delante de la cámara del móvil: el Vigía la analiza y
   suelta una observación real.

### 1.5 Bot de Telegram

1. Abrir el chat con **@atalaya_incendios_bot** en un segundo teléfono (el de quien apoya) y
   dejarlo a la vista.
2. Escribirle `hola` antes de empezar, para que el chat esté abierto y no salga la pantalla
   de "Iniciar" en mitad de la demo.
3. Si hay proyector con espejo de móvil, mejor: el jurado ve llegar el mensaje en directo.

### 1.6 Ensayo del arranque

- **Ejecución limpia:** botón **Nueva ejecución** en la barra superior. Así las métricas
  empiezan a cero y el aprendizaje de la ejecución anterior queda para el paso 8.
- **Dejar el mapa en España entera.** Sin focos. Es el estado vacío con su guía ("Haz clic en
  el mapa o pulsa F para declarar un foco"): así se ve que no hay nada precargado.
- **Silenciar notificaciones** del portátil y del móvil (menos las del bot y las llamadas).
- **Un plan B por cada paso**, en §4.

### 1.7 Reparto del tiempo

| Min | Paso | Criterio del jurado |
|---|---|---|
| 0:00-0:40 | Apertura: qué es y qué se va a ver | — |
| 0:40-1:30 | 1 · Declarar el foco | Decisión sin todos los datos |
| 1:30-2:40 | 2 · Los agentes trabajando (visores y trazas) | Coordinación, transparencia |
| 2:40-3:50 | 3 · Aprobar y denegar con motivo | Control humano |
| 3:50-4:55 | 4 · La llamada, el SMS y el Telegram reales | **Ejecución real** |
| 4:55-5:35 | 5 · La cadena de auditoría y el acta exportada | Control, rigor |
| 5:35-6:35 | 6 · Gira el viento → replanificación | Adaptación |
| 6:35-7:30 | 7 · Segundo foco y análisis de patrones | Prioridad, creatividad |
| 7:30-8:25 | 8 · Grafo de conocimiento: subir y consultar | Fundamentación, creatividad |
| 8:25-9:40 | 9 · Cerrar la ejecución y el aprendizaje | **Aprendizaje** |
| 9:40-10:00 | Cierre | — |

---

## 2. Apertura (40 segundos)

> "Esto es Atalaya. Un incendio forestal real no se gestiona con un panel: se gestiona con
> decisiones, y las decisiones hay que tomarlas sin tener todos los datos y con el viento
> cambiando. Lo que vais a ver son diecisiete agentes que perciben, deciden, se coordinan y
> **actúan fuera del sistema** — llaman por teléfono, mandan SMS, mueven camiones por
> carreteras reales — con una persona que manda por encima de todos ellos.
>
> Todo lo que hay en pantalla es real: la meteorología es de Open-Meteo, los pueblos, los
> parques de bomberos y los hospitales salen de OpenStreetMap, las rutas de OSRM, las cámaras
> son de la DGT, los focos por satélite de la NASA. **No hay ni un dato inventado**: si un
> servicio falla, lo veréis en rojo ahí arriba, no veréis un número de mentira.
>
> El reloj de arriba va a doce minutos de mundo por minuto real: es lo que nos permite
> enseñaros en diez minutos cómo gira el viento en dos horas."

Señalar la barra superior: hora de mundo, factor ×12, semáforo de servicios.

---

## 3. La secuencia

### Paso 1 · Declarar el foco con un clic (0:50)

**Qué haces:** clic en el mapa en la sierra al oeste de Ávila (zona de monte, lejos de
carretera grande). Sale el diálogo, nombre `Navalacruz`, **Declarar**.

**Qué decir mientras carga (tarda unos segundos y se nota):**

> "Acabo de hacer lo que hace un técnico de sala cuando le entra un aviso por teléfono:
> declarar un foco en un punto. A partir de aquí no toco nada más.
>
> Fijaos en lo que está pasando solo: Atalaya está preguntando a OpenStreetMap qué hay en
> treinta kilómetros a la redonda — pueblos, parques de bomberos, hospitales, colegios,
> campings —, a Open-Meteo qué viento hace y qué viento va a hacer las próximas 48 horas, y
> está calculando el índice de peligro. Cada pueblo que veis y cada camión que veis **existe**:
> ese parque de bomberos está en esa carretera."

**Qué se ve:** el mapa se encuadra al foco, aparecen pueblos coloreados por riesgo, unidades
en sus bases, hospitales, flechas de viento alrededor del foco, el perímetro inicial.

**Criterio que cubre:** decisión con información incompleta. Recalcar: *"con una sola
coordenada ya tiene contexto suficiente para empezar a decidir"*.

---

### Paso 2 · Ver a los agentes trabajando (1:10)

**Qué haces:** señalar el tablero de agentes a la derecha. Abrir el visor de **Coordinador de
medios** (`/agentes/coordinador`) y enseñar la última traza: entradas, llamadas al modelo con
su latencia, resumen, decisiones producidas.

**Qué decir:**

> "Cada uno de estos diecisiete es un agente de verdad, con su modelo, su cadencia y sus
> disparadores. El Meteorólogo mira el viento cada minuto. El Vigía analiza las cámaras de la
> DGT que hay cerca del foco, con un modelo de visión, buscando humo. El Analista de
> propagación calcula por dónde va el frente. El Coordinador decide qué medios van y por dónde.
>
> Y esto de aquí — abro su visor — es lo que ha pensado en su último ciclo: qué recibió,
> cuántas veces llamó al modelo, cuánto tardó, qué decidió. **No es una caja negra**: si el
> jurado o un técnico de sala quiere saber por qué ha propuesto algo, lo puede leer entero."

Enseñar también que los agentes se despiertan por eventos, no solo por reloj: *"el Coordinador
no espera su turno si el viento gira; se despierta"*.

**Criterio:** coordinación entre agentes, transparencia, sensatez del razonamiento.

---

### Paso 3 · Aprobar y denegar con motivo (1:10)

**Qué haces:** ir a **"Requiere tu decisión"** arriba a la derecha. Hay dos o tres pendientes.

1. Abrir una de despliegue: leer en voz alta el título, el *por qué* y las acciones.
   Desplegar **evidencias** (fuente y URL de cada una) y **fundamentos** (los artículos del
   RD 893/2013 que el asesor legal ha citado). **Aprobar** (o tecla `A`).
2. Abrir una de evacuación o de comunicado y **Denegar** (tecla `D`), escribiendo un motivo
   concreto:
   > *"Aún no. Primero confinamos y avisamos al 112 provincial; evacuar sin el
   > plan de la comunidad activo no es competencia nuestra."*

**Qué decir:**

> "Aquí manda una persona. La política de autonomía — que se edita en caliente, sin recompilar
> — dice qué puede hacer cada agente solo y qué tiene que pasar por mí. Un SMS informativo
> sale solo. Evacuar un pueblo no sale nunca solo.
>
> Cada decisión viene con evidencias, con su fuente y su enlace, y con fundamento legal: esto
> lo ha sacado el Asesor Legal del grafo de conocimiento, del Real Decreto 893/2013.
>
> Y ahora lo importante: **la deniego, y escribo por qué**. Ese motivo no se pierde. Dentro de
> un momento veréis dónde acaba."

**Criterio:** control humano. Es el paso donde hay que ser explícito: *"todo se puede pausar,
aprobar, denegar o asumir; y lo denegado enseña al sistema"*.

---

### Paso 4 · La ejecución real: llamada, SMS y Telegram (1:05)

**Qué haces:** sacar el móvil (`DESTINO_DEMO`) y ponerlo donde se vea. Al aprobar la decisión
del paso 3, el Ejecutor lanza el workflow de HappyRobot.

**Qué decir mientras suena:**

> "Esto es lo que separa una demo de una plataforma. El agente no ha propuesto llamar: **ha
> llamado**."

Descolgar en altavoz y dejar que el agente de voz hable unos segundos (se presenta como el
centro de coordinación, dice qué incendio es, a qué distancia está el frente y qué pide al
ayuntamiento). Contestar "recibido, confirmamos" y colgar.

> "El guion de esa llamada no estaba escrito. Lo ha redactado el agente de Protección de
> Población con los datos de este incendio concreto: el nombre del pueblo, la distancia, el
> tiempo estimado hasta que llegue el frente.
>
> Y el resultado de la llamada vuelve: mirad el registro — *'el ayuntamiento confirma, activa
> el bando municipal'*. Eso cambia el estado del pueblo a 'avisado' en el mapa. La llamada no
> es un adorno: **cierra el bucle**."

Enseñar a la vez el SMS en la pantalla del móvil y el mensaje en el **chat de Telegram**
(quien apoya lo levanta): el mismo aviso por el canal ciudadano, con la ubicación del foco.

> "Telegram porque WhatsApp Business pide una verificación de Meta que no cabe en un
> hackathon. La API es la misma idea y el ciudadano puede contestar: si nos manda una foto o
> su ubicación, entra por la misma puerta que una llamada al 112 y la analiza el mismo agente
> de visión."

**Criterio:** actuación fuera del sistema. **Es el momento más fuerte de la demo: no correr.**

---

### Paso 5 · La cadena de auditoría y el acta exportada (0:40)

**Qué haces:** abrir **/auditoria**, buscar la decisión que acabas de aprobar y desplegar su
línea de tiempo. Pulsar **Exportar acta** y enseñar el Markdown que sale.

**Qué decir:**

> "Y ahora la pregunta que hace siempre alguien de la administración: *¿y esto quién lo ordenó?*
>
> Aquí está la cadena entera de esa llamada, hacia atrás. El acta de la acción, con el proveedor,
> la referencia del run y el resultado. Antes, quién la autorizó y cuándo se ordenó, separado de
> cuándo se ejecutó. Antes, el historial de la decisión estado por estado: cuándo se propuso,
> cuándo pasó a esperarme a mí, a qué hora la aprobé yo y con qué comentario. Y antes de todo eso,
> **la traza del ciclo del agente que la propuso**: qué datos tenía delante, a qué modelo llamó,
> cuánto tardó y qué le respondió.
>
> Cada acta lleva su huella SHA-256: si alguien la toca, deja de cuadrar. Y se escriben
> **siempre**, sin pasar por el modelo: la IA añade la narrativa encima, pero los hechos los pone
> el código. Si nos quedáramos sin clave de IA en mitad de una emergencia, seguiríamos teniendo el
> rastro completo de lo que el sistema hizo de verdad.
>
> Esto es un expediente. Se exporta en un Markdown y se adjunta."

**Criterio:** control humano y rigor. Frase de remate si hay tiempo: *"la diferencia entre una
demo y algo que una administración puede firmar es exactamente esta pantalla"*.

---

### Paso 6 · Gira el viento y se replanifica (1:00)

**Qué haces:** pulsar **Avanzar 1 h** en la barra del reloj (una o dos veces, hasta que la
previsión real traiga un cambio de dirección).

**Qué decir:**

> "Voy a adelantar el mundo una hora. Ojo: **no estoy inventando un viento**. La previsión
> horaria real de Open-Meteo para este punto ya dice que a esta hora el viento rola al
> noreste; lo único que hago es llegar antes a esa hora."

Esperar al banner: *"El frente ha girado 40° al NE: se replanifica"*.

> "Y mirad lo que ha pasado en cadena, sin que yo toque nada:
>
> El Meteorólogo ha detectado un giro de más de treinta grados y ha lanzado un evento. Eso ha
> despertado al Analista de propagación, que ha recalculado el perímetro, la predicción a
> una, tres y seis horas, y el tiempo que le queda a cada pueblo. Y eso ha despertado al
> Coordinador y a Protección de Población, que **han tirado sus propios planes anteriores** —
> esas decisiones pendientes ahora están marcadas como caducadas — y han propuesto otros.
>
> Fijaos en esta decisión nueva: dice *sustituye a* la anterior, y dice por qué. El pueblo que
> hace un momento estaba en riesgo medio ahora está en riesgo inminente y ha subido al primer
> puesto de mi bandeja."

**Criterio:** adaptación a un escenario cambiante. Recalcar: *"el escenario cambia solo,
nosotros no lo empujamos"*.

---

### Paso 7 · Segundo foco y análisis de patrones (0:55)

**Qué haces:** declarar un segundo foco a ~15-20 km del primero, con el mismo viento. Esperar
al Analista de patrones (cadencia 120 s; si hay prisa, **Forzar ciclo** desde su ficha).

**Qué decir:**

> "Un incendio se gestiona. Varios, a la vez, es otra cosa: hay que elegir.
>
> El Analista de patrones acaba de mirar los dos focos juntos: dos ignicions a quince
> kilómetros y menos de dos horas de diferencia, con el mismo viento, no es casualidad
> estadística. Los ha agrupado como **serie sospechosa** y propone avisar al SEPRONA. Ningún
> agente individual habría visto eso: lo ve porque hay un agente cuyo único trabajo es mirar
> el conjunto.
>
> Y el Coordinador ha reordenado las prioridades entre los dos focos — y **explica el orden**:
> este va primero porque amenaza a doscientas personas en cuarenta minutos, y el otro va
> después aunque sea más grande, porque va hacia el río. Las unidades que se mueven de un
> foco a otro son una decisión aparte, y esa sí pasa por mí."

**Criterio:** prioridad entre focos, creatividad de la solución.

---

### Paso 8 · Grafo de conocimiento: subir un documento y preguntarle (0:55)

**Qué haces:** ir a **/conocimiento**. Enseñar el grafo ya poblado (los cinco textos legales
de `data/protocolos/`: Ley 17/2015, Ley 43/2003, RD 893/2013, RD 524/2023, RD 393/2007).
Subir un `.md` corto preparado de antemano — el **plan INFOCAL de la comunidad**, o un
protocolo interno inventado por nosotros con una regla clara y llamativa, por ejemplo:
*"Los campings con más de 200 plazas se evacuan cuando el frente está a menos de 45 minutos,
sin esperar a la orden del director del plan."*

Mientras se procesa, preguntar en el buscador: **"¿quién puede ordenar la evacuación de un
pueblo?"** y enseñar la respuesta con sus citas y los chunks del grafo que se han consultado.

**Qué decir:**

> "Esto no es un chatbot de documentos. Esto es de dónde salen los fundamentos que habéis
> visto en cada decisión.
>
> Subo un protocolo — se trocea, se le calculan embeddings y se enlaza con lo que ya había, por
> entidades: organismos, roles, niveles. Y a partir de este segundo, **el Asesor Legal lo
> usa**: la próxima decisión que toque un camping va a citar esta regla, y si un agente propone
> algo que la contradice, la decisión sube automáticamente a competencia humana.
>
> Un director de emergencias puede subir el plan de su comunidad por la mañana y el sistema
> decide con él por la tarde. Sin tocar código."

**Criterio:** creatividad, fundamentación de las decisiones.

---

### Paso 9 · Cerrar la ejecución y ver el aprendizaje (1:15)

**Qué haces:** **Cerrar ejecución** en la barra superior. Ir a **/aprendizaje**.

**Qué decir:**

> "Cierro. El agente de Memoria hace el post-mortem.
>
> Aquí están las métricas de esta ejecución: cuántas decisiones se propusieron, cuántas salieron
> solas, cuántas pasé yo, cuántos minutos pasaron desde la detección hasta el primer aviso a un
> pueblo y hasta el primer camión en ruta. Esos son los números que le importan a un director
> de emergencias, no los tokens.
>
> Y aquí abajo están **las lecciones**. Mirad esta:" — señalar la que salió de la denegación
> del paso 3 — "*'Antes de proponer evacuación, verificar que el plan autonómico está activado
> y proponer confinamiento como paso previo'*. Origen: denegación humana. Eso lo ha sacado del
> motivo que yo escribí hace siete minutos.
>
> No es una nota en un documento. Está guardada con su embedding, y en la siguiente ejecución,
> cuando el agente de Protección de Población se enfrente a una situación parecida, **esta
> lección le llega dentro de su prompt**, recuperada por similitud. Si evita otra denegación,
> su peso sube. El sistema no repite el error que le corregí."

Si queda tiempo (30 s), pulsar **Nueva ejecución**, declarar un foco parecido y enseñar en el
visor del agente la línea *"lecciones aplicadas"* con esa misma lección. **Es el cierre más
fuerte que tiene la demo.** Si no hay tiempo, enseñar la comparativa con la ejecución anterior.

**Criterio:** aprendizaje.

---

## 4. Cierre (20 segundos)

> "Diecisiete agentes, datos reales de nueve fuentes públicas, decisiones fundamentadas en
> normativa, un humano que manda, ejecución real por teléfono, SMS y Telegram, un expediente
> auditable de cada cosa que se hizo, y un sistema que aprende de lo que ese humano le corrige.
>
> Y todo esto no es una maqueta: es un proceso Node con el estado en memoria que podéis
> desplegar hoy en Railway, en la UE, con inferencia europea. Gracias."

---

## 5. Planes B

| Si falla… | Qué hacer |
|---|---|
| La llamada de HappyRobot no entra | Seguir con el **SMS** y el **Telegram**, que llegan por otro camino. Enseñar en el registro la referencia del run y decir "ahí está el id de la llamada, la plataforma la ha aceptado" |
| Se cae el túnel de Cloudflare | Las llamadas y SMS **salientes** siguen funcionando (no dependen del túnel): solo se pierden los webhooks de resultado y el móvil. Reabrir el túnel en segundo plano y seguir |
| HelmCode va lento o devuelve 429 | Está saturado por los 17 agentes. **Pausar** los agentes de percepción que no hacen falta (prensa, satélite) desde su ficha: se liberan ranuras al instante |
| El Vigía no ve humo en la cámara del móvil | No insistir. Declarar el foco con el clic en el mapa, que es el camino principal, y enseñar el móvil como fuente de fotogramas en el panel de cámaras |
| No hay focos de FIRMS | Es lo normal en septiembre. Decirlo: *"hoy no hay ningún foco activo en España por satélite, y eso también es un dato real"* |
| Supabase no responde | La app sigue entera en memoria. Se pierde el paso 8 (aprendizaje): sustituirlo por enseñar las lecciones de la ejecución en curso, que están en el snapshot |
| La página `/auditoria` no está lista | Enseñar el mismo rastro desde `/informes` (el acta de la acción) y desde el visor del agente en `/agentes/[id]` (la traza del ciclo): los datos son los mismos, solo falta la vista que los encadena |
| Se acaba el tiempo | Sacrificar en este orden: paso 8 (conocimiento), paso 7 (patrones), paso 2 (visores). **Nunca** sacrificar el paso 4 (ejecución real), el 5 (auditoría) ni el 9 (aprendizaje) |

## 6. Atajos de teclado

| Tecla | Qué hace |
|---|---|
| `F` | Declarar foco (o clic en el mapa) |
| `A` | Aprobar la decisión seleccionada |
| `D` | Denegar (abre el cuadro del motivo, que es obligatorio) |
| `Espacio` | Pausa global del mundo |
| `Esc` | Cerrar el panel abierto |

## 7. Frases que cubren cada criterio del jurado

Si el jurado pregunta, o si hay que improvisar, estas son las respuestas de una frase:

| Criterio | Frase |
|---|---|
| **Decisión sin todos los datos** | "Con una coordenada y cero información previa, en treinta segundos tiene el entorno completo y ya está proponiendo. Y cuando no está seguro, lo dice: cada decisión lleva su nivel de confianza y sus evidencias con enlace." |
| **Prioridad** | "Con dos focos, el Coordinador ordena por población amenazada y tiempo hasta el frente, no por tamaño del incendio, y explica el orden en una frase." |
| **Adaptación** | "El viento gira según la previsión real y el sistema tira sus propios planes: las decisiones nuevas dicen a cuál sustituyen y por qué." |
| **Coordinación** | "Diecisiete agentes con cadencias distintas que se despiertan unos a otros por eventos. El Meteorólogo despierta a Propagación, que despierta al Coordinador." |
| **Ejecución real** | "Ha sonado mi teléfono. El agente de voz ha dicho el nombre del pueblo y el tiempo hasta el frente, y su respuesta ha cambiado el estado en el mapa." |
| **Control humano** | "Política de autonomía editable en caliente, pausar cualquier agente, asumir su control, y motivo obligatorio al denegar." |
| **Auditoría** | "Cada decisión en cada estado y cada acción ejecutada tienen su acta, con huella SHA-256 y compuesta sin pasar por el modelo. En /auditoria está la cadena entera, del ciclo del agente al resultado de la llamada, y se exporta como expediente." |
| **Creatividad** | "Un agente cuyo único trabajo es mirar varios focos a la vez y detectar una serie intencionada, y un grafo de normativa al que puedes subir el plan de tu comunidad y que cambia las decisiones al minuto siguiente." |
| **Aprendizaje** | "El motivo que escribí al denegar se convirtió en una lección con embedding, y en la siguiente ejecución le llega al agente dentro del prompt." |
