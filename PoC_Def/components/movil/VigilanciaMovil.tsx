"use client";
// =====================================================================
// Móvil como cámara de vigilancia. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Pensado para usarse con una mano, en la calle y a pleno sol: botones
// grandes, textos cortos y ningún menú. Pide permiso de ubicación
// (watchPosition) y de cámara trasera (getUserMedia facingMode "environment"),
// enseña la vista previa y envía un fotograma JPEG (≤ 800 px, calidad 0,7)
// cada 10 s a POST /api/camaras/movil, que lo analiza AL MOMENTO con el modelo
// de visión y devuelve el veredicto en la misma respuesta. Si el primer análisis
// da humo o fuego, el siguiente fotograma sale enseguida para confirmarlo.
// El botón «Congelar imagen» fija el fotograma actual y lo reenvía en cada
// intervalo: sirve para ensayar cómo reacciona la sala ante un fuego sostenido.
// También permite dar parte por escrito (POST /api/ingesta/observacion).
//
// OJO: los navegadores solo dan cámara y GPS en HTTPS (o en localhost). En
// local hace falta el túnel; en Railway ya es HTTPS.
// Sin dependencias externas.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";

const INTERVALO_MS = 10_000;
/** Tras un primer positivo, el fotograma de confirmación sale casi de inmediato. */
const ESPERA_CONFIRMACION_MS = 1_500;
const CONFIANZA_MINIMA = 0.6;
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
  /** true mientras el modelo sigue con el último fotograma enviado (la respuesta llegó sin veredicto). */
  const [analizando, setAnalizando] = useState(false);
  const enviandoRef = useRef(false);
  const positivoAnteriorRef = useRef(false);
  /** Última versión de enviarFotograma, para el envío de confirmación programado con setTimeout. */
  const enviarRef = useRef<() => Promise<void>>(async () => undefined);
  /** Fotograma congelado (data URL): mientras exista se envía y analiza ESTA imagen en cada intervalo. */
  const [congelado, setCongelado] = useState<string>();
  const congeladoRef = useRef<string | undefined>(undefined);

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
    // Con una imagen congelada se envía siempre esa misma (misma escena, secuencia nueva:
    // el Vigía la analiza cada vez, para ver cómo reacciona la sala a un fuego sostenido).
    const imagenBase64 = congeladoRef.current ?? capturar();
    if (!imagenBase64) {
      setErrorEnvio("La cámara aún no da imagen.");
      return;
    }
    if (enviandoRef.current) return; // un envío a la vez: el de confirmación no debe solaparse con el periódico
    enviandoRef.current = true;
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
      const j = (await res.json()) as { error?: string; recibidoEn?: string; analisis?: AnalisisRecibido | null; analizando?: boolean };
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setUltimoEnvio(j.recibidoEn ?? new Date().toISOString());
      setErrorEnvio(undefined);
      setAnalizando(Boolean(j.analizando));
      if (j.analisis) {
        setAnalisis(j.analisis);
        // Primer positivo: el Vigía necesita dos seguidos para confirmar, así que el
        // siguiente fotograma sale ya, sin esperar al intervalo.
        const positivo = (j.analisis.humo || j.analisis.fuego) && j.analisis.confianza >= CONFIANZA_MINIMA;
        if (positivo && !positivoAnteriorRef.current) setTimeout(() => void enviarRef.current(), ESPERA_CONFIRMACION_MS);
        positivoAnteriorRef.current = positivo;
      }
    } catch (e) {
      setErrorEnvio(e instanceof Error ? e.message : String(e));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }, [capturar, dispositivoId, nombre, posicion]);

  useEffect(() => {
    enviarRef.current = enviarFotograma;
  }, [enviarFotograma]);

  // Congelar: fija el fotograma actual y lo envía ya; hasta descongelar, cada
  // intervalo vuelve a enviar esa misma imagen.
  const congelar = () => {
    const imagen = capturar();
    if (!imagen) {
      setErrorEnvio("La cámara aún no da imagen que congelar.");
      return;
    }
    congeladoRef.current = imagen;
    setCongelado(imagen);
    positivoAnteriorRef.current = false; // el primer positivo de la imagen congelada dispara la confirmación rápida
    void enviarFotograma();
  };
  const descongelar = () => {
    congeladoRef.current = undefined;
    setCongelado(undefined);
  };

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
      descongelar();
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

      <section className="relative overflow-hidden rounded-[var(--radius-panel)] border border-[var(--panel-border)] bg-black">
        <video ref={video} playsInline muted className="aspect-video w-full object-cover" />
        {congelado && (
          <>
            {/* El vídeo sigue debajo (así la cámara no se para): la imagen congelada lo tapa. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={congelado} alt="Fotograma congelado que se está enviando" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute left-3 top-3 rounded-full bg-[var(--danger)] px-3 py-1 text-xs font-semibold text-white shadow">
              Imagen congelada · se analiza esta misma cada {INTERVALO_MS / 1000} s
            </span>
          </>
        )}
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
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void enviarFotograma()}
            disabled={enviando}
            className="w-full rounded-2xl border-2 border-[var(--brand)] px-4 py-4 text-base font-semibold text-[var(--brand)] disabled:opacity-50"
          >
            {enviando ? "Analizando…" : "Enviar ahora"}
          </button>
          <button
            type="button"
            onClick={congelado ? descongelar : congelar}
            className={`w-full rounded-2xl px-4 py-4 text-base font-semibold ${
              congelado ? "bg-[var(--danger)] text-white" : "border-2 border-[var(--fuego)] text-[var(--fuego)]"
            }`}
          >
            {congelado ? "Descongelar" : "Congelar imagen"}
          </button>
        </div>
      )}

      <section className="rounded-[var(--radius-panel)] border border-[var(--panel-border)] bg-[var(--panel)] p-4 text-sm">
        <p className="font-semibold">
          {vigilando ? "Vigilancia activa" : "Vigilancia detenida"}
          {vigilando && ` · último envío ${haceCuanto(ultimoEnvio)}`}
        </p>
        <p className="mt-1 text-[var(--muted)]">Analizado: {veredicto}</p>
        {analisis?.descripcion && <p className="mt-1 text-[var(--muted)]">{analisis.descripcion}</p>}
        {(enviando || analizando) && <p className="mt-1 text-[var(--brand)]">{enviando ? "Enviando y analizando el fotograma…" : "El modelo sigue con el último fotograma; el veredicto llega enseguida."}</p>}
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
