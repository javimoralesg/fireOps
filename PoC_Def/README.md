# Atalaya Incendios

Sala de mando para incendios forestales en España.

Atalaya vigila a la vez varias fuentes públicas —satélites, cámaras de carretera, prensa y redes
sociales, llamadas al 112, avisos de ciudadanos—, sitúa cada fuego en el mapa y reúne lo que tiene
alrededor: pueblos, parques de bomberos, hospitales y el viento real. Con eso calcula hacia dónde
avanza el frente, a qué pueblos llegará y cuándo. Un equipo de agentes propone y ejecuta la
respuesta: mandar medios por carreteras reales, avisar a los pueblos por SMS, publicar
comunicados, pedir medios aéreos. Manda una persona: una política define qué puede hacer la
máquina sola y qué tiene que aprobar un humano, y todo lo que ocurre queda escrito.

Nada está simulado. Los focos, la meteorología, las carreteras, los parques de bomberos, los
mensajes y las llamadas son reales. Cuando un servicio falla, se ve el fallo en pantalla en lugar
de un resultado inventado.

Al final de este documento hay [capturas de todo lo que se cuenta aquí](#capturas).

## Qué hace

**Se entera de que hay fuego, por cinco caminos a la vez.** Los focos térmicos del satélite,
agrupados y limpios de fuentes fijas como refinerías. Las cámaras de tráfico de la DGT y de
Madrid, unas dos mil trescientas, que se vigilan solas cuando están cerca de un incendio, y
cualquier teléfono convertido en cámara escaneando un QR. Un número de teléfono atendido por un
agente de voz en español, que registra el aviso mientras la persona habla. Las noticias y las
redes, de las que se extrae el municipio, las hectáreas y los medios que trabajan. Y un formulario
corto para quien ve humo y no sabe explicar dónde está.

Ninguna fuente se cree a sí misma: una noticia no confirma a otra noticia, con humo hacen falta
dos análisis seguidos de la cámara y un foco nacido de prensa entra como detectado, no como
confirmado.

**Calcula hacia dónde va.** El frente se estima con el viento, la humedad, la temperatura, la
pendiente y el combustible del terreno, y se proyecta a una, tres y seis horas. De ahí sale lo que
importa: qué pueblos están en la trayectoria y cuánto tarda el fuego en llegar a cada uno.

**Manda medios de verdad.** Las unidades salen de parques de bomberos reales sacados del mapa y
viajan por carretera real, con su ruta, su distancia y su hora de llegada. La primera salida se
despacha sola, por doctrina; el resto se propone y se revisa.

**Avisa a la gente.** Cuando un pueblo entra en riesgo se redacta el mensaje —distinto si es aviso
preventivo, confinamiento o evacuación— y se envía por SMS o Telegram, con su acuse de entrega. En
paralelo, el portavoz publica los comunicados oficiales en un portal público, traducidos al inglés
y a la lengua cooficial.

**Deja decidir a quien manda.** Las decisiones que pesan llegan a un panel con el razonamiento del
agente, las evidencias, los artículos que las amparan y la nota del supervisor. Al denegar hay que
explicar por qué, y ese motivo se convierte en una lección que los agentes reciben la próxima vez.

**Escribe lo que hace.** De cada decisión y de cada acción queda un acta con su huella, aunque la
IA no esté disponible. Detrás de cada una se puede recorrer la cadena entera: qué vio el agente,
qué modelo consultó, qué propuso, quién lo aprobó y qué pasó al ejecutarlo.

## Cómo funciona por dentro

Un solo proceso lleva el mundo en memoria. Cada cinco segundos, un tick mueve el reloj y despierta
a los agentes que toca, por su cadencia o porque ha pasado algo: entra una observación, gira el
viento, llega una unidad. La pantalla se actualiza sola.

El reloj va acelerado: doce minutos de mundo por cada minuto real, y se puede pausar o adelantar.
Como la meteorología se lee de la previsión horaria real según esa hora, al acelerar el viento gira
de verdad, y ese giro obliga a recalcular el fuego y a replantear el despliegue.

Son dieciséis agentes:

| Agente | Qué hace |
|---|---|
| Vigilancia satelital | Focos térmicos de la NASA, agrupados y limpios de fuentes fijas |
| Vigía de cámaras | Mira cámaras de la DGT, de Madrid y de móviles buscando humo o llamas |
| Prensa y redes | Noticias y publicaciones: extrae el incendio y lo sitúa |
| Centralita | Recoge los avisos de personas: llamada, Telegram, formulario |
| Meteorólogo | Viento, temperatura y humedad por foco, índice de peligro y avisos oficiales |
| Verificador | Cruza fuentes, descarta duplicados y decide si se declara un foco |
| Analista de propagación | Avance del fuego, predicción, llegada a cada pueblo y cierre de perímetro |
| Analista de patrones | Varios focos cerca: mismo incendio, serie sospechosa o convergencia |
| Coordinador de medios | Plan de medios con tiempos de carretera reales; replanifica cuando cambia algo |
| Protección de población | Pueblo a pueblo: avisar, confinar o evacuar, con el mensaje redactado |
| Asesor legal | Fundamentos y alertas legales; una alerta obliga a decisión humana |
| Despachador | Mueve cada unidad por su ruta, hasta el fuego y de vuelta |
| Portavoz | Comunicados oficiales y sus traducciones |
| Supervisor de calidad | Puntúa cada decisión antes de ejecutarla y escala lo que no convence |
| Memoria y aprendizaje | Convierte las correcciones humanas en lecciones |
| Redactor de informes | Actas y partes de situación |

## Estructura

```
.
├── app/                  páginas y API
│   ├── api/              unas sesenta rutas: estado, focos, decisiones, webhooks, salud
│   ├── agentes/          el equipo y la ficha de cada agente
│   ├── incidencias/      lista de focos y visor de cada uno
│   ├── auditoria/        registro y cadena de cada decisión
│   ├── informes/         actas y partes
│   ├── conocimiento/     buscador de normativa y grafo
│   ├── aprendizaje/      ejecuciones, métricas y lecciones
│   ├── politica/         qué puede hacer la IA sola
│   ├── publico/          portal ciudadano
│   ├── parte/            formulario de aviso
│   ├── movil/            el teléfono como cámara de vigilancia
│   └── page.tsx          la sala de mando
├── components/           la interfaz, por pantalla (sala, mapa, agentes, incidencia, público…)
├── lib/
│   ├── dominio/          tipos compartidos, política y contorno de España
│   ├── motor/            orquestador, estado, reloj, trazas, actas, enriquecimiento
│   ├── agentes/          los dieciséis agentes, por cometido
│   ├── fuentes/          servicios reales: meteorología, mapas, rutas, satélite, cámaras, prensa
│   ├── simulacion/       propagación, contención, fusión de focos, geometría
│   ├── ia/               llamadas al modelo y embeddings
│   ├── conocimiento/     indexado y consulta de la normativa
│   ├── aprendizaje/      lecciones y comparativa entre ejecuciones
│   ├── happyrobot/       voz, SMS y email
│   ├── telegram/         mensajería
│   ├── db/               cliente, repositorio y schema.sql
│   └── cliente/          hooks del navegador
├── data/
│   ├── protocolos/       normativa indexable
│   ├── conocimiento/     índice de búsqueda
│   └── aprendizaje/      lecciones y ejecuciones
├── scripts/              túnel, arranque para móvil, siembra, comprobaciones
├── tests/                unitarias, de integración y de interfaz
├── capturas/             las imágenes de este README
└── .env.example          plantilla de configuración
```

## Ponerlo en marcha

Hace falta Node 22.12 o superior (está desarrollado con Node 24, que es lo que fija `.nvmrc`) y
una clave del proveedor de IA. Sin ella arrancan las pantallas y los agentes que no razonan, pero
poco más.

```bash
npm install
cp .env.example .env.local   # y rellenar
npm run sembrar              # indexa la normativa de data/protocolos
npm run dev                  # http://localhost:3000
```

`http://localhost:3000/api/salud` es el semáforo: cada servicio con su estado y, si falla, el
motivo exacto. Lo mismo en texto con `npm run comprobar`.

La primera vez la sala aparece vacía, porque no hay ningún incendio activo, y en invierno puede
seguir vacía un buen rato: el satélite no se inventa focos. Para ver el sistema entero trabajando,
declara uno a mano con la tecla `F` sobre el mapa; nace confirmado y el resto se pone en marcha
solo.

### Configuración

Todo va en `.env.local`, a partir de `.env.example`. Lo único imprescindible es la IA; lo demás
añade capacidades, y lo que falte aparece apagado en vez de romper nada.

| Bloque | Variables | Sin esto |
|---|---|---|
| IA | `LLM_PROVEEDOR`, `HELMCODE_API_KEY`, `LLM_MODELO_RAZONAMIENTO`, `LLM_MODELO_RAPIDO`, `LLM_MODELO_VISION` | no razona nadie |
| Embeddings | `EMBEDDINGS_PROVEEDOR`, `EMBEDDINGS_MODELO`, `EMBEDDINGS_DIMENSIONES` | no hay buscador de normativa ni lecciones |
| Base de datos | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PERSISTIR` | todo vive en memoria y se pierde al reiniciar |
| SMS y 112 | `HAPPYROBOT_API_KEY`, `HAPPYROBOT_API_BASE`, `HAPPYROBOT_ENVIRONMENT`, `HAPPYROBOT_WEBHOOK_SECRET`, `HAPPYROBOT_WORKFLOW_SLUG_SMS`, `HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE`, `HAPPYROBOT_NUMERO_ENTRANTE`, `TELEFONO_AVISOS_SMS` | no hay avisos a los pueblos ni teléfono de emergencias |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_CHAT_ID_DEMO` | no hay canal de mensajería |
| Detección | `FIRMS_MAP_KEY`, `AEMET_API_KEY`, `EXA_API_KEY` | no hay satélite, avisos oficiales ni buscador de noticias |
| Mundo | `ACELERACION_TIEMPO`, `TICK_MS`, `CAMARAS_INTERVALO_SEG` | valores por defecto: ×12, 5 s y 20 s |
| Marca y dominio | `ORGANISMO_NOMBRE`, `PUBLIC_BASE_URL` | el nombre por defecto y, en local, la URL del túnel |

Funcionan sin ninguna clave: la meteorología, los mapas y el entorno de cada foco, las rutas por
carretera, la geocodificación, las cámaras de la DGT y de Madrid, los avisos de Meteoalarm, las
noticias y las redes.

### La base de datos

Es opcional para probar: sin ella todo vive en memoria. Con ella se guardan la ejecución, las
actas, el conocimiento y las lecciones. Para prepararla, pega `lib/db/schema.sql` en el editor SQL
del proyecto y ejecútalo; se puede repetir sin miedo.

### El móvil y los webhooks

```bash
npm run dev:movil
```

Levanta el servidor, abre un túnel con HTTPS, apunta el bot de Telegram a la dirección nueva y
resincroniza el agente de voz. Hace falta para tres cosas: que el teléfono pueda usar cámara y
ubicación (el navegador las exige bajo HTTPS), que las llamadas y los SMS puedan devolver su
resultado, y que el QR de la sala funcione.

#### El teléfono del 112 y los SMS (HappyRobot)

Hace falta una organización en `https://platform.eu.happyrobot.ai` con una clave de API
(**Settings → API keys**; empieza por `sk_live_`) y un número de teléfono comprado en
**Phone numbers**: es el que atiende las llamadas y desde el que salen los SMS. En `.env.local`
van `HAPPYROBOT_API_KEY`, un `HAPPYROBOT_WEBHOOK_SECRET` inventado (`openssl rand -hex 24`) y
`TELEFONO_AVISOS_SMS`, el móvil en formato `+34…` que recibirá los SMS del agente. Los slugs de los
workflows y el número no se rellenan a mano: los escribe el script que los monta y publica.

```bash
node scripts/happyrobot-workflows.mjs sms        # monta y publica «Atalaya · SMS saliente» → HAPPYROBOT_WORKFLOW_SLUG_SMS
npm run dev:movil                                # con la clave puesta, al abrir el túnel crea y sincroniza «Atalaya · 112 entrante»
node scripts/happyrobot-workflows.mjs entrante   # lo mismo a mano, con el túnel abierto → HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE y HAPPYROBOT_NUMERO_ENTRANTE
node scripts/happyrobot-workflows.mjs estado     # qué workflows hay en la plataforma y cuáles están publicados
node scripts/happyrobot-workflows.mjs sms-prueba +34600000000 "Prueba"   # manda un SMS de verdad y enseña el run
```

El 112 entrante necesita la URL pública del túnel, porque el agente de voz llama a Atalaya durante
la llamada; por eso `npm run dev:movil` lo vuelve a sincronizar cada vez que la URL cambia. Si la
organización tiene varios números, `HAPPYROBOT_NUMERO_ENTRANTE` elige cuál atiende. Después de que
el script escriba en `.env.local` hay que reiniciar el servidor.

Comprobación final: `curl -s http://localhost:3000/api/happyrobot/salud` dice qué canales están
configurados, qué workflows existen y cuáles están publicados. En la sala, la barra de servicios
enseña en rojo lo que falte, con el nombre exacto de la variable.

### Pruebas

```bash
npm test                   # las tres baterías
npm run test:unit          # deterministas, sin red, rápidas
npm run test:integracion   # necesita un servidor vivo y claves reales
npm run test:ui            # recorre las pantallas con un navegador
```

### Despliegue

Pensado para Railway: `npm run build`, `npm run start`, comprobación de salud en `/api/salud` y
**una sola réplica**, porque el mundo está en memoria y dos réplicas serían dos mundos distintos.
Al cambiar de dominio hay que fijar `PUBLIC_BASE_URL` y volver a apuntar los webhooks
(`node scripts/happyrobot-workflows.mjs sincronizar` para el 112 entrante).

## Conviene saber

- **Los envíos son de verdad.** El teléfono y el correo de cada ayuntamiento salen de
  OpenStreetMap, así que un aviso puede acabar en el ayuntamiento real. Antes de una demostración,
  conviene mirar los destinos.
- **Un solo proceso.** Al reiniciar se abre una ejecución nueva, salvo que la persistencia esté
  activada, y no se pueden levantar dos servidores de desarrollo sobre la misma carpeta.
- **La voz saliente está desactivada** porque el número contratado no puede llamar a España: los
  avisos salen por SMS. Las llamadas entrantes sí funcionan.
- **La prensa sitúa el fuego en el centro del municipio**, que es lo único que da una noticia.
- **En septiembre puede no haber ningún foco real en el satélite**, y ese también es un resultado
  correcto.

## Capturas

### La sala de mando

<img src="capturas/sala-general.jpg" width="820" alt="Sala de mando">

El mapa con los focos, el viento, los pueblos por riesgo y los medios, y a la derecha lo que la
sala necesita del humano.

### Detección

<img src="capturas/deteccion-imagen.jpg" width="820" alt="Detección por imagen desde el móvil">

Un teléfono haciendo de cámara: manda un fotograma cada diez segundos y el modelo responde qué ve.
Con llamas claras, el foco nace confirmado en segundos.

<img src="capturas/deteccion-entrada.jpg" width="560" alt="Imagen analizada">

La imagen que provocó esa detección.

<img src="capturas/llamada-112.jpg" width="820" alt="Incidencia nacida de una llamada">

Una incidencia abierta desde una llamada al 112: el aviso queda registrado mientras la persona
habla.

<img src="capturas/incidencia-prensa.jpg" width="820" alt="Incidencia creada desde prensa">

Un incendio detectado en la prensa, con el medio y el enlace a la noticia.

<img src="capturas/recorte-prensa.jpg" width="700" alt="Recorte del periódico">

La noticia de la que salió.

<img src="capturas/incidencia-rrss.jpg" width="820" alt="Incidencia creada desde redes">

Lo mismo desde redes sociales.

<img src="capturas/recorte-rrss.jpg" width="700" alt="Publicación original">

La publicación original.

<img src="capturas/parte-ciudadano.jpg" width="560" alt="Parte ciudadano">

El formulario para quien ve humo.

### El incendio

<img src="capturas/propagacion-1.jpg" width="820" alt="Propagación del incendio">

El perímetro y la predicción del frente a una, tres y seis horas.

<img src="capturas/propagacion-2.jpg" width="820" alt="El mismo incendio más tarde">

Cuarenta y cinco minutos de mundo después: de 23 a 73 hectáreas, y las brigadas empezando a cerrar
perímetro.

<img src="capturas/unidades.jpg" width="820" alt="Unidades desplegadas">

Los medios desplegados, con la ficha de una patrulla: qué orden recibió, quién la autorizó y
cuánto le queda.

<img src="capturas/extincion.jpg" width="820" alt="Incendio extinguido">

El cierre: perímetro controlado al cien por cien, la cronología de estabilizado a extinguido y las
brigadas de vuelta a base.

### Quién decide

<img src="capturas/decision-humano.jpg" width="820" alt="Decisión pendiente de aprobación">

Una decisión esperando firma, con el porqué, las evidencias, los fundamentos legales y la nota del
supervisor.

<img src="capturas/politica.jpg" width="820" alt="Política de autonomía">

Qué se hace solo y qué no, editable en caliente.

### Avisos y comunicados

<img src="capturas/sms.jpg" width="820" alt="SMS a un ayuntamiento">

El acta de un aviso por SMS, con el texto exacto que salió y quién lo autorizó.

<img src="capturas/sms-entrega.jpg" width="820" alt="Acuse de entrega">

Y lo que contestó la operadora: enviado, entregado o fallido.

<img src="capturas/telegram.jpg" width="820" alt="Difusión por Telegram">

La misma difusión por Telegram.

<img src="capturas/comunicados-publico.jpg" width="820" alt="Comunicados oficiales">

Los comunicados oficiales: qué pasa, qué se está haciendo, qué debe hacer la gente y a quién
llamar.

<img src="capturas/portal-ciudadano.jpg" width="820" alt="Portal ciudadano">

El portal público, con los incendios activos y las dos formas de dar aviso.

### Agentes, normativa y memoria

<img src="capturas/grafo-agentes.jpg" width="820" alt="Flujo de agentes">

Por dónde va cada incidencia y qué agente le da el relevo a cuál.

<img src="capturas/agentes.jpg" width="820" alt="Equipo de agentes">

El equipo al completo: cada agente se puede inspeccionar, pausar o asumir.

<img src="capturas/grafo-conocimiento.jpg" width="820" alt="Grafo de conocimiento">

La normativa indexada y enlazada, con las referencias que unos artículos hacen a otros.

<img src="capturas/aprendizaje.jpg" width="820" alt="Lecciones aprendidas">

Las lecciones: de dónde salió cada una, a quién se aplica y cuántas veces ha servido.

### Lo que queda escrito

<img src="capturas/auditoria.jpg" width="820" alt="Registro de la ejecución">

El registro completo de una ejecución.

<img src="capturas/informes.jpg" width="820" alt="Actas e informes">

Las actas, con su huella y su trazabilidad.

<img src="capturas/incidencia.jpg" width="820" alt="Visor de una incidencia">

Y el expediente de cada incidencia: el flujo de agentes, el hilo cronológico y el informe en vivo.
