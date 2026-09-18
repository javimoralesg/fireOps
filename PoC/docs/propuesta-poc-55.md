# Propuesta de evolución de la PoC — sesión poc-55 (para acordar con poc-26)

Fecha: 2026-09-18. Reto: https://hackspain2026.happyrobot.ai/ ("¿Puede la IA gestionar una crisis?").

## 1. Qué pide el reto y dónde estamos

| Requisito obligatorio del reto | Estado actual (Fase 1+2) | Gap |
|---|---|---|
| Sistema agéntico que decide y actúa | Tarjeta única con plan mock; heurística regex en `recalcularPlan` | Falta razonamiento real (Claude) y encadenado de acciones |
| Escenario dinámico que evoluciona | Feed estático de 5 eventos | Falta motor de escenario con ticks / eventos nuevos que invalidan el plan |
| Cadenas de respuesta multi-paso | Un plan de N acciones aprobadas en bloque | Falta ejecutar acción a acción con estado y confirmaciones |
| Interacciones reales (llamadas, SMS, tickets, API) | `ejecutarPlan` mock (audioUrl null) | Falta al menos una acción real verificable en demo |
| UI con estado, acciones y puntos de intervención | ✅ Tres paneles + HITL aprobar/denegar/feedback | Falta cola de decisiones, informes, memoria |
| Bonus: aprender de interacciones pasadas | Restricciones acumuladas solo dentro del incidente | Falta memoria persistente entre decisiones e incidentes |

Criterios de evaluación: Decisión 33% · Ejecución 33% · Supervisión 33% (+ pitch al mismo nivel que el sistema).

Lo que Javi pide explícitamente:
1. Plataforma para que **los cargos** (alcalde, concejal de seguridad, director de emergencias) tomen la decisión final.
2. La plataforma **propone** y muestra los **datos reales** en los que se basa.
3. **Informes** generados automáticamente.
4. Botón **Ejecutar** (aplica la decisión) y botón **Denegar** con mensaje que **realimenta el sistema para el resto de decisiones**.
5. Orientado a **Estado / Ayuntamiento**.

## 2. Fuentes de datos reales verificadas hoy (sin clave, responden ahora mismo)

| Fuente | Endpoint | Qué aporta a la demo |
|---|---|---|
| Ayto. Madrid tráfico tiempo real | `https://informo.madrid.es/informo/tmadrid/pm.xml` | ~4.000 sensores: intensidad, ocupación, carga, nivelServicio, coords UTM. Permite "M-30 sur al 80% de saturación, cortar = colapso" |
| Open-Meteo (meteo) | `https://api.open-meteo.com/v1/forecast?latitude=40.39&longitude=-3.68&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m` | Viento real (dirección/velocidad) → dirección del humo / propagación |
| Open-Meteo (calidad aire) | `https://air-quality-api.open-meteo.com/v1/air-quality?...&current=pm10,pm2_5,carbon_monoxide` | PM2.5 / CO → decidir confinamiento vs evacuación |
| Red Eléctrica (REE) | `https://apidatos.ree.es/es/datos/demanda/demanda-tiempo-real?...` | Demanda nacional en tiempo real → escenario apagón / carga en subestación |
| IGN sismología | `https://www.ign.es/ign/RssTools/sismologia.xml` | Terremotos últimos 10 días (GeoRSS) → escenario sísmico alternativo |
| AEMET OpenData | requiere API key gratuita (registro en 2 min) | Avisos meteorológicos oficiales (CAP) |
| HappyRobot | docs con código de acceso (pedir a organizadores) | Llamadas de voz / chat / email reales |

Fallback para acciones reales si HappyRobot no está disponible: Twilio (SMS + llamada de voz con TwiML) o SendGrid email. Los tres son verificables en directo en el pitch.

## 3. Arquitectura propuesta (incremental, sin romper lo hecho)

Mantener Next.js App Router + Tailwind. **Quitar de la ruta crítica** ArangoDB, QuiverAI, FalAI y Exa: el grafo de ciudad vive en memoria (JSON) con la misma forma `NodoGrafo/AristaGrafo`, y la query AQL se sustituye por un BFS 1..3 en TypeScript que devuelve `ImpactoDomino[]` idéntico. Si sobra tiempo se conecta Arango; la UI no cambia.

```
app/api/
  estado/route.ts            GET  snapshot completo (eventos, grafo, cola de decisiones, doctrina)  [polling 2s o SSE]
  escenario/tick/route.ts    POST avanza el escenario (o lo hace un setInterval en servidor)
  decisiones/[id]/aprobar    POST ejecuta acciones (real: Twilio/HappyRobot) → genera informe
  decisiones/[id]/denegar    POST {feedback} → guarda regla en doctrina → Claude regenera
  informes/[id]/route.ts     GET  informe Markdown/HTML del incidente o de la decisión
  doctrina/route.ts          GET/DELETE reglas aprendidas
lib/server/
  escenario.ts               motor de escenario: guion de eventos con tiempo + inyección de datos reales
  conectores/{madridTrafico,openMeteo,ree,ign}.ts
  grafo.ts                   BFS efecto dominó
  proponente.ts              Claude: evidencia + grafo + doctrina → TarjetaDecision (tool use, JSON estricto)
  ejecutor.ts                acciones reales (sms, llamada, email, ticket) con resultado verificable
  doctrina.ts                memoria persistente (JSON en disco / Supabase si hay tiempo)
  informes.ts                SITREP + acta de decisión
```

