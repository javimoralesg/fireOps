"use client";
// =====================================================================
// ATALAYA INCENDIOS · Pantalla del grafo de conocimiento
// ---------------------------------------------------------------------
// DUEÑO: constructor C · visor interactivo y reenganche: constructor I.
// Tres cosas, en este orden de importancia para quien está en la sala:
//   1. Preguntar ("¿Cómo procedo si…?") y ver la respuesta CON las fuentes,
//      su similitud y por qué se miró cada una (vector o vecino del grafo).
//   2. VER ESO MISMO EN EL GRAFO: los fragmentos que miró la IA salen con
//      halo y número de orden, y cada cita lleva a su nodo.
//   3. Ver qué normativa hay cargada y subir más.
// Si falta el proveedor de IA, se enseña el error tal cual y, aun así, los
// fragmentos recuperados: la norma se puede leer sin que nadie la resuma.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Search, Trash2, Upload } from "lucide-react";
import type { AmbitoDocumento, Documento, GrafoConocimiento } from "@/lib/dominio/tipos";
import { Boton } from "@/components/ui";
import { VisorGrafo, type DestacadoGrafo, type VisorGrafoApi } from "./GrafoConocimiento";

interface FundamentoExplicado {
  chunkId: string;
  documento: string;
  seccion?: string;
  cita: string;
  similitud: number;
  motivo: "vector" | "referencia" | "siguiente";
  desdeChunkId?: string;
  texto: string;
  entidades: string[];
}

interface RespuestaConsulta {
  pregunta?: string;
  respuesta?: string;
  modelo?: string;
  explicados?: FundamentoExplicado[];
  error?: string;
}

const AMBITOS: { valor: AmbitoDocumento; texto: string }[] = [
  { valor: "nacional", texto: "Nacional" },
  { valor: "comunidad", texto: "Comunidad autónoma" },
  { valor: "provincia", texto: "Provincia" },
  { valor: "municipio", texto: "Municipio" },
  { valor: "interno", texto: "Procedimiento interno" },
];

const MOTIVO_TEXTO: Record<FundamentoExplicado["motivo"], string> = {
  vector: "similitud semántica",
  referencia: "referencia cruzada en el texto",
  siguiente: "fragmento siguiente del mismo artículo",
};

const PREGUNTAS_EJEMPLO = [
  "¿Quién puede ordenar la evacuación de un pueblo en un incendio de nivel 2?",
  "¿Cuándo se constituye el CECOPI?",
  "¿Qué obligación tiene quien ve un incendio forestal?",
];

