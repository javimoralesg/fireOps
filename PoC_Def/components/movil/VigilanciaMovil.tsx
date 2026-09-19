"use client";
// =====================================================================
// Móvil como cámara de vigilancia. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Pensado para usarse con una mano, en la calle y a pleno sol: botones
// grandes, textos cortos y ningún menú. Pide permiso de ubicación
// (watchPosition) y de cámara trasera (getUserMedia facingMode "environment"),
// enseña la vista previa y envía un fotograma JPEG (≤ 800 px, calidad 0,7)
// cada 15 s a POST /api/camaras/movil, donde el Vigía lo analiza con el modelo
// de visión. También permite dar parte por escrito (POST /api/ingesta/observacion).
//
// OJO: los navegadores solo dan cámara y GPS en HTTPS (o en localhost). En
// local hace falta el túnel; en Railway ya es HTTPS.
// Sin dependencias externas.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";

const INTERVALO_MS = 15_000;
const ANCHO_MAXIMO = 800;
const CALIDAD = 0.7;
const CLAVE_ID = "atalaya:movil:id";
const CLAVE_NOMBRE = "atalaya:movil:nombre";

interface AnalisisRecibido {
  humo: boolean;
  fuego: boolean;
  confianza: number;
  descripcion: string;
  en: string;
}

