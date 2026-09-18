"use client";

// Muro social simulado (poc-07, subagente B): es por donde el jurado mete
// rumores y bulos. Alias + texto (280) + foto opcional; debajo, las
// publicaciones recientes con su estado de verificación y sus menciones.

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Send, Users } from "lucide-react";
import type { Publicacion } from "@/lib/tipos-perifericos";
import type { UsoPeriferico } from "@/lib/usePeriferico";
import { Aviso, BotonGrande, CLASE_ENTRADA, ChipVerificacion, Tarjeta, archivoABase64, formatearHora } from "./ui-movil";

const MAX = 280;
const REFRESCO_MS = 5000;

const ORIGEN_TEXTO: Record<Publicacion["origen"], string> = {
  periferico: "vecindario",
  exa: "prensa",
  gabinete: "oficial",
};

export function PublicarMovil({ per }: { per: UsoPeriferico }) {
  const { periferico, publicar, cargarPublicaciones } = per;
  const [alias, setAlias] = useState(periferico?.nombre ?? "");
  const [texto, setTexto] = useState("");
  const [imagen, setImagen] = useState<{ base64: string; miniatura: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [muro, setMuro] = useState<Publicacion[]>([]);
  const [falloMuro, setFalloMuro] = useState<string | null>(null);
  const refAliasTocado = useRef(false);

  useEffect(() => {
    if (!refAliasTocado.current && periferico?.nombre) setAlias(periferico.nombre);
  }, [periferico?.nombre]);

  const refPedir = useRef<() => void>(() => {});

  useEffect(() => {
    let vivo = true;
    async function ciclo() {
      try {
        const xs = await cargarPublicaciones();
        if (!vivo) return;
        setMuro(xs);
        setFalloMuro(null);
      } catch (err) {
        if (vivo) setFalloMuro(err instanceof Error ? err.message : String(err));
      }
    }
    refPedir.current = () => void ciclo();
    void ciclo();
    const id = window.setInterval(() => void ciclo(), REFRESCO_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [cargarPublicaciones]);

  async function elegirImagen(archivo: File | undefined) {
    if (!archivo) return;
    try {
      setImagen(await archivoABase64(archivo));
    } catch (err) {
      setAviso(err instanceof Error ? err.message : String(err));
    }
  }

  async function enviar() {
    const limpio = texto.trim();
    if (!limpio) {
      setAviso("Escribe algo antes de publicar");
      return;
    }
    setEnviando(true);
    setAviso(null);
    try {
      await publicar({ autor: alias.trim() || "Anónimo", texto: limpio, imagenBase64: imagen?.base64 });
      setTexto("");
      setImagen(null);
      refPedir.current();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta>
        <p className="etiqueta">Publicar en el muro</p>
        <label htmlFor="alias-publicacion" className="sr-only">
          Alias
        </label>
        <input
          id="alias-publicacion"
          className={`${CLASE_ENTRADA} mt-2`}
          value={alias}
          onChange={(e) => {
            refAliasTocado.current = true;
            setAlias(e.target.value);
          }}
          placeholder="Tu alias"
          maxLength={40}
        />
        <label htmlFor="texto-publicacion" className="sr-only">
          Texto de la publicación
        </label>
        <textarea
          id="texto-publicacion"
          className="mt-2 min-h-[110px] w-full rounded-xl border border-panel-border bg-panel-2 px-3 py-2 text-[16px] leading-relaxed text-foreground placeholder:text-subtle focus:border-brand focus:outline-none"
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, MAX))}
          placeholder="¿Qué está pasando ahí fuera?"
          maxLength={MAX}
        />
        <div className="mt-1 flex items-center justify-between">
          <label className="boton boton-secundario boton-sm min-h-[40px] cursor-pointer">
            <ImagePlus className="size-4" aria-hidden="true" />
            {imagen ? "Cambiar foto" : "Añadir foto"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                void elegirImagen(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <span className={`font-mono text-[12px] ${texto.length >= MAX ? "text-danger" : "text-subtle"}`}>
            {texto.length}/{MAX}
          </span>
        </div>

        {imagen && (
          <div className="mt-2 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagen.miniatura} alt="Foto adjunta" className="size-20 rounded-lg border border-panel-border object-cover" />
            <button type="button" className="boton boton-fantasma boton-sm min-h-[40px]" onClick={() => setImagen(null)}>
              Quitar foto
            </button>
          </div>
        )}

        <div className="mt-3">
          <BotonGrande onClick={enviar} deshabilitado={enviando || !texto.trim()}>
            {enviando ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Send className="size-5" aria-hidden="true" />}
            {enviando ? "Publicando…" : "Publicar"}
          </BotonGrande>
        </div>

        {aviso && (
          <div className="mt-3">
            <Aviso tono="peligro" titulo="No se pudo publicar">
              {aviso}
            </Aviso>
          </div>
        )}
      </Tarjeta>

      <section className="flex flex-col gap-2">
        <p className="etiqueta px-1">Publicaciones recientes</p>
        {falloMuro && <Aviso tono="aviso">{falloMuro}</Aviso>}
        {!falloMuro && muro.length === 0 && (
          <p className="px-1 text-[13.5px] text-muted">Todavía no hay publicaciones. La primera puede ser la tuya.</p>
        )}
        {muro.map((p) => (
          <article key={p.id} className="superficie rounded-2xl border border-panel-border bg-panel p-3">
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[14px] font-semibold text-foreground">{p.autor}</span>
              <span className="pildora">{ORIGEN_TEXTO[p.origen]}</span>
              <ChipVerificacion verificacion={p.verificacion} />
              {p.menciones > 1 && (
                <span className="pildora pildora-info">
                  <Users className="size-3" aria-hidden="true" />
                  {p.menciones} menciones
                </span>
              )}
              <span className="ml-auto font-mono text-[11.5px] text-subtle">{formatearHora(p.timestamp)}</span>
            </header>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-foreground">{p.texto}</p>
            {p.imagenUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imagenUrl} alt="Imagen de la publicación" className="mt-2 max-h-56 w-full rounded-lg border border-panel-border object-cover" />
            )}
            {p.verificacion?.motivo && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{p.verificacion.motivo}</p>}
          </article>
        ))}
      </section>
    </div>
  );
}