export function PaginaConocimiento() {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [resumen, setResumen] = useState<{ documentos: number; chunks: number; modelo: string; enSupabase: boolean }>();
  const [grafo, setGrafo] = useState<GrafoConocimiento>();
  const [documentoGrafo, setDocumentoGrafo] = useState<string>("");
  const [cargandoGrafo, setCargandoGrafo] = useState(true);
  /** Fragmentos que la consulta obliga a dibujar aunque el muestreo los descarte. */
  const [obligatorios, setObligatorios] = useState<string[]>([]);

  const [pregunta, setPregunta] = useState("");
  const [consultando, setConsultando] = useState(false);
  const [respuesta, setRespuesta] = useState<RespuestaConsulta>();

  const [ambito, setAmbito] = useState<AmbitoDocumento>("nacional");
  const [territorio, setTerritorio] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [avisoSubida, setAvisoSubida] = useState<string>();
  const [arrastrando, setArrastrando] = useState(false);
  const entradaArchivos = useRef<HTMLInputElement>(null);
  const campoPregunta = useRef<HTMLInputElement>(null);
  const seccionGrafo = useRef<HTMLElement>(null);
  const visor = useRef<VisorGrafoApi>(null);

  const cargarDocumentos = useCallback(async () => {
    const r = await fetch("/api/conocimiento/documentos", { cache: "no-store" });
    const d = (await r.json()) as { documentos: Documento[]; resumen: typeof resumen };
    setDocumentos(d.documentos ?? []);
    setResumen(d.resumen);
  }, []);

  const cargarGrafo = useCallback(async (documentoId: string, incluir: string[]) => {
    setCargandoGrafo(true);
    const parametros = new URLSearchParams();
    if (documentoId) parametros.set("documentoId", documentoId);
    if (incluir.length) parametros.set("incluir", incluir.join(","));
    const consulta = parametros.toString();
    const r = await fetch(`/api/conocimiento/grafo${consulta ? `?${consulta}` : ""}`, { cache: "no-store" });
    setGrafo((await r.json()) as GrafoConocimiento);
    setCargandoGrafo(false);
  }, []);

  useEffect(() => {
    // setTimeout 0: la carga inicial no debe hacer setState dentro del cuerpo
    // del efecto (regla react-hooks/set-state-in-effect de React 19).
    const t = setTimeout(() => void cargarDocumentos(), 0);
    return () => clearTimeout(t);
  }, [cargarDocumentos]);

  useEffect(() => {
    const t = setTimeout(() => void cargarGrafo(documentoGrafo, obligatorios), 0);
    return () => clearTimeout(t);
  }, [documentoGrafo, obligatorios, cargarGrafo]);

  const preguntar = useCallback(async (texto: string) => {
    const limpia = texto.trim();
    if (!limpia) return;
    setConsultando(true);
    setRespuesta(undefined);
    try {
      const r = await fetch("/api/conocimiento/consultar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pregunta: limpia }),
      });
      const datos = (await r.json()) as RespuestaConsulta;
      setRespuesta(datos);
      // El grafo se recarga forzando la presencia de los fragmentos citados:
      // así el jurado ve de verdad "a qué miró" la IA.
      setObligatorios((datos.explicados ?? []).map((f) => f.chunkId));
    } catch (e) {
      setRespuesta({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setConsultando(false);
    }
  }, []);

  /** Lo que el visor pinta con halo y número de orden. */
  const destacados = useMemo<DestacadoGrafo[]>(
    () =>
      (respuesta?.explicados ?? []).map((f, i) => ({
        chunkId: f.chunkId,
        orden: i + 1,
        motivo: f.motivo,
        similitud: f.similitud,
        documento: f.documento,
        seccion: f.seccion,
        cita: f.cita,
      })),
    [respuesta],
  );

  const verEnGrafo = useCallback((chunkId: string) => {
    seccionGrafo.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // El nodo puede acabar de llegar con la recarga del grafo: se reintenta.
    const intentar = (restantes: number) => {
      visor.current?.centrarNodo(chunkId);
      if (restantes > 0) setTimeout(() => intentar(restantes - 1), 250);
    };
    intentar(2);
  }, []);

  const rellenarBuscador = useCallback((texto: string) => {
    setPregunta(texto);
    campoPregunta.current?.focus();
    campoPregunta.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const subir = useCallback(
    async (archivos: FileList | File[]) => {
      const lista = [...archivos];
      if (!lista.length) return;
      setSubiendo(true);
      setAvisoSubida(undefined);
      try {
        const formulario = new FormData();
        for (const a of lista) formulario.append("archivos", a);
        formulario.append("ambito", ambito);
        if (territorio.trim()) formulario.append("territorio", territorio.trim());
        const r = await fetch("/api/conocimiento/documentos", { method: "POST", body: formulario });
        const d = (await r.json()) as { documentos?: Documento[]; error?: string; errores?: { nombreArchivo: string; error: string }[] };
        if (!r.ok) {
          setAvisoSubida(d.error ?? "No se pudo subir.");
        } else {
          const fallos = d.errores?.length ? ` (${d.errores.map((e) => `${e.nombreArchivo}: ${e.error}`).join("; ")})` : "";
          setAvisoSubida(`Indexado${d.documentos?.length === 1 ? "" : "s"} ${d.documentos?.length} documento(s)${fallos}.`);
          await cargarDocumentos();
          await cargarGrafo(documentoGrafo, obligatorios);
        }
      } catch (e) {
        setAvisoSubida(e instanceof Error ? e.message : String(e));
      } finally {
        setSubiendo(false);
      }
    },
    [ambito, territorio, cargarDocumentos, cargarGrafo, documentoGrafo, obligatorios],
  );

  const borrar = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/conocimiento/documentos/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r.ok) {
        await cargarDocumentos();
        await cargarGrafo(documentoGrafo, obligatorios);
      }
    },
    [cargarDocumentos, cargarGrafo, documentoGrafo, obligatorios],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 text-foreground">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-brand underline underline-offset-2 hover:text-brand-2">
            ← Volver a la sala de mando
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Conocimiento</h1>
          <p className="text-sm text-muted">
            La normativa con la que los agentes fundamentan cada decisión. Todo lo que se cita sale de aquí.
          </p>
        </div>
        {resumen && (
          <p className="text-sm text-muted">
            <strong className="text-foreground">{resumen.documentos}</strong> documentos ·{" "}
            <strong className="text-foreground">{resumen.chunks}</strong> fragmentos · embeddings{" "}
            <code className="rounded bg-panel-2 px-1 text-xs">{resumen.modelo}</code> ·{" "}
            {resumen.enSupabase ? "sincronizado con Supabase" : "solo índice local"}
          </p>
        )}
      </header>

      {/* ---------------- Buscador ---------------- */}
      <section className="mb-6 rounded-[var(--radius-panel)] border border-panel-border bg-panel p-4 shadow-[var(--sombra-panel)]">
        <h2 className="text-lg font-semibold">¿Cómo procedo si…?</h2>
        <p className="mt-0.5 text-sm text-muted">
          Pregunta en lenguaje natural. La respuesta sale solo de los fragmentos que ves debajo, y esos mismos se
          encienden en el grafo.
        </p>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void preguntar(pregunta);
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input
              ref={campoPregunta}
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              placeholder="¿Quién puede ordenar la evacuación de un pueblo en un incendio de nivel 2?"
              aria-label="Pregunta sobre el protocolo"
              className="min-h-11 w-full rounded-xl border border-panel-border-strong bg-panel pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          </div>
          <Boton type="submit" variante="primario" cargando={consultando} disabled={!pregunta.trim()}>
            {consultando ? "Consultando…" : "Consultar"}
          </Boton>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          {PREGUNTAS_EJEMPLO.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPregunta(p);
                void preguntar(p);
              }}
              className="rounded-full border border-panel-border-strong px-3 py-1 text-xs text-muted hover:border-accent hover:text-foreground"
            >
              {p}
            </button>
          ))}
        </div>

        {respuesta && (
          <div className="mt-4">
            {respuesta.error && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground" role="status">
                <strong>No hay respuesta generada:</strong> {respuesta.error}
                {respuesta.explicados?.length ? " Aun así, estos son los fragmentos aplicables." : ""}
              </p>
            )}
            {respuesta.respuesta && (
              <div className="rounded-lg border border-info/40 bg-info/10 p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{respuesta.respuesta}</p>
                {respuesta.modelo && <p className="mt-2 text-xs text-muted">Modelo: {respuesta.modelo}</p>}
              </div>
            )}
            {respuesta.explicados?.length ? (
              <div className="mt-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Fragmentos consultados ({respuesta.explicados.length}) y por qué
                </h3>
                <ul className="mt-2 grid gap-2 md:grid-cols-2">
                  {respuesta.explicados.map((f, i) => (
                    <li key={f.chunkId} className="rounded-lg border border-panel-border p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="tabular inline-flex size-5 items-center justify-center rounded-full bg-fuego text-[11px] font-bold text-white">
                          {i + 1}
                        </span>
                        <span className="tabular rounded bg-foreground px-1.5 py-0.5 font-mono text-panel">
                          {f.similitud.toFixed(3)}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            f.motivo === "vector" ? "bg-brand/15 text-foreground" : "bg-warning/15 text-foreground"
                          }`}
                        >
                          {MOTIVO_TEXTO[f.motivo]}
                        </span>
                        <span className="text-muted">
                          {f.documento} §{f.seccion ?? "—"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-foreground">{f.cita}</p>
                      {f.entidades.length > 0 && <p className="mt-1 text-xs text-muted">Entidades: {f.entidades.join(" · ")}</p>}
                      <button
                        type="button"
                        onClick={() => verEnGrafo(f.chunkId)}
                        className="mt-1.5 text-xs text-brand underline underline-offset-2 hover:text-brand-2"
                      >
                        Ver este fragmento en el grafo
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* ---------------- Grafo ---------------- */}
      <section
        ref={seccionGrafo}
        className="mb-6 scroll-mt-4 rounded-[var(--radius-panel)] border border-panel-border bg-panel p-4 shadow-[var(--sombra-panel)]"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Grafo</h2>
            <p className="text-sm text-muted">
              Arrastra los vértices para colocarlos a tu gusto; se quedan donde los sueltes.
              {destacados.length ? " Los numerados son los fragmentos en los que se apoya la respuesta de arriba." : ""}
            </p>
          </div>
          <label className="text-sm">
            <span className="mr-2 text-muted">Mostrar</span>
            <select
              value={documentoGrafo}
              onChange={(e) => setDocumentoGrafo(e.target.value)}
              className="min-h-11 rounded-xl border border-panel-border-strong bg-panel px-3 text-sm text-foreground"
            >
              <option value="">Todos los documentos</option>
              {documentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.titulo.length > 60 ? `${d.titulo.slice(0, 59)}…` : d.titulo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <VisorGrafo
          ref={visor}
          grafo={grafo}
          cargando={cargandoGrafo}
          claveMemoria={documentoGrafo || "todos"}
          destacados={destacados.length ? destacados : undefined}
          pregunta={respuesta?.pregunta ?? (destacados.length ? pregunta : undefined)}
          onPreguntar={rellenarBuscador}
        />
      </section>

      {/* ---------------- Documentos ---------------- */}
      <section className="rounded-[var(--radius-panel)] border border-panel-border bg-panel p-4 shadow-[var(--sombra-panel)]">
        <h2 className="text-lg font-semibold">Documentos indexados</h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
          <label className="text-sm">
            <span className="block font-medium text-foreground">Ámbito de lo que subas</span>
            <select
              value={ambito}
              onChange={(e) => setAmbito(e.target.value as AmbitoDocumento)}
              className="mt-1 min-h-11 w-full rounded-xl border border-panel-border-strong bg-panel px-3 text-sm text-foreground"
            >
              {AMBITOS.map((a) => (
                <option key={a.valor} value={a.valor}>
                  {a.texto}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium text-foreground">Territorio (si no es nacional)</span>
            <input
              value={territorio}
              onChange={(e) => setTerritorio(e.target.value)}
              placeholder="Castilla y León, Ávila, Navalacruz…"
              className="mt-1 min-h-11 w-full rounded-xl border border-panel-border-strong bg-panel px-3 text-sm text-foreground placeholder:text-subtle"
            />
          </label>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            void subir(e.dataTransfer.files);
          }}
          className={`mt-3 rounded-xl border-2 border-dashed p-6 text-center transition ${
            arrastrando ? "border-accent bg-accent/10" : "border-panel-border-strong"
          }`}
        >
          <p className="text-sm font-medium text-foreground">
            Arrastra aquí planes, protocolos o normativa (.txt o .md, máximo 2 MB)
          </p>
          <p className="mt-1 text-xs text-muted">
            Se trocea por artículos, se extraen entidades y se calcula un embedding por fragmento.
          </p>
          <Boton
            className="mt-3"
            icono={<Upload />}
            onClick={() => entradaArchivos.current?.click()}
            cargando={subiendo}
          >
            {subiendo ? "Indexando…" : "O elige un archivo"}
          </Boton>
          <input
            ref={entradaArchivos}
            type="file"
            accept=".txt,.md,.markdown"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void subir(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {avisoSubida && (
          <p className="mt-2 rounded-lg bg-panel-2 p-2 text-sm text-foreground" role="status">
            {avisoSubida}
          </p>
        )}

        {documentos.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-panel-border-strong p-6 text-center">
            <p className="font-medium text-foreground">Sin documentos todavía</p>
            <p className="mt-1 text-sm text-muted">
              Arrastra un .md arriba, o ejecuta{" "}
              <code className="rounded bg-panel-2 px-1">npx tsx scripts/sembrar-conocimiento.ts</code> para cargar la
              normativa estatal de incendios forestales.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-panel-border text-xs uppercase text-subtle">
                <tr>
                  <th className="py-2 pr-3">Documento</th>
                  <th className="py-2 pr-3">Ámbito</th>
                  <th className="py-2 pr-3 text-right">Fragmentos</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {documentos.map((d) => (
                  <tr key={d.id} className="border-b border-panel-border align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-foreground">{d.titulo}</span>
                      <span className="block text-xs text-muted">{d.nombreArchivo}</span>
                    </td>
                    <td className="py-2 pr-3 text-muted">
                      {d.ambito}
                      {d.territorio ? ` · ${d.territorio}` : ""}
                    </td>
                    <td className="tabular py-2 pr-3 text-right">{d.numChunks}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          d.estado === "listo"
                            ? "bg-success/15 text-foreground"
                            : d.estado === "error"
                              ? "bg-danger/15 text-foreground"
                              : "bg-warning/15 text-foreground"
                        }`}
                      >
                        {d.estado}
                      </span>
                      {d.error && <span className="block text-xs text-danger">{d.error}</span>}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Boton
                          tamano="sm"
                          icono={<FileText />}
                          onClick={() => {
                            setDocumentoGrafo(d.id);
                            seccionGrafo.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                        >
                          Ver en el grafo
                        </Boton>
                        <Boton tamano="sm" variante="peligro" icono={<Trash2 />} onClick={() => void borrar(d.id)}>
                          Borrar
                        </Boton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
