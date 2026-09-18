"use client";

// Aviso de voz (poc-07, subagente B). Web Speech API en es-ES con resultados
// parciales mientras se mantiene pulsado el botón; el textarea siempre es
// editable, así que sin reconocimiento el aviso se escribe a mano.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Mic, Send } from "lucide-react";
import type { UsoPeriferico } from "@/lib/usePeriferico";
import { Aviso, BotonGrande, ResumenResultado, Tarjeta } from "./ui-movil";

interface AlternativaVoz {
  readonly transcript: string;
}
interface ResultadoVoz {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [indice: number]: AlternativaVoz;
}
interface ListaResultadosVoz {
  readonly length: number;
  readonly [indice: number]: ResultadoVoz;
}
interface EventoVoz extends Event {
  readonly resultIndex: number;
  readonly results: ListaResultadosVoz;
}
interface Reconocedor {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: EventoVoz) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
type ConstructorReconocedor = new () => Reconocedor;
type VentanaConVoz = Window & {
  SpeechRecognition?: ConstructorReconocedor;
  webkitSpeechRecognition?: ConstructorReconocedor;
};

function constructorVoz(): ConstructorReconocedor | null {
  if (typeof window === "undefined") return null;
  const w = window as VentanaConVoz;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Si hay reconocimiento de voz solo se sabe en el navegador: se lee como un
// almacén externo para que el render del servidor no desentone al hidratar.
function suscribirNada(): () => void {
  return () => {};
}

function hayReconocimiento(): boolean {
  return constructorVoz() !== null;
}

export function VozMovil({ per }: { per: UsoPeriferico }) {
  const refReconocedor = useRef<Reconocedor | null>(null);
  const refFinal = useRef("");
  const refDictado = useRef(false);
  const hayVoz = useSyncExternalStore(suscribirNada, hayReconocimiento, () => false);
  const [escuchando, setEscuchando] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const { enviarObservacion, ultimoResultado, esSeguro } = per;

  const parar = useCallback(() => {
    setEscuchando(false);
    try {
      refReconocedor.current?.stop();
    } catch {
      /* ya estaba parado */
    }
  }, []);

  const arrancar = useCallback(() => {
    const Constructor = constructorVoz();
    if (!Constructor) return;
    setAviso(null);
    setOk(false);
    refFinal.current = texto ? `${texto.trim()} ` : "";
    const r = new Constructor();
    r.lang = "es-ES";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        const frase = res[0]?.transcript ?? "";
        if (res.isFinal) refFinal.current += `${frase} `;
        else parcial += frase;
      }
      setTexto((refFinal.current + parcial).trimStart());
    };
    r.onerror = () => {
      setAviso("El dictado se ha cortado. Puedes escribir el aviso a mano.");
      setEscuchando(false);
    };
    r.onend = () => setEscuchando(false);
    refReconocedor.current = r;
    try {
      r.start();
      refDictado.current = true;
      setEscuchando(true);
    } catch {
      setAviso("No se pudo abrir el micrófono");
    }
  }, [texto]);

  useEffect(() => {
    return () => {
      try {
        refReconocedor.current?.abort();
      } catch {
        /* nada que abortar */
      }
    };
  }, []);

  async function enviar() {
    const limpio = texto.trim();
    if (!limpio) {
      setAviso("Escribe o dicta el aviso antes de enviarlo");
      return;
    }
    parar();
    setEnviando(true);
    setAviso(null);
    try {
      await enviarObservacion({ tipo: refDictado.current ? "voz" : "texto", texto: limpio });
      setTexto("");
      refFinal.current = "";
      refDictado.current = false;
      setOk(true);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta>
        <p className="etiqueta">Aviso por voz</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
          {hayVoz
            ? "Mantén pulsado el botón y describe lo que ves. Al soltar puedes corregir el texto antes de enviarlo."
            : "Este navegador no reconoce voz: escribe el aviso y envíalo igual."}
        </p>

        {hayVoz && (
          <button
            type="button"
            onPointerDown={arrancar}
            onPointerUp={parar}
            onPointerLeave={parar}
            onPointerCancel={parar}
            disabled={!esSeguro}
            aria-pressed={escuchando}
            className={`boton mt-3 min-h-[72px] w-full select-none px-4 text-[16px] ${escuchando ? "boton-peligro" : "boton-primario"}`}
          >
            <Mic className={`size-6 ${escuchando ? "animate-pulse" : ""}`} aria-hidden="true" />
            {escuchando ? "Escuchando… suelta para parar" : "Mantén pulsado para hablar"}
          </button>
        )}

        {!esSeguro && hayVoz && (
          <p className="mt-2 text-[12.5px] text-subtle">Sin HTTPS el micrófono no está disponible; escribe el aviso a mano.</p>
        )}

        <label htmlFor="texto-voz" className="etiqueta mt-3 block">
          Transcripción
        </label>
        <textarea
          id="texto-voz"
          className="mt-1.5 min-h-[120px] w-full rounded-xl border border-panel-border bg-panel-2 px-3 py-2 text-[16px] leading-relaxed text-foreground placeholder:text-subtle focus:border-brand focus:outline-none"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Hay humo denso en la calle Méndez Álvaro, a la altura del número 40."
          maxLength={600}
        />

        <div className="mt-3">
          <BotonGrande onClick={enviar} deshabilitado={enviando || !texto.trim()}>
            {enviando ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Send className="size-5" aria-hidden="true" />}
            {enviando ? "Enviando…" : "Enviar aviso"}
          </BotonGrande>
        </div>
      </Tarjeta>

      {aviso && (
        <Aviso tono="peligro" titulo="No se pudo enviar">
          {aviso}
        </Aviso>
      )}
      {ok && !aviso && <Aviso tono="exito" titulo="Aviso enviado">El centro de mando ya lo está procesando.</Aviso>}

      {ultimoResultado && <ResumenResultado resultado={ultimoResultado} />}
    </div>
  );
}
