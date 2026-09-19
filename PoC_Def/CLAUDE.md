@AGENTS.md

# Atalaya Incendios · guía para sesiones de Claude

- Plataforma agéntica de gestión de incendios forestales en España (HackSpain 2026). Lee `docs/ARQUITECTURA.md` (principios, agentes, flujos, UX, API) y `docs/REPARTO.md` (dueño de cada carpeta, contratos, entregas) antes de tocar nada.
- Contrato compartido: `lib/dominio/tipos.ts`, `lib/motor/{contratos,estado,traza}.ts`. Solo cambios aditivos (campos opcionales) y anotados en REPARTO.md.
- Todo en español (código, comentarios, UI). Nada simulado: sin proveedor → error visible. Ver `docs/CLAVES.md` para obtener claves y `.env.example` para variables.
- IA de la app: HelmCode (API compatible OpenAI) vía `lib/ia/llm.ts`; embeddings 512 dims; datos en Supabase (`lib/db/schema.sql`). Voz/SMS/email: HappyRobot (`docs/HAPPYROBOT.md`); mensajería: Telegram (`docs/TELEGRAM.md`).
- No hacer commits salvo petición expresa de Javi. Subagentes de desarrollo solo con modelo Opus.
- Demo: `docs/GUIA-DEMO.md`. Despliegue en Railway: `docs/DESPLIEGUE.md`.
