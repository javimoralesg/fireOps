// =====================================================================
// 112 virtual por TELÉFONO (HappyRobot): lo que hacen las herramientas del agente
// de voz contra el servidor VIVO. Caso (o). DUEÑO: sesión fireops-82 (2026-09-19).
// No hay teléfono en la batería: se manda EXACTAMENTE lo que mandan los nodos
// Webhook del workflow (mismos nombres de campo, misma cabecera). Nominatim y la
// IA son reales.
// =====================================================================
import { describe, expect, it } from "vitest";
import type { Observacion, Snapshot } from "@/lib/dominio/tipos";
import { api, esperarHasta, medir, obtener, snapshot } from "./ayudas";

const SECRETO = process.env.HAPPYROBOT_WEBHOOK_SECRET ?? "";
const RUN = `prueba-o-${Date.now().toString(36)}`;
const cabeceras = { "content-type": "application/json", "x-webhook-secret": SECRETO };

async function post(ruta: string, cuerpo: unknown, conSecreto = true) {
  const r = await fetch(`${process.env.ATALAYA_URL ?? "http://localhost:3100"}${ruta}`, {
    method: "POST",
    headers: conSecreto ? cabeceras : { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const texto = await r.text();
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    json = undefined;
  }
  return { estado: r.status, texto, json: json as Record<string, unknown> | undefined };
}

const deLlamada = (s: Snapshot) => s.observaciones.filter((o) => o.canal === "llamada" && o.referenciaExterna === RUN);

describe("Llamada entrante al 112 virtual · herramientas del agente de voz", () => {
  it("(o) sin la cabecera x-webhook-secret, registrar_aviso responde 401", async () => {
    expect(SECRETO, "falta HAPPYROBOT_WEBHOOK_SECRET en .env.local").not.toBe("");
    const r = await post("/api/happyrobot/aviso", { municipio: "Navalacruz", que_ve: "humo" }, false);
    expect(r.estado).toBe(401);
  }, 60_000);

  it("(o) registrar_aviso crea la observación de la llamada, la sitúa con Nominatim y contesta al agente", async () => {
    const t0 = Date.now();
    const r = await post("/api/happyrobot/aviso", {
      run_id: RUN,
      canal: "llamada",
      telefono: "",
      telefono_llamante: "+34600000000",
      municipio: "Navalacruz",
      lugar: "N-403 km 62, junto a la ermita",
      que_ve: "Una columna de humo negro que sube desde el pinar y avanza hacia el pueblo",
      tipo: "humo",
      personas_en_riesgo: "no",
      viviendas_cerca: "sí",
      tamano: "como un campo de fútbol",
    });
    const ms = Date.now() - t0;
    expect(r.estado, r.texto.slice(0, 300)).toBe(200);
    const j = r.json!;
    medir("(o) registrar_aviso", ms, `impacto=${String(j.impacto)} · extracción=${String(j.extraccion)} · enAnalisis=${String(j.enAnalisis)} · geolocalizada=${String(j.geolocalizada)}`);
    expect(j.registrado).toBe(true);
    expect(typeof j.observacionId).toBe("string");
    expect(typeof j.mensajeParaLocutor).toBe("string");
    expect((j.mensajeParaLocutor as string).length).toBeGreaterThan(40);
    expect(j.mensajeParaLocutor as string).toMatch(/Aléjese del humo/);
    // Navalacruz existe: Nominatim real tiene que situarlo (si no, la prueba falla y lo dice).
    expect(j.geolocalizada, "Nominatim no situó Navalacruz").toBe(true);
    // La herramienta no puede colgar la llamada: responde dentro del tope de espera.
    expect(ms).toBeLessThan(35_000);

    const obs = deLlamada(await snapshot());
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ canal: "llamada", remitente: "+34600000000", referenciaExterna: RUN });
    expect(obs[0].texto).toContain("Qué ve: Una columna de humo negro");
    expect(obs[0].punto).toBeTruthy();
  }, 180_000);

  it("(o) el verificador deja veredicto explicado en ≤ 90 s (foco nuevo, confirmación o registrada)", async () => {
    const { valor, ms } = await esperarHasta(
      "la observación de la llamada tiene impacto",
      (s) => {
        const o = deLlamada(s)[0];
        return o?.impacto ? o : undefined;
      },
      90_000,
      1500,
    );
    medir("(o) veredicto", ms, `${valor.impacto} · ${(valor.verificacion ?? "").slice(0, 160)}`);
    expect(["nuevo_foco", "confirma", "agrava", "duplicada", "registrada", "ruido"]).toContain(valor.impacto);
    expect((valor.verificacion ?? "").trim().length).toBeGreaterThan(20);
    if (valor.impacto === "nuevo_foco" || valor.impacto === "confirma" || valor.impacto === "agrava") {
      const s = await snapshot();
      const inc = s.incendios.find((i) => i.id === valor.incendioId);
      expect(inc, "la observación apunta a un foco que no existe").toBeTruthy();
      medir("(o) foco", ms, `${inc!.nombre} · ${inc!.municipio} · ${inc!.estado} · confianza ${inc!.confianza}`);
    }
  }, 120_000);

  it("(o) al colgar, la transcripción se ADJUNTA a la misma observación: ninguna segunda", async () => {
    const antes = deLlamada(await snapshot());
    const r = await post("/api/webhooks/happyrobot/llamada", {
      run_id: RUN,
      canal: "llamada",
      telefono: "+34600000000",
      transcripcion: "Operador: Emergencias, ciento doce. Ciudadano: veo una columna de humo negro en la N-403, cerca de Navalacruz.",
      duracion_seg: "74",
      fin: "hangup",
    });
    expect(r.estado, r.texto.slice(0, 300)).toBe(200);
    expect(r.json).toMatchObject({ recibido: true, adjuntada: true, observacionId: antes[0].id });
    const despues = deLlamada(await snapshot());
    expect(despues).toHaveLength(1);
    expect(despues[0].texto).toContain("Transcripción completa de la llamada:");
    medir("(o) transcripción adjuntada", 0, despues[0].id);
  }, 60_000);

  it("(o) consultar_zona (POST /api/happyrobot/contexto) contesta con incendios cercanos y consejo", async () => {
    const t0 = Date.now();
    const r = await post("/api/happyrobot/contexto", { lugar: "Navalacruz, Ávila", canal: "llamada", run_id: RUN }, false);
    expect(r.estado, r.texto.slice(0, 300)).toBe(200);
    const j = r.json as { incendiosCercanos: unknown[]; consejoGeneral: string };
    medir("(o) consultar_zona", Date.now() - t0, `${j.incendiosCercanos.length} cercano(s) · ${j.consejoGeneral.slice(0, 120)}`);
    expect(Array.isArray(j.incendiosCercanos)).toBe(true);
    expect(j.consejoGeneral.length).toBeGreaterThan(20);
  }, 120_000);

  it("(o) situar_lugar sitúa la dirección dictada en la llamada real (número en letras y coletilla del reconocimiento) en la ETSIT", async () => {
    const t0 = Date.now();
    const r = await post("/api/happyrobot/situar", { lugar: "Avenida Complutense treinta, Técnica Superior de Ingeniería de Autorcomunicación", municipio: "Madrid", run_id: RUN });
    expect(r.estado, r.texto.slice(0, 300)).toBe(200);
    const j = r.json as { encontrado: boolean; precision: string; lat: number; lon: number; nombre: string; mensajeParaLocutor: string; consulta: string };
    medir("(o) situar_lugar", Date.now() - t0, `${j.precision} · ${j.nombre} · ${j.lat}, ${j.lon} · ${j.consulta}`);
    expect(j.encontrado).toBe(true);
    expect(j.precision).toBe("direccion");
    // Ciudad Universitaria (ETSIT), no la Puerta del Sol (40,4168, -3,7035), que es donde caía antes.
    expect(j.lat).toBeGreaterThan(40.44);
    expect(j.lat).toBeLessThan(40.46);
    expect(j.lon).toBeGreaterThan(-3.74);
    expect(j.lon).toBeLessThan(-3.71);
    expect(j.mensajeParaLocutor).toBe("Lo tengo en Avenida Complutense 30, Madrid. ¿Es ahí?");
    // Sin secreto, 401.
    expect((await post("/api/happyrobot/situar", { lugar: "Madrid" }, false)).estado).toBe(401);
  }, 120_000);

  it("(o) un webhook de colgar con las variables sin resolver (prueba de la plataforma) no crea ninguna observación", async () => {
    const antes = (await snapshot()).observaciones.length;
    const r = await post("/api/webhooks/happyrobot/llamada", { run_id: "", run_url: "", en: "2026-09-19T15:30:21Z", canal: "llamada", telefono: "", transcripcion: "", duracion_seg: "", fin: "" });
    expect(r.estado).toBe(200);
    expect(r.json).toMatchObject({ recibido: false });
    expect((await snapshot()).observaciones.length).toBe(antes);
  }, 60_000);

  it("(o) /api/happyrobot/salud informa del 112 entrante (número, slug y adónde apuntan las herramientas)", async () => {
    const r = await obtener<{ entrante: { ok: boolean; detalle: string; herramientas: Record<string, string> | null } }>("/api/happyrobot/salud");
    expect(typeof r.entrante.ok).toBe("boolean");
    expect(r.entrante.detalle.length).toBeGreaterThan(10);
    medir("(o) salud entrante", 0, `${r.entrante.ok ? "ok" : "falta"} · ${r.entrante.detalle} · ${JSON.stringify(r.entrante.herramientas)}`);
    if (r.entrante.herramientas) expect(r.entrante.herramientas.registrarAviso).toMatch(/\/api\/happyrobot\/aviso$/);
  }, 120_000);

  it("(o) enviar_sms exige el secreto (401); sin texto contesta 200 con enviado:false; con teléfono en el servidor manda un SMS REAL, si no lo dice con la variable", async () => {
    expect((await post("/api/happyrobot/sms", { texto: "prueba" }, false)).estado).toBe(401);
    // La prueba de nodo de la plataforma manda las variables sin resolver: 200 con las cinco claves.
    const sinTexto = await post("/api/happyrobot/sms", { run_id: RUN, texto: "{{$var:x.texto}}" });
    expect(sinTexto.estado).toBe(200);
    expect(sinTexto.json).toMatchObject({ enviado: false, referencia: null, destino: null });
    expect(String(sinTexto.json?.error)).toMatch(/no trae texto/);
    const t0 = Date.now();
    const r = await post("/api/happyrobot/sms", { run_id: RUN, canal: "llamada", texto: `Prueba de integración (o) ${RUN}: mensaje del agente a la sala`, motivo: "dato_nuevo", telefono_llamante: "+34600000000" });
    expect(r.estado, r.texto.slice(0, 300)).toBe(200);
    const j = r.json as { enviado: boolean; referencia?: string; destino?: string; error?: string; mensajeParaLocutor: string };
    medir("(o) enviar_sms", Date.now() - t0, j.enviado ? `enviado · run ${j.referencia} → ${j.destino}` : `NO enviado · ${j.error}`);
    expect(typeof j.mensajeParaLocutor).toBe("string");
    // La configuración que manda es la del SERVIDOR (su .env), no la de este proceso.
    const s = await obtener<{ ok: boolean; detalle: string; recientes: { referencia: string }[] }>("/api/happyrobot/sms");
    if (s.ok) {
      // El servidor tiene teléfono y workflow: el SMS tiene que haber salido de verdad por HappyRobot.
      if (!j.enviado) throw new Error(`enviar_sms no envió aunque el servidor está configurado (${s.detalle}): ${j.error}`);
      expect(j.referencia).toBeTruthy();
      expect(j.destino).toMatch(/\*\*\*/);
      expect(s.recientes.some((x) => x.referencia === j.referencia)).toBe(true);
    } else {
      // Sin teléfono o sin workflow: no se finge nada y el motivo lleva el nombre de la variable.
      expect(j.enviado).toBe(false);
      expect(j.error).toMatch(/Falta /);
      medir("(o) enviar_sms sin configurar", 0, s.detalle);
    }
  }, 120_000);

  it("(o) un aviso sin qué ve ni dónde no registra nada y contesta con la forma completa (registrado:false y motivo)", async () => {
    const r = await api("/api/happyrobot/aviso", { metodo: "POST", cuerpo: { run_id: "x" }, intentos: 1 });
    // `api` de ayudas no manda el secreto: 401.
    expect(r.estado).toBe(401);
    // Con secreto: 200 y registrado:false. Un 422 dejaba al agente sin ver ningún campo de la respuesta.
    const antes = (await snapshot()).observaciones.length;
    const r2 = await post("/api/happyrobot/aviso", { run_id: "vacio", municipio: "", lugar: "", que_ve: "" });
    expect(r2.estado).toBe(200);
    expect(r2.json).toMatchObject({ registrado: false, observacionId: null });
    expect(String(r2.json?.motivo)).toMatch(/que_ve, lugar, municipio/);
    expect((await snapshot()).observaciones.length).toBe(antes);
    // situar_lugar vacío (prueba de nodo de la plataforma): también 200 con todas las claves.
    const r3 = await post("/api/happyrobot/situar", { lugar: "", municipio: "", run_id: "" });
    expect(r3.estado).toBe(200);
    expect(r3.json).toMatchObject({ encontrado: false, precision: "ninguna", lat: null, lon: null });
  }, 60_000);

  it("(o) situar_lugar con IA sitúa lo dictado sin pueblo y con errores de transcripción", async () => {
    const t0 = Date.now();
    const r = await post("/api/happyrobot/situar", { lugar: "la escuela de teleco, Avenida Complutense treinta, Arabaca", municipio: "", run_id: RUN });
    expect(r.estado, r.texto.slice(0, 300)).toBe(200);
    const j = r.json as { encontrado: boolean; precision: string; lat: number; lon: number; origen: string; interpretacion: string | null; correcciones: string | null; consulta: string };
    const ms = Date.now() - t0;
    medir("(o) situar_lugar con IA", ms, `${j.precision} · ${j.origen} · ${j.lat}, ${j.lon} · consulta «${j.consulta}» · interpretó «${j.interpretacion}» · ${j.correcciones ?? "sin correcciones"}`);
    expect(j.encontrado).toBe(true);
    // Ciudad Universitaria (Madrid), no Aravaca ni la Puerta del Sol.
    expect(j.lat).toBeGreaterThan(40.44);
    expect(j.lat).toBeLessThan(40.46);
    expect(j.lon).toBeGreaterThan(-3.74);
    expect(j.lon).toBeLessThan(-3.71);
    // Tope de situar_lugar (IA 5 s + Nominatim): la persona está esperando.
    expect(ms).toBeLessThan(15_000);
  }, 60_000);
});

export type { Observacion };