Estado en servidor (singleton en memoria + persistencia JSON en `data/`) para que la demo sobreviva a recargas del navegador.

## 4. Funcionalidades nuevas con valor para el jurado

1. **Cola de decisiones priorizada** (no una tarjeta): cada decisión tiene urgencia, plazo (countdown), coste de no actuar y estado. El cargo ve "3 decisiones pendientes, 1 crítica en 4 min". Cubre "priorización bajo urgencia".
2. **Evidencia trazable**: cada propuesta lista las fuentes exactas (evento id, sensor id, valor, timestamp, URL) que la sustentan. Panel "¿En qué se basa?" con datos reales. Cubre "datos reales en que se basa".
3. **Ejecutar = acción real**: aprobar dispara SMS/llamada real al móvil de Javi (o del jurado) con el mensaje de alerta, y registra el SID de Twilio / id de HappyRobot como prueba. Cubre "interacciones reales".
4. **Denegar → Doctrina**: el feedback se convierte en una **regla persistente** ("No usar medios aéreos con viento > 40 km/h", "Priorizar siempre hospitales sobre tráfico") que Claude recibe en todas las propuestas futuras, de este incidente y de los siguientes. Panel "Doctrina aprendida" editable. Cubre el bonus de aprendizaje y "realimenta el resto de decisiones".
5. **Escenario dinámico con giro**: a los X minutos el viento cambia (dato real de Open-Meteo o forzado) y el sistema **invalida el plan v1 aprobado**, marca "revisión necesaria" y propone v2. Cubre "adaptación del plan".
6. **Informes automáticos**: (a) SITREP cada N minutos y (b) **Acta de decisión** por cada aprobar/denegar con: quién, cuándo, evidencia, alternativas descartadas, reglas aplicadas. Exportable (Markdown → PDF/print). Para una administración pública esto es responsabilidad legal y trazabilidad.
7. **Umbral de autonomía**: slider "la IA ejecuta sola acciones de riesgo ≤ X" (p. ej. avisos informativos) y pide firma humana por encima. Muestra "decide y actúa" sin perder supervisión.
8. **Comunicación pública**: la IA redacta el comunicado oficial y el texto ES-Alert (cell broadcast 112) para revisión del gabinete de prensa.
9. **Roles**: selector Alcalde / Director de Emergencias / Técnico 112 con permisos distintos (quién puede aprobar qué nivel de riesgo).
10. **Replay / timeline** para el pitch: barra de tiempo del incidente con eventos, decisiones y ejecuciones.

Prioridad para el fin de semana: 1, 2, 3, 4, 5, 6 son imprescindibles; 7 y 8 baratos; 9 y 10 si sobra tiempo.

## 4b. Qué hacer con la plataforma HappyRobot (Javi confirma que nos dan acceso)

HappyRobot es una plataforma de agentes de IA de voz / chat / email en producción. Es el proveedor del reto, así que usarla bien puntúa doble en "Ejecución" (acciones fuera del sistema) y en el pitch. Ideas, ordenadas por impacto:

1. **Línea ciudadana de ingesta (inbound)**: un número de teléfono atendido por un agente HappyRobot con guion "¿qué ves, dónde estás, hay heridos?". Al colgar, HappyRobot hace un webhook a nuestro `POST /api/ingest` con los campos extraídos (ubicación, tipo, gravedad, transcripción) y aparece como `EventoIngesta` con `fuente: "HappyRobot"` en el feed. **El jurado puede llamar en directo y ver su aviso entrar en el panel.** Es la demo más potente que podemos enseñar.
2. **Llamadas de verificación (outbound, multi-paso)**: al aprobar una decisión, el agente llama al hospital ("¿cuántas camas de urgencias libres tiene ahora?"), a la residencia de mayores ("¿pueden evacuar en 15 min? ¿cuántas personas con movilidad reducida?") o al parque de bomberos, obtiene respuestas estructuradas y las devuelve por webhook. **La respuesta realimenta la siguiente decisión** (si el hospital dice 2 camas, la IA redirige ambulancias). Cadena real: decidir → llamar → recibir dato → re-decidir.
3. **Aprobación por voz para el cargo ausente**: si una decisión crítica lleva N minutos sin firmar, HappyRobot llama al alcalde, le lee el resumen y la evidencia, y registra "aprobar / denegar + motivo" por voz. El motivo entra en la doctrina igual que el textarea. Intervención humana sin estar delante del panel.
4. **Escalado automático**: si el hospital no contesta en 2 min, llamar al hospital alternativo y anotarlo en el acta. Muestra "adaptación" y robustez.
5. **Aviso masivo por SMS / email** a listas (vecinos de la zona, colegios, prensa) con el texto que la IA redacta y el cargo aprueba. Referencia del envío guardada como prueba.
6. **Ticket / email al servicio municipal** (limpieza, movilidad, EMT) con instrucciones; cierre por respuesta por email que también entra por webhook.

