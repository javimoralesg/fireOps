"use client";
// =====================================================================
// Formulario ciudadano de aviso (/parte). DUEÑO: constructor D.
// Manda a POST /api/ingesta/observacion, que lo entrega a la centralita.
// Pensado para usarse con una mano, en la calle, con prisa.
// =====================================================================
import { useState } from "react";
import Link from "next/link";

type Estado = "editando" | "enviando" | "enviado" | "error";

export default function FormularioParte({ urlLlamadaWeb }: { urlLlamadaWeb?: string }) {
  const [texto, setTexto] = useState("");
  const [lugar, setLugar] = useState("");
  const [telefono, setTelefono] = useState("");
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [avisoUbicacion, setAvisoUbicacion] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("editando");
  const [mensaje, setMensaje] = useState<string | null>(null);

  function usarMiUbicacion() {
    if (!("geolocation" in navigator)) {
      setAvisoUbicacion("Este navegador no puede darme tu ubicación. Describe el lugar con todo el detalle que puedas.");
      return;
    }
    setUbicando(true);
    setAvisoUbicacion(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPunto({ lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6) });
        setAvisoUbicacion(`Ubicación tomada con una precisión de ${Math.round(pos.coords.accuracy)} metros.`);
        setUbicando(false);
      },
      (err) => {
        setAvisoUbicacion(`No he podido tomar tu ubicación (${err.message}). Describe el lugar: carretera, kilómetro, paraje, pueblo más cercano.`);
        setUbicando(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (texto.trim().length < 5) {
      setEstado("error");
      setMensaje("Cuéntame algo más: qué ves y dónde.");
      return;
    }
    setEstado("enviando");
    setMensaje(null);
    try {
      const res = await fetch("/api/ingesta/observacion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          canal: "web",
          texto: lugar.trim() ? `${texto.trim()}\n\nLugar: ${lugar.trim()}` : texto.trim(),
          remitente: telefono.trim() || undefined,
          lat: punto?.lat,
          lon: punto?.lon,
        }),
      });
      const j = (await res.json()) as { mensaje?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setEstado("enviado");
      setMensaje(j.mensaje ?? "Aviso recibido.");
    } catch (err) {
      setEstado("error");
      setMensaje(`No se ha podido enviar el aviso: ${err instanceof Error ? err.message : String(err)}. Si es urgente, llama al 112.`);
    }
  }

  if (estado === "enviado") {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-6">
        <h2 className="text-xl font-semibold text-emerald-950">Aviso enviado</h2>
        <p className="mt-2 text-emerald-900">{mensaje}</p>
        <p className="mt-2 text-emerald-900">
          {punto ? "Hemos recibido tus coordenadas: los medios saben exactamente dónde mirar." : "Sin coordenadas, la sala tardará un poco más en situarlo."}
        </p>
        <p className="mt-4 font-medium text-emerald-950">Si hay personas en peligro, llama ahora al 112.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setTexto("");
              setLugar("");
              setPunto(null);
              setEstado("editando");
              setMensaje(null);
            }}
            className="min-h-11 rounded-lg border border-emerald-600 px-4 font-medium text-emerald-800"
          >
            Dar otro parte
          </button>
          <Link href="/publico" className="inline-flex min-h-11 items-center rounded-lg bg-emerald-700 px-5 font-semibold text-white">
            Ver comunicados oficiales
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-6">
      <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
        <strong>Si hay personas en peligro, llama al 112 antes que nada.</strong> Este formulario avisa a la sala de coordinación, pero no
        sustituye a la llamada de emergencia.
        {urlLlamadaWeb && (
          <p className="mt-2">
            <a href={urlLlamadaWeb} target="_blank" rel="noreferrer" className="font-semibold underline">
              También puedes llamar al 112 virtual desde el navegador
            </a>
            .
          </p>
        )}
      </div>

      <div>
        <label htmlFor="texto" className="block text-sm font-medium text-slate-800">
          ¿Qué estás viendo? <span className="text-rose-600">*</span>
        </label>
        <p className="mb-2 text-xs text-slate-500">Humo o llamas, de qué color, si avanza, si hay casas o gente cerca, cuánto ocupa.</p>
        <textarea
          id="texto"
          required
          rows={5}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Columna de humo blanco detrás del cerro, se está poniendo gris. Hay una casa de campo a unos 500 metros."
          className="w-full rounded-lg border border-slate-300 p-3 text-slate-900"
        />
      </div>

      <div>
        <label htmlFor="lugar" className="block text-sm font-medium text-slate-800">
          ¿Dónde?
        </label>
        <p className="mb-2 text-xs text-slate-500">Carretera y kilómetro, paraje, ermita, urbanización, pueblo más cercano.</p>
        <input
          id="lugar"
          value={lugar}
          onChange={(e) => setLugar(e.target.value)}
          placeholder="N-403 km 62, cerca de Navalacruz (Ávila)"
          className="h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-900"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={usarMiUbicacion}
            disabled={ubicando}
            className="min-h-11 rounded-lg border border-slate-900 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {ubicando ? "Tomando tu ubicación…" : "📍 Usar mi ubicación"}
          </button>
          {punto && (
            <span className="rounded-lg bg-emerald-100 px-3 py-2 font-mono text-sm text-emerald-900">
              {punto.lat}, {punto.lon}
            </span>
          )}
        </div>
        {avisoUbicacion && <p className="mt-2 text-sm text-slate-600">{avisoUbicacion}</p>}
      </div>

      <div>
        <label htmlFor="telefono" className="block text-sm font-medium text-slate-800">
          Tu teléfono (opcional)
        </label>
        <p className="mb-2 text-xs text-slate-500">Solo se usa para llamarte si hace falta confirmar algo del aviso.</p>
        <input
          id="telefono"
          type="tel"
          inputMode="tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="+34 600 000 000"
          className="h-11 w-full max-w-xs rounded-lg border border-slate-300 px-3 text-slate-900"
        />
      </div>

      {estado === "error" && mensaje && (
        <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-900">
          {mensaje}
        </p>
      )}

      <button
        type="submit"
        disabled={estado === "enviando"}
        className="min-h-12 w-full rounded-lg bg-amber-600 px-6 text-lg font-semibold text-white hover:bg-amber-700 disabled:bg-slate-300 sm:w-auto"
      >
        {estado === "enviando" ? "Enviando…" : "Enviar el aviso"}
      </button>
    </form>
  );
}
