"use client";
// =====================================================================
// Portal ciudadano: comunicados publicados, mapa de focos y consejos.
// DUEÑO: constructor D. Se refresca solo cada 20 s (sin SSE: esta página la
// puede ver mucha gente y no debe abrir un stream por visitante).
// =====================================================================
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Comunicado } from "@/lib/dominio/tipos";
import { urlSegura } from "@/lib/cliente/enlaces";
import { EnlaceExterno } from "@/components/ui/Enlace";
import MapaFocos, { type FocoPublico } from "./MapaFocos";

const IDIOMAS: Record<string, string> = { en: "English", ca: "Català", gl: "Galego", eu: "Euskara" };

export default function PortalCiudadano({ urlLlamadaWeb }: { urlLlamadaWeb?: string }) {
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [focos, setFocos] = useState<FocoPublico[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);
  const [idioma, setIdioma] = useState<string>("es");

  // La carga vive DENTRO del efecto y solo toca el estado dentro de las
  // promesas: así no hay setState síncrono en el cuerpo del efecto (React 19
  // avisa de las renderizaciones en cascada que eso provoca).
  useEffect(() => {
    let cancelado = false;

    const cargar = () => {
      fetch("/api/comunicados", { cache: "no-store" })
        .then(async (res) => {
          const j = (await res.json()) as { comunicados?: Comunicado[]; focos?: FocoPublico[]; error?: string };
          if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
          return j;
        })
        .then((j) => {
          if (cancelado) return;
          setComunicados(j.comunicados ?? []);
          setFocos(j.focos ?? []);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelado) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelado) setCargado(true);
        });
    };

    cargar();
    const id = setInterval(cargar, 20_000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, []);

  const idiomasDisponibles = [...new Set(comunicados.flatMap((c) => Object.keys(c.traducciones ?? {})))];

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
        <h2 className="text-lg font-semibold text-amber-950">¿Ves humo o fuego?</h2>
        <p className="mt-1 text-amber-900">
          Si hay personas en peligro, llama al <strong>112</strong>. Para dar el aviso con tu ubicación exacta, usa el formulario.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/parte" className="inline-flex min-h-11 items-center rounded-lg bg-amber-600 px-5 font-semibold text-white hover:bg-amber-700">
            Dar parte de un incendio
          </Link>
          {urlLlamadaWeb && (
            <a href={urlLlamadaWeb} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-amber-600 px-5 font-semibold text-amber-800 hover:bg-amber-100">
              Llamar al 112 virtual desde el navegador
            </a>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold text-slate-900">Incendios activos ahora</h2>
        {!cargado ? (
          <p className="text-slate-600">Cargando…</p>
        ) : focos.length ? (
          <>
            <MapaFocos focos={focos} />
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {focos.map((f) => (
                <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="font-semibold text-slate-900">{f.nombre}</p>
                  <p className="text-sm text-slate-600">
                    {f.municipio}
                    {f.provincia ? `, ${f.provincia}` : ""} · {f.estado} · nivel {f.nivelGravedad} · {f.areaHa.toFixed(0)} ha estimadas
                  </p>
                  {/* Fuente pública del aviso, solo si la trae: nunca un enlace roto. */}
                  <EnlaceExterno href={f.fuenteUrl} className="mt-1 text-sm" siNoHayUrl="nada" titulo="Abrir la fuente de esta información">
                    Fuente: {f.fuenteDeteccion ?? "información original"}
                  </EnlaceExterno>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">No hay incendios activos registrados en este momento.</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900">Comunicados oficiales</h2>
          {idiomasDisponibles.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Idioma de los comunicados">
              {["es", ...idiomasDisponibles].map((codigo) => (
                <button
                  key={codigo}
                  type="button"
                  aria-pressed={idioma === codigo}
                  onClick={() => setIdioma(codigo)}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${idioma === codigo ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {codigo === "es" ? "Castellano" : (IDIOMAS[codigo] ?? codigo)}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-900">No se han podido cargar los comunicados: {error}</p>}

        {cargado && !comunicados.length && !error && (
          <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">Todavía no hay comunicados publicados.</p>
        )}

        <ul className="space-y-4">
          {comunicados.map((c) => {
            const version = idioma !== "es" && c.traducciones?.[idioma] ? c.traducciones[idioma] : { titulo: c.titulo, cuerpo: c.cuerpo };
            // La fuente del comunicado es la del foco del que habla, si la trae.
            const foco = focos.find((f) => f.id === c.incendioId);
            const fuente = urlSegura(foco?.fuenteUrl);
            return (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">{version.titulo}</h3>
                {c.publicadoEn && <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{new Date(c.publicadoEn).toLocaleString("es-ES")}</p>}
                <div className="mt-3 whitespace-pre-line text-slate-800">{version.cuerpo}</div>
                {fuente ? (
                  <p className="mt-3 text-sm">
                    <EnlaceExterno href={fuente} className="text-sm" titulo="Abrir la fuente de este comunicado">
                      Fuente: {foco?.fuenteDeteccion ?? foco?.nombre ?? "información original"}
                    </EnlaceExterno>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold text-slate-900">Qué hacer si el fuego se acerca</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-700">
          <li>Aléjate en dirección contraria al humo; nunca ladera arriba ni por un barranco.</li>
          <li>Si te dicen que te confines: dentro de casa, puertas y ventanas cerradas, toallas húmedas en las rendijas.</li>
          <li>Si te dicen que salgas: hazlo por la ruta que te indiquen, con documentación y medicación, y avisa a los vecinos mayores.</li>
          <li>No cojas el coche para ir a ver el fuego: las carreteras tienen que estar libres para los medios.</li>
          <li>Teléfonos: <strong>112</strong> emergencias · <strong>062</strong> Guardia Civil (SEPRONA) para denunciar un incendio provocado.</li>
        </ul>
      </section>
    </div>
  );
}