function idDispositivo(): string {
  try {
    const guardado = localStorage.getItem(CLAVE_ID);
    if (guardado) return guardado;
    const nuevo = `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    localStorage.setItem(CLAVE_ID, nuevo);
    return nuevo;
  } catch {
    return `d${Math.random().toString(36).slice(2, 10)}`;
  }
}

function haceCuanto(iso?: string): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

export default function VigilanciaMovil() {
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const flujo = useRef<MediaStream | null>(null);

  const [dispositivoId, setDispositivoId] = useState("");
  const [nombre, setNombre] = useState("");
  const [posicion, setPosicion] = useState<{ lat: number; lon: number; precisionM?: number } | null>(null);
  const [errorGps, setErrorGps] = useState<string>();
  const [errorCamara, setErrorCamara] = useState<string>();
  const [vigilando, setVigilando] = useState(false);
  const [ultimoEnvio, setUltimoEnvio] = useState<string>();
  const [errorEnvio, setErrorEnvio] = useState<string>();
  const [analisis, setAnalisis] = useState<AnalisisRecibido>();
  const [enviando, setEnviando] = useState(false);

  const [parte, setParte] = useState("");
  const [parteEstado, setParteEstado] = useState<{ ok: boolean; texto: string }>();
  const [enviandoParte, setEnviandoParte] = useState(false);

  // --- identidad del dispositivo -------------------------------------
  useEffect(() => {
    const id = idDispositivo();
    setDispositivoId(id);
    try {
      setNombre(localStorage.getItem(CLAVE_NOMBRE) || "");
    } catch {
      /* sin localStorage: el nombre se pide cada vez */
    }
  }, []);

  const guardarNombre = (v: string) => {
    setNombre(v);
    try {
      localStorage.setItem(CLAVE_NOMBRE, v);
    } catch {
      /* da igual: el nombre viaja igualmente en cada envío */
    }
  };

  // --- ubicación ------------------------------------------------------
  useEffect(() => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setErrorGps("Esta página se ha abierto por HTTP: el navegador bloquea el GPS y la cámara. Abre el enlace HTTPS del QR de la sala (túnel o Railway).");
      return;
    }
    if (!("geolocation" in navigator)) {
      setErrorGps("Este navegador no da la ubicación.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setErrorGps(undefined);
        setPosicion({ lat: p.coords.latitude, lon: p.coords.longitude, precisionM: p.coords.accuracy });
      },
      (e) => setErrorGps(`${e.message}. Hace falta HTTPS y dar permiso de ubicación.`),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // --- cámara ---------------------------------------------------------
  const arrancarCamara = useCallback(async () => {
    setErrorCamara(undefined);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setErrorCamara("Esta página se ha abierto por HTTP: el navegador bloquea la cámara. Abre el enlace HTTPS del QR de la sala (túnel o Railway).");
      return false;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      flujo.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      return true;
    } catch (e) {
      setErrorCamara(`No se pudo abrir la cámara: ${e instanceof Error ? e.message : String(e)}. Hace falta HTTPS y dar permiso.`);
      return false;
    }
  }, []);

  useEffect(() => {
    return () => {
      flujo.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // --- captura y envío -------------------------------------------------
  const capturar = useCallback((): string | undefined => {
    const v = video.current;
    const c = lienzo.current;
    if (!v || !c || !v.videoWidth) return undefined;
    const escala = Math.min(1, ANCHO_MAXIMO / v.videoWidth);
    c.width = Math.round(v.videoWidth * escala);
    c.height = Math.round(v.videoHeight * escala);
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", CALIDAD);
  }, []);

  const enviarFotograma = useCallback(async () => {
    if (!posicion) {
      setErrorEnvio("Todavía no tengo tu ubicación.");
      return;
    }
    const imagenBase64 = capturar();
    if (!imagenBase64) {
      setErrorEnvio("La cámara aún no da imagen.");
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/camaras/movil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dispositivoId,
          nombre: nombre.trim() || undefined,
          lat: posicion.lat,
          lon: posicion.lon,
          precisionM: posicion.precisionM,
          imagenBase64,
          mime: "image/jpeg",
        }),
      });
      const j = (await res.json()) as { error?: string; recibidoEn?: string };
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setUltimoEnvio(j.recibidoEn ?? new Date().toISOString());
      setErrorEnvio(undefined);
    } catch (e) {
      setErrorEnvio(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }, [capturar, dispositivoId, nombre, posicion]);

  // Envío periódico mientras la vigilancia esté activa (el primer envío lo
  // dispara el propio botón, no este efecto).
  useEffect(() => {
    if (!vigilando) return;
    const t = setInterval(() => void enviarFotograma(), INTERVALO_MS);
    return () => clearInterval(t);
  }, [vigilando, enviarFotograma]);

  // Lectura del análisis del Vigía.
  useEffect(() => {
    if (!vigilando || !dispositivoId) return;
    const leer = async () => {
      try {
        const res = await fetch("/api/camaras?max=500", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { camaras?: { id: string; ultimoAnalisis?: AnalisisRecibido }[] };
        const mia = j.camaras?.find((c) => c.id === `movil:${dispositivoId}`);
        if (mia?.ultimoAnalisis) setAnalisis(mia.ultimoAnalisis);
      } catch {
        /* la sala puede estar arrancando: se reintenta al siguiente ciclo */
      }
    };
    void leer();
    const t = setInterval(leer, INTERVALO_MS);
    return () => clearInterval(t);
  }, [vigilando, dispositivoId]);

  const alternarVigilancia = async () => {
    if (vigilando) {
      setVigilando(false);
      flujo.current?.getTracks().forEach((t) => t.stop());
      flujo.current = null;
      return;
    }
    const ok = await arrancarCamara();
    if (!ok) return;
    setVigilando(true);
    await enviarFotograma();
  };

  const enviarParte = async () => {
    const texto = parte.trim();
    if (!texto) {
      setParteEstado({ ok: false, texto: "Escribe qué estás viendo antes de enviar." });
      return;
    }
    setEnviandoParte(true);
    try {
      const res = await fetch("/api/ingesta/observacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canal: "web",
          texto,
          remitente: `movil:${dispositivoId}`,
          lat: posicion?.lat,
          lon: posicion?.lon,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setParteEstado({ ok: true, texto: "Parte enviado a la sala de mando. Gracias." });
      setParte("");
    } catch (e) {
      setParteEstado({ ok: false, texto: `No se pudo enviar: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setEnviandoParte(false);
    }
  };

  const veredicto = analisis
    ? analisis.fuego
      ? `FUEGO (${analisis.confianza.toFixed(2).replace(".", ",")})`
      : analisis.humo
        ? `humo (${analisis.confianza.toFixed(2).replace(".", ",")})`
        : `sin humo (${analisis.confianza.toFixed(2).replace(".", ",")})`
    : "aún sin analizar";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-4 px-4 py-5 text-[var(--foreground)]">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Atalaya · Móvil en campo</h1>
        <span className="text-xs text-[var(--muted)]">{dispositivoId ? dispositivoId.slice(0, 6) : "…"}</span>
      </header>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">Tu nombre (se ve en la sala de mando)</span>
        <input
          value={nombre}
          onChange={(e) => guardarNombre(e.target.value)}
          placeholder="Móvil de Javi"
          className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3 text-base outline-none focus:border-[var(--brand)]"
        />
      </label>

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--panel-border)] bg-black">
        <video ref={video} playsInline muted className="aspect-video w-full object-cover" />
      </section>
      <canvas ref={lienzo} className="hidden" />

      <button
        type="button"
        onClick={() => void alternarVigilancia()}
        className={`w-full rounded-2xl px-6 py-5 text-lg font-semibold text-white shadow-[var(--sombra-panel)] transition active:scale-[0.99] ${
          vigilando ? "bg-[var(--danger)]" : "bg-[var(--brand)]"
        }`}
      >
        {vigilando ? "Detener vigilancia" : "Activar vigilancia"}
      </button>

      {vigilando && (
        <button
          type="button"
          onClick={() => void enviarFotograma()}
          disabled={enviando}
          className="w-full rounded-2xl border-2 border-[var(--brand)] px-6 py-4 text-base font-semibold text-[var(--brand)] disabled:opacity-50"
        >
          {enviando ? "Enviando…" : "Enviar ahora"}
        </button>
      )}

      <section className="rounded-[var(--radius-panel)] border border-[var(--panel-border)] bg-[var(--panel)] p-4 text-sm">
        <p className="font-semibold">
          {vigilando ? "Vigilancia activa" : "Vigilancia detenida"}
          {vigilando && ` · último envío ${haceCuanto(ultimoEnvio)}`}
        </p>
        <p className="mt-1 text-[var(--muted)]">Analizado: {veredicto}</p>
        {analisis?.descripcion && <p className="mt-1 text-[var(--muted)]">{analisis.descripcion}</p>}
        <p className="mt-2 text-[var(--muted)]">
          {posicion
            ? `Ubicación: ${posicion.lat.toFixed(5)}, ${posicion.lon.toFixed(5)}${posicion.precisionM ? ` (±${Math.round(posicion.precisionM)} m)` : ""}`
            : "Esperando ubicación…"}
        </p>
        {errorGps && <p className="mt-2 text-[var(--danger)]">{errorGps}</p>}
        {errorCamara && <p className="mt-2 text-[var(--danger)]">{errorCamara}</p>}
        {errorEnvio && <p className="mt-2 text-[var(--danger)]">Último envío falló: {errorEnvio}</p>}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-[var(--panel-border)] bg-[var(--panel)] p-4">
        <h2 className="text-lg font-semibold">Dar parte</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Cuenta qué ves y dónde. Se envía con tu posición.</p>
        <textarea
          value={parte}
          onChange={(e) => setParte(e.target.value)}
          rows={4}
          placeholder="Columna de humo blanco al otro lado del pantano, junto a la carretera…"
          className="mt-3 w-full rounded-xl border border-[var(--panel-border)] bg-[var(--panel-2)] px-4 py-3 text-base outline-none focus:border-[var(--brand)]"
        />
        <button
          type="button"
          onClick={() => void enviarParte()}
          disabled={enviandoParte}
          className="mt-3 w-full rounded-2xl bg-[var(--fuego)] px-6 py-4 text-base font-semibold text-white disabled:opacity-50"
        >
          {enviandoParte ? "Enviando…" : "Enviar parte"}
        </button>
        {parteEstado && (
          <p className={`mt-3 text-sm ${parteEstado.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{parteEstado.texto}</p>
        )}
      </section>

      <p className="pb-6 text-center text-xs text-[var(--muted)]">
        La cámara y el GPS solo funcionan en HTTPS. Las imágenes se analizan al momento y no se guardan en disco.
      </p>
    </main>
  );
}