Implementación: dos endpoints nuestros para webhooks (`POST /api/webhooks/happyrobot/ingesta` y `POST /api/webhooks/happyrobot/resultado`), verificación de firma si la plataforma la ofrece, y un `lib/server/conectores/happyrobot.ts` que dispara los use-cases (llamada saliente / SMS / email) con la API que nos den. Twilio se queda solo como fallback si algo falla el día del pitch.

Necesitamos de los organizadores: acceso a docs (código), API key, un número asignado, y saber si soportan webhooks al terminar la conversación (lo habitual en la plataforma).

## 5. Reparto propuesto

**poc-26 (dueña de la UI actual):**
- `components/*`, `app/page.tsx`, `lib/useHITL.ts` → pasar de tarjeta única a cola de decisiones + panel de evidencia + panel de doctrina + selector de rol.
- Cambiar `useHITL` para hablar con `/api/*` en vez de `orquestador-mock.ts` (contrato en `lib/types.ts`).
- Grafo: resaltar nodos por evidencia real (sensores de tráfico cercanos) y animar cambio de viento.

**poc-55 (yo):**
- `lib/server/*` y `app/api/*` completos (motor de escenario, conectores de datos reales, BFS, Claude, doctrina, informes, ejecutor).
- `lib/types.ts`: **solo añadir** tipos nuevos (`Evidencia`, `Decision`, `ReglaDoctrina`, `Informe`, `EstadoSistema`); no cambio los existentes sin avisar.
- `.env.example` y `docs/` (arquitectura, guion de demo).

Regla para no pisarnos: cada uno solo edita los archivos de su columna; cambios en `lib/types.ts` se anuncian por mensaje antes de hacerlos; commits pequeños y frecuentes en `main` (o dos ramas `ui` / `backend` con merge cada hora, lo que prefieras).

## 6. Contrato de tipos nuevos (propuesta)

```ts
export interface Evidencia {
  id: string;
  fuente: "MadridTrafico" | "OpenMeteo" | "REE" | "IGN" | "AEMET" | "HappyRobot" | "Ciudadano" | "FalAI" | "Exa";
  descripcion: string;      // "Sensor 3862 M-30 sur: carga 82%, nivelServicio 2"
  valor: string | number;
  timestamp: string;
  url?: string;             // enlace al dato original
  confianza: number;
}

export interface Decision {
  id: string;
  incidenteId: string;
  creadaEn: string;
  plazo: string;            // ISO: cuándo deja de tener sentido decidir
  urgencia: "critica" | "alta" | "media" | "baja";
  riesgo: number;           // 0..100, para el umbral de autonomía
  costeDeNoActuar: string;
  tarjeta: TarjetaDecision; // lo que ya existe
  evidencia: Evidencia[];
  reglasAplicadas: string[];  // ids de ReglaDoctrina
  estado: "pendiente" | "aprobada" | "denegada" | "ejecutando" | "ejecutada" | "invalidada" | "auto";
  resultadoEjecucion?: { accionId: string; canal: "sms" | "voz" | "email" | "ticket"; ref: string; ok: boolean }[];
}

export interface ReglaDoctrina {
  id: string;
  texto: string;            // feedback original del cargo
  reglaNormalizada: string; // versión reescrita por Claude como restricción
  origen: { decisionId: string; usuario: string; timestamp: string };
  activa: boolean;
  vecesAplicada: number;
}

export interface Informe {
  id: string;
  tipo: "sitrep" | "acta_decision";
  incidenteId: string;
  decisionId?: string;
  generadoEn: string;
  markdown: string;
}

export interface EstadoSistema {
  incidente: { id: string; titulo: string; iniciadoEn: string; tick: number; fase: string };
  eventos: EventoIngesta[];
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
  decisiones: Decision[];
  doctrina: ReglaDoctrina[];
  informes: Informe[];
  umbralAutonomia: number;
  rolActivo: "alcalde" | "director_emergencias" | "tecnico_112";
}
```

## 7. Claves necesarias (pedir a Javi)
- `ANTHROPIC_API_KEY` (imprescindible).
- HappyRobot: código de acceso a docs, API key, número asignado (Javi confirma que nos dan acceso).
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` solo como fallback.
- `AEMET_API_KEY` (opcional, gratuita).

## 8. Preguntas abiertas para poc-26
1. ¿De acuerdo con quitar Arango/Quiver/Fal/Exa de la ruta crítica y dejarlos como "conectores futuros"?
2. ¿Escenario único (incendio Méndez Álvaro) o dos escenarios seleccionables (incendio + apagón con datos REE)? Propongo uno bien hecho con giro dinámico.
3. ¿Polling cada 2 s a `/api/estado` o SSE? Propongo polling (más simple, suficiente para demo).
4. ¿Rama única o dos ramas?
