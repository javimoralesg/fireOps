// Bloques del portal ciudadano. Presentacionales: reciben la VistaPublica ya filtrada.

import Link from "next/link";
import type { ReactNode } from "react";
import { BotonApuntarse } from "./BotonApuntarse";
import {
  ArrowUp,
  BadgeCheck,
  Ban,
  BatteryLow,
  Building2,
  CircleCheck,
  Clock,
  DoorClosed,
  Fan,
  HeartHandshake,
  HeartPulse,
  House,
  Info,
  LogIn,
  MapPin,
  Megaphone,
  Navigation,
  Newspaper,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Siren,
  TriangleAlert,
  Users,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  esCoordenada,
  FASE_PUBLICA,
  haceTiempo,
  horaCorta,
  humoHacia,
  lecturasAire,
  limpiarTexto,
  num0,
  resumenAire,
  tituloPublico,
  zonaCorta,
  type Gravedad,
  type SituacionLegible,
} from "./interpretar";
import type { AvisoPublico, BuloDesmentido, IncidentePublico, NoticiaVerificada, TareaPublica, VistaPublica } from "./tipos";

// ---------- Tokens por gravedad (clases literales para que Tailwind las detecte) ----------

const TONO: Record<Gravedad, { texto: string; fondo: string; borde: string; punto: string; chip: string }> = {
  danger: { texto: "text-danger", fondo: "bg-danger/10", borde: "border-danger/45", punto: "bg-danger", chip: "bg-danger text-background" },
  warning: { texto: "text-warning", fondo: "bg-warning/10", borde: "border-warning/45", punto: "bg-warning", chip: "bg-warning text-background" },
  success: { texto: "text-success", fondo: "bg-success/10", borde: "border-success/40", punto: "bg-success", chip: "bg-success text-background" },
  info: { texto: "text-info", fondo: "bg-info/10", borde: "border-info/40", punto: "bg-info", chip: "bg-info text-background" },
};

