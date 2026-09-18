# Especificación de Arquitectura: Plataforma de Mando de Crisis AI (PoC Hackathon)

## 1. Contexto y Objetivo del Sistema
Desarrollar un "Centro de Mando de Crisis" (Human-in-the-Loop) integral para un hackathon. El sistema ingesta datos multimodales en tiempo real, calcula impactos en cascada mediante grafos y propone planes de acción que un operador humano debe aprobar, rechazar o modificar.

## 2. Stack Tecnológico
- **Frontend:** Next.js (App Router), Tailwind CSS, Lucide-React. Despliegue en **Vercel**.
- **Backend / Orquestador:** Next.js API Routes (Serverless) o microservicios Node.js/Python en **Railway**.
- **Base de Datos de Grafos:** **ArangoDB** (nodos y aristas para impacto en cascada).
- **IA y Modelos (Enrutador Dinámico):**
  - Claude: razonamiento profundo y generación de consultas AQL complejas.
  - Modelos ligeros: enrutamiento y extracción de entidades de baja latencia.
- **Ingesta Externa:** **Exa** (búsqueda de reportes en RRSS).
- **Visión Artificial:** **FalAI** (procesamiento de imágenes).
- **RAG / Memoria:** **QuiverAI** (protocolos de emergencia).
- **Ejecución y Alertas:** **ElevenLabs** (TTS) y **Cloudflare R2** (almacenamiento S3-compatible).

## 3. Estructura de Base de Datos (ArangoDB)
- **Vértices:** `Incidencias`, `Infraestructuras` (Hospitales, Carreteras), `Efectivos` (Bomberos, Policía).
- **Aristas:** `BLOQUEA_A`, `SUMINISTRA_A`, `DESPLEGADO_EN`.
- **Query (Efecto Dominó):**
  ```aql
  FOR v, e, p IN 1..3 OUTBOUND @incidente_id GRAPH 'Ciudad_Graph'
    FILTER v.tipo IN ['Hospital', 'Centro_Comunicaciones', 'Ruta_Evacuacion']
    LET nivel_gravedad = (4 - LENGTH(p.edges)) * 25
    SORT nivel_gravedad DESC
    RETURN { infraestructura: v.nombre, riesgo: nivel_gravedad, ruta: p.vertices[*].nombre }
  ```

## 4. Arquitectura del Orquestador (Backend API)
Endpoint principal `/api/ingest`:
1. Recibe un payload multimodal (texto del ciudadano + imagen).
2. **FalAI** procesa la imagen y extrae contexto (ej. "fuego detectado").
3. **Exa** busca contexto geolocalizado reciente.
4. **QuiverAI** devuelve el protocolo aplicable.
5. **Claude** sintetiza todo y genera el `Plan_Propuesto`.
6. Retorna el objeto `Tarjeta_Decision` al frontend.

## 5. UI/UX: Dashboard del Comandante (Human-in-the-Loop)
Página principal (`/app/page.tsx`) con 3 secciones:
- **Panel Izquierdo (Feed Ingesta):** eventos entrantes de Exa y FalAI.
- **Centro (Visualización):** grafo de la ciudad con zona cero y efectivos cercanos (datos de ArangoDB).
- **Panel Derecho (Tarjeta de Decisión):** Resumen, Efecto Dominó y Plan de la IA.
  - **Aprobar:** llama a `/api/execute` → ElevenLabs genera audio → sube a Cloudflare R2 → devuelve URL `.mp3` que se reproduce en el frontend.
  - **Denegar/Modificar:** abre un `textarea` con feedback → POST `/api/recalculate` → Claude genera un nuevo plan que respete la restricción.

## 6. Plan de Implementación
- **Fase 1:** Scaffolding, layout, Tailwind, tres paneles con datos estáticos. ✅
- **Fase 2:** Estado React para el flujo HITL (Aprobar, Denegar con feedback, Recalcular). ✅
- **Fase 3:** API Routes (`/api/ingest`, `/api/execute`, `/api/recalculate`) con stubs/mocks.
- **Fase 4:** Llamadas reales vía `process.env`; subida a R2 con el SDK de AWS S3.