function Seccion({ id, titulo, icono: Icono, children, extra }: { id: string; titulo: string; icono: LucideIcon; children: ReactNode; extra?: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-titulo`} className="min-w-0">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <h2 id={`${id}-titulo`} className="flex items-center gap-2 text-[19px] font-semibold text-foreground">
          <Icono className="size-5 text-brand" aria-hidden="true" />
          {titulo}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

// ---------- 2. Banner de situación ----------

function fraseSiEstas(inc: IncidentePublico, zona: string, vista: VistaPublica): string {
  if (!inc.activo || inc.fase === "cierre") {
    const extra = String(inc.tipo).startsWith("incendio")
      ? " Ventila tu casa si notas olor a humo."
      : inc.tipo === "inundacion"
        ? " No entres en garajes ni sótanos hasta que los revisen."
        : "";
    return `Si estabas en ${zona}: puedes volver a la normalidad.${extra}`;
  }
  if (inc.tipo === "apagon") return `Si estás en ${zona}: no uses ascensores y desconecta los aparatos eléctricos.`;
  if (inc.tipo === "inundacion") return `Si estás en ${zona}: sube a una planta alta y no bajes a garajes ni sótanos.`;
  const v = vista.entorno?.viento;
  const hacia = v ? ` o al ${humoHacia(v.direccionGrados).nombre} del incendio` : "";
  return `Si estás en ${zona}${hacia}: quédate en interior con puertas y ventanas cerradas.`;
}

export function BannerSituacion({ vista, situacion, ahora }: { vista: VistaPublica; situacion: SituacionLegible; ahora: number }) {
  const inc = vista.incidente!;
  const tono = TONO[situacion.gravedad];
  const zonasAviso = [...new Set(vista.avisos.flatMap((a) => a.zonas ?? []))];
  const zona = zonaCorta(inc.ubicacion, vista.organismo.municipio, zonasAviso);
  const ubicBruta = typeof inc.ubicacion === "string" ? inc.ubicacion : inc.ubicacion.nombre;
  const ubic = esCoordenada(ubicBruta) ? (zonasAviso.length ? `${zonasAviso.join(", ")} · ${vista.organismo.municipio}` : "Ver mapa") : ubicBruta;
  const Icono = situacion.gravedad === "success" ? CircleCheck : situacion.gravedad === "danger" ? Siren : TriangleAlert;
  const ultimoAviso = vista.avisos.map((a) => a.publicadoEn).sort().at(-1) ?? null;

  return (
    <section aria-labelledby="situacion-titulo" className={`superficie overflow-hidden rounded-2xl border ${tono.borde} bg-panel`}>
      <div className={`${tono.fondo} px-5 pb-5 pt-4 sm:px-7 sm:pb-6 sm:pt-5`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-bold uppercase tracking-[0.08em] ${tono.chip}`}>
            <Icono className="size-4" aria-hidden="true" />
            {situacion.estado}
          </span>
          <span className={`text-[14px] font-medium ${tono.texto}`}>{situacion.etiqueta}</span>
        </div>

        <h1 id="situacion-titulo" className="mt-3 text-[26px] font-semibold leading-[1.15] text-foreground sm:text-[32px]">
          {tituloPublico(inc.titulo, zonasAviso)}
        </h1>
        <p className="mt-2 flex items-start gap-1.5 text-[15px] text-muted">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{ubic}</span>
        </p>
      </div>

      <div className="border-t border-panel-border px-5 py-4 sm:px-7 sm:py-5">
        <p className="text-[18px] font-semibold leading-snug text-foreground sm:text-[20px]">{fraseSiEstas(inc, zona, vista)}</p>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[14px] text-muted">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Fase</dt>
            <span className={`size-2 rounded-full ${tono.punto}`} aria-hidden="true" />
            <dd>{FASE_PUBLICA[inc.fase] ?? inc.fase}</dd>
          </div>
          {ultimoAviso && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Último aviso</dt>
              <Clock className="size-4" aria-hidden="true" />
              <dd>
                Último aviso oficial a las {horaCorta(ultimoAviso)} · {haceTiempo(ultimoAviso, ahora)}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}

// ---------- 3. Qué hacer ahora ----------

const ICONOS_RECOMENDACION: [RegExp, LucideIcon][] = [
  [/112|llama/i, Phone],
  [/humo se desplaza|el viento lleva/i, Wind],
  [/evacu/i, Navigation],
  [/ventana|puerta|ventilaci/i, DoorClosed],
  [/evit[ae] la zona|calles libres|no cruces/i, Ban],
  [/oficial|bulo|compartas|rumor/i, ShieldCheck],
  [/ejercicio|asma|respira|mascarilla/i, HeartPulse],
  [/interior|edificio|casa|planta alta|pisos altos/i, House],
  [/aire acondicionado/i, Fan],
  [/bater[ií]a|m[oó]vil/i, BatteryLow],
  [/el[eé]ctric|luz|ascensor/i, Zap],
  [/garaje|s[oó]tano|inund/i, Waves],
];

function iconoPara(texto: string): LucideIcon {
  return ICONOS_RECOMENDACION.find(([re]) => re.test(texto))?.[1] ?? Info;
}

function partir(texto: string): [string, string] {
  const i = texto.search(/[.:;]\s/);
  if (i < 0) return [texto, ""];
  const resto = texto.slice(i + 2).trim();
  return [`${texto.slice(0, i)}.`, resto.charAt(0).toUpperCase() + resto.slice(1)];
}

export function QueHacer({ recomendaciones }: { recomendaciones: string[] }) {
  if (!recomendaciones.length) return null;
  return (
    <Seccion id="que-hacer" titulo="Qué hacer ahora" icono={ShieldAlert}>
      <ol className="space-y-2.5">
        {recomendaciones.slice(0, 5).map((r, i) => {
          const Icono = iconoPara(r);
          const [cabeza, resto] = partir(r);
          return (
            <li key={i} className="superficie flex gap-4 rounded-xl border border-panel-border bg-panel px-4 py-4 sm:px-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand ring-1 ring-brand/25">
                <Icono className="size-[22px]" aria-hidden="true" />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[16.5px] font-semibold leading-snug text-foreground">{cabeza}</p>
                {resto && <p className="mt-1 text-[15px] leading-relaxed text-muted">{resto}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </Seccion>
  );
}

// ---------- 4. Avisos oficiales ----------

function tonoAviso(nivel: AvisoPublico["nivel"]): Gravedad {
  const n = String(nivel).toLowerCase();
  if (/alerta|critic|grave|rojo|evacu/.test(n)) return "danger";
  if (/aviso|alta|media|naranja|amarillo|precauci/.test(n)) return "warning";
  return "info";
}

const ETIQUETA_NIVEL: Record<Gravedad, string> = { danger: "Alerta", warning: "Aviso", info: "Información", success: "Fin de aviso" };

export function Avisos({ avisos, organismo, ahora }: { avisos: AvisoPublico[]; organismo: string; ahora: number }) {
  const lista = [...avisos].sort((a, b) => b.publicadoEn.localeCompare(a.publicadoEn));
  return (
    <Seccion id="avisos" titulo="Avisos oficiales" icono={Megaphone} extra={<span className="text-[13px] text-subtle">{lista.length} publicados</span>}>
      <div aria-live="polite" aria-relevant="additions" className="space-y-2.5">
        {lista.length === 0 && (
          <p className="rounded-xl border border-panel-border bg-panel px-5 py-4 text-[15px] text-muted">Todavía no hay avisos publicados.</p>
        )}
        {lista.map((a, i) => {
          const g = tonoAviso(a.nivel);
          const t = TONO[g];
          return (
            <article key={a.id} className={`superficie relative overflow-hidden rounded-xl border border-panel-border bg-panel px-5 py-4 ${i === 0 ? "ring-1 ring-panel-border-strong" : ""}`}>
              <span className={`absolute inset-y-0 left-0 w-1 ${t.punto}`} aria-hidden="true" />
              <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
                <span className={`rounded-md px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-wider ${t.fondo} ${t.texto}`}>{ETIQUETA_NIVEL[g]}</span>
                <span className="inline-flex items-center gap-1 font-medium text-foreground/90">
                  <BadgeCheck className="size-4 text-brand" aria-hidden="true" />
                  Oficial · {organismo}
                </span>
                <time dateTime={a.publicadoEn} className="ml-auto text-subtle">
                  {horaCorta(a.publicadoEn)} · {haceTiempo(a.publicadoEn, ahora)}
                </time>
              </header>
              <h3 className="mt-2 text-[17px] font-semibold leading-snug text-foreground">{a.titulo}</h3>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">{a.texto}</p>
              {a.zonas && a.zonas.length > 0 && (
                <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Zonas afectadas:</span>
                  {a.zonas.map((z) => (
                    <span key={z} className="rounded-md border border-panel-border bg-panel-2 px-2 py-0.5">
                      {z}
                    </span>
                  ))}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </Seccion>
  );
}

// ---------- 5. Noticias verificadas y bulos ----------

export function NoticiasYBulos({ noticias, bulos, ahora }: { noticias: NoticiaVerificada[]; bulos: BuloDesmentido[]; ahora: number }) {
  const verificadas = noticias.filter((n) => n.verificado);
  return (
    <Seccion id="info" titulo="Información contrastada" icono={Newspaper}>
      <div className="superficie overflow-hidden rounded-xl border border-panel-border bg-panel">
        <h3 className="etiqueta flex items-center gap-1.5 border-b border-panel-border px-5 py-3 !text-[12px] !text-success">
          <CircleCheck className="size-4" aria-hidden="true" />
          Confirmado
        </h3>
        {verificadas.length === 0 ? (
          <p className="px-5 py-4 text-[15px] text-muted">Aún no hay información confirmada por los servicios de emergencia.</p>
        ) : (
          <ul className="divide-y divide-panel-border">
            {verificadas.slice(0, 6).map((n) => (
              <li key={n.id} className="px-5 py-3.5">
                <p className="text-[15.5px] font-medium leading-snug text-foreground">{limpiarTexto(n.titulo)}</p>
                <p className="mt-1 text-[13.5px] text-subtle">
                  {n.fuente} · <time dateTime={n.timestamp}>{haceTiempo(n.timestamp, ahora)}</time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="superficie mt-3 overflow-hidden rounded-xl border border-danger/30 bg-panel">
        <h3 className="etiqueta flex items-center gap-1.5 border-b border-panel-border px-5 py-3 !text-[12px] !text-danger">
          <Ban className="size-4" aria-hidden="true" />
          Bulos desmentidos
        </h3>
        {bulos.length === 0 ? (
          <p className="px-5 py-4 text-[15px] leading-relaxed text-muted">
            No hemos detectado bulos sobre esta emergencia. Desconfía de mensajes sin fuente oficial y no los reenvíes.
          </p>
        ) : (
          <ul className="divide-y divide-panel-border">
            {bulos.map((b) => (
              <li key={b.id} className="px-5 py-4">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 rounded-md bg-danger px-1.5 py-0.5 text-[11.5px] font-bold tracking-wider text-background">FALSO</span>
                  <p className="text-[15px] leading-snug text-muted line-through decoration-danger/70 decoration-2">{limpiarTexto(b.texto)}</p>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-foreground">
                  <span className="font-semibold text-success">Lo que sabemos: </span>
                  {limpiarTexto(b.desmentido)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Seccion>
  );
}

// ---------- 6. Aire y viento ----------

export function AireYViento({ entorno, incidenteTipo }: { entorno: VistaPublica["entorno"]; incidenteTipo?: string }) {
  if (!entorno) return null;
  const { viento, aire } = entorno;
  const humo = viento ? humoHacia(viento.direccionGrados) : null;
  const resumen = aire ? resumenAire(aire) : null;
  const esIncendio = incidenteTipo === "incendio_industrial";

  return (
    <Seccion id="entorno" titulo="Aire y viento" icono={Wind}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {viento && humo && (
          <div className="superficie flex items-center gap-4 rounded-xl border border-panel-border bg-panel px-5 py-4">
            <div className="relative flex size-16 shrink-0 items-center justify-center rounded-full border border-panel-border-strong bg-panel-2" aria-hidden="true">
              <span className="absolute top-1 text-[10px] font-semibold text-subtle">N</span>
              <ArrowUp className="size-7 text-accent transition-transform duration-700" style={{ transform: `rotate(${humo.grados}deg)` }} />
            </div>
            <div className="min-w-0">
              <p className="text-[16.5px] font-semibold leading-snug text-foreground">
                {esIncendio ? `El humo va hacia el ${humo.nombre}` : `Viento hacia el ${humo.nombre}`}
              </p>
              <p className="mt-1 text-[14.5px] leading-snug text-muted">
                Viento del {humoHacia(viento.direccionGrados + 180).nombre} a {num0(viento.velocidadKmh)} km/h
                {esIncendio && viento.velocidadKmh < 8 ? " (flojo: el humo se queda cerca)" : esIncendio && viento.velocidadKmh > 25 ? " (fuerte: el humo llega más lejos)" : ""}.
              </p>
            </div>
          </div>
        )}

        {aire && resumen && (
          <div className={`superficie rounded-xl border bg-panel px-5 py-4 ${TONO[resumen.gravedad].borde}`}>
            <p className={`flex items-center gap-2 text-[16.5px] font-semibold ${TONO[resumen.gravedad].texto}`}>
              <span className={`size-2.5 rounded-full ${TONO[resumen.gravedad].punto}`} aria-hidden="true" />
              {resumen.titulo}
            </p>
            <p className="mt-1 text-[14.5px] leading-snug text-muted">{resumen.consejo}</p>
            <ul className="mt-3 space-y-2.5">
              {lecturasAire(aire).map((l) => (
                <li key={l.clave}>
                  <div className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span className="text-muted">{l.nombre}</span>
                    <span className="font-mono text-foreground">
                      {l.valor} <span className="text-subtle">{l.unidad}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
                    <div className={`h-full rounded-full ${TONO[l.gravedad].punto}`} style={{ width: `${Math.min(100, Math.max(4, (l.ratio / 3) * 100))}%` }} />
                  </div>
                  <p className={`mt-1 text-[13.5px] ${TONO[l.gravedad].texto}`}>{l.frase}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-subtle">Medición de las {horaCorta(aire.timestamp)} · Referencia: guías OMS 2021 (24 h)</p>
          </div>
        )}
      </div>
    </Seccion>
  );
}

// ---------- 7. Voluntariado ----------

export function PuedesAyudar({ tareas }: { tareas: TareaPublica[] }) {
  const abiertas = tareas.filter((t) => t.estado === "abierta" || t.estado === "cubierta");
  return (
    <Seccion id="ayudar" titulo="Puedes ayudar" icono={HeartHandshake}>
      {abiertas.length === 0 ? (
        <div className="superficie rounded-xl border border-panel-border bg-panel px-5 py-4">
          <p className="text-[15.5px] font-medium text-foreground">Ahora mismo no se necesitan voluntarios.</p>
          <p className="mt-1 text-[14.5px] leading-relaxed text-muted">
            Si hace falta ayuda (llevar mantas, acompañar a personas mayores…), lo publicaremos aquí. No acudas a la zona por tu cuenta.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {abiertas.map((t) => {
            const lleno = t.estado === "cubierta" || t.aceptados >= t.cupo;
            const pct = Math.min(100, Math.round((t.aceptados / Math.max(1, t.cupo)) * 100));
            return (
              <li key={t.id} className="superficie rounded-xl border border-panel-border bg-panel px-5 py-4">
                <p className="text-[16px] font-semibold leading-snug text-foreground">{t.titulo}</p>
                {t.descripcion && <p className="mt-1 text-[14.5px] leading-relaxed text-muted">{t.descripcion}</p>}
                <p className="mt-2 flex items-center gap-1.5 text-[14px] text-muted">
                  <Building2 className="size-4 shrink-0" aria-hidden="true" />
                  {t.lugar}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={t.cupo} aria-valuenow={t.aceptados} aria-label="Plazas cubiertas">
                    <div className={`h-full rounded-full ${lleno ? "bg-success" : "bg-brand"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="flex items-center gap-1 font-mono text-[13.5px] text-muted">
                    <Users className="size-3.5" aria-hidden="true" />
                    {t.aceptados}/{t.cupo}
                  </span>
                </div>
                <BotonApuntarse tareaId={t.id} lleno={lleno} />
              </li>
            );
          })}
        </ul>
      )}
    </Seccion>
  );
}

// ---------- 8. Pie ----------

export function Pie({ organismo }: { organismo: VistaPublica["organismo"] | null }) {
  return (
    <footer className="mt-10 border-t border-panel-border bg-panel/60">
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 lg:max-w-6xl lg:px-8">
        <a
          href="tel:112"
          className="superficie flex items-center gap-4 rounded-xl border border-danger/40 bg-danger/10 px-5 py-4 transition-colors hover:bg-danger/15 sm:max-w-md"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-danger text-background">
            <Phone className="size-6" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-display text-[28px] font-bold leading-none text-foreground">112</span>
            <span className="mt-1 block text-[14px] text-muted">Solo emergencias. Gratuito, 24 h.</span>
          </span>
        </a>

        <div className="mt-6 flex flex-col gap-4 text-[14px] text-muted sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 font-medium text-foreground/90">
              <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
              Información oficial{organismo ? ` del ${organismo.nombre}` : ""}
            </p>
            {organismo && <p className="mt-1 text-subtle">{organismo.servicio}</p>}
            <p className="mt-1 text-[13px] text-subtle">Datos ambientales: Open-Meteo. Se actualiza cada 5 segundos.</p>
          </div>
          <Link href="/acceso" className="inline-flex items-center gap-1.5 self-start rounded-lg border border-panel-border px-3 py-2 text-[14px] text-muted transition-colors hover:border-panel-border-strong hover:text-foreground">
            <LogIn className="size-4" aria-hidden="true" />
            Acceso profesionales
          </Link>
        </div>
      </div>
    </footer>
  );
}

