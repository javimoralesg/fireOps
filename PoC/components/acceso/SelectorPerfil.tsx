"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  KeyRound,
  Megaphone,
  RadioTower,
  Scale,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { Logo } from "@/components/marca/Logo";
import {
  AMBITO_ETIQUETA,
  puede,
  ROLES,
  ROLES_LISTA,
  type Ambito,
  type DefinicionRol,
  type RolId,
} from "@/lib/roles";
import { guardarRol, useRol } from "@/lib/useRol";

const ORDEN: Ambito[] = ["direccion", "coordinacion", "apoyo", "plataforma"];

const COLOR_AMBITO: Record<Ambito, string> = {
  publico: "bg-info/15 text-info",
  direccion: "bg-brand/15 text-brand",
  coordinacion: "bg-warning/15 text-warning",
  apoyo: "bg-success/15 text-success",
  plataforma: "bg-panel-border text-muted",
};

interface Organismo {
  nombre: string;
  servicio: string;
  municipio: string;
}

const ORGANISMO_DEFECTO: Organismo = {
  nombre: "Ayuntamiento de Madrid",
  servicio: "Emergencias Madrid · SAMUR-PC",
  municipio: "Madrid",
};

function Capacidad({ rol }: { rol: DefinicionRol }) {
  if (rol.riesgoMaxDecision >= 100)
    return <span className="text-brand">Firma cualquier decisión</span>;
  if (rol.riesgoMaxDecision > 0)
    return (
      <span className="text-foreground">
        Decide hasta riesgo {rol.riesgoMaxDecision}
      </span>
    );
  if (rol.permisos.includes("publicar_aviso"))
    return <span className="text-foreground">Publica avisos oficiales</span>;
  if (
    rol.permisos.includes("ver_trazas_ia") &&
    !rol.permisos.includes("administrar")
  )
    return <span className="text-foreground">Audita a la IA</span>;
  if (rol.permisos.includes("gestionar_voluntarios"))
    return <span className="text-foreground">Gestiona voluntariado</span>;
  if (rol.permisos.includes("administrar"))
    return <span className="text-foreground">Configura la plataforma</span>;
  return <span>Consulta y escala</span>;
}

export function SelectorPerfil() {
  const router = useRouter();
  const { rol: rolActual, elegido } = useRol();
  const [organismo, setOrganismo] = useState<Organismo>(ORGANISMO_DEFECTO);
  const [entrando, setEntrando] = useState<RolId | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/estado", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((e) => {
        if (vivo && e?.organismo) setOrganismo(e.organismo);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const entrar = (id: RolId) => {
    setEntrando(id);
    guardarRol(id);
    router.push(ROLES[id].vistaInicial);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-14 lg:px-10 lg:py-14">
        {/* Columna de marca */}
        <section className="flex flex-col lg:sticky lg:top-14 lg:self-start">
          <Logo vivo />
          <p className="etiqueta mt-12">{organismo.servicio}</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            Centro de mando de {organismo.municipio}
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
            La IA propone con datos reales, cada cargo decide dentro de su
            responsabilidad y todo queda trazado. Entra con el perfil que tienes
            en el plan de emergencias.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-muted">
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
              Dirección única y escalado automático al cargo con autoridad (RD
              524/2023).
            </li>
            <li className="flex gap-3">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand" />
              Supervisión humana de la IA, auditable (Reglamento UE de IA, art.
              14).
            </li>
            <li className="flex gap-3">
              <Megaphone className="mt-0.5 size-4 shrink-0 text-brand" />
              Una sola voz oficial hacia la ciudadanía.
            </li>
          </ul>

          <a
            href="/ciudadano"
            onClick={(e) => {
              e.preventDefault();
              entrar("ciudadano");
            }}
            className="group mt-10 flex items-center gap-4 rounded-xl border border-info/30 bg-info/10 p-4 transition hover:border-info/60"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/20 text-info">
              <Users className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-foreground">
                ¿Eres ciudadano o ciudadana?
              </div>
              <div className="text-sm text-muted">
                Avisos oficiales y qué hacer, sin registro.
              </div>
            </div>
            <ArrowRight className="size-4 text-info transition group-hover:translate-x-0.5" />
          </a>

          <Link
            href="/periferico"
            className="group mt-3 flex items-center gap-3 rounded-xl border border-panel-border bg-panel px-4 py-3 text-sm transition hover:border-info/50"
          >
            <Smartphone className="size-4 shrink-0 text-info" />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-foreground">
                Envía un aviso desde tu móvil
              </span>
              <span className="block text-xs text-muted">
                Foto, voz o ubicación, directo al centro de mando.
              </span>
            </span>
            <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-info" />
          </Link>
        </section>

        {/* Columna de perfiles */}
        <section aria-labelledby="titulo-perfiles">
          <div className="superficie rounded-2xl border border-panel-border bg-panel p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2
                  id="titulo-perfiles"
                  className="text-lg font-semibold text-foreground"
                >
                  Acceso de personal
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Elige tu puesto en el plan de emergencias.
                </p>
              </div>
              <button
                type="button"
                disabled
                title="En producción, identificación con Cl@ve o certificado digital"
                className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-panel-border bg-panel-2 px-3 py-2 text-xs text-subtle"
              >
                <KeyRound className="size-3.5" /> Cl@ve · certificado digital
              </button>
            </div>

            <div className="mt-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
              Entorno de demostración: el acceso por perfil sustituye a la
              identificación real.
            </div>

            {ORDEN.map((ambito) => {
              const roles = ROLES_LISTA.filter((r) => r.ambito === ambito);
              return (
                <div key={ambito} className="mt-7">
                  <h3 className="etiqueta mb-3">{AMBITO_ETIQUETA[ambito]}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {roles.map((r) => {
                      const activo = elegido && r.id === rolActual;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => entrar(r.id)}
                          disabled={entrando !== null}
                          className={`group flex h-full flex-col rounded-xl border p-4 text-left transition ${
                            activo
                              ? "border-brand/60 bg-brand/10"
                              : "border-panel-border bg-panel-2 hover:border-panel-border-strong"
                          } disabled:opacity-60`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`flex size-10 shrink-0 items-center justify-center rounded-lg font-display text-sm font-semibold ${COLOR_AMBITO[r.ambito]}`}
                            >
                              {r.iniciales}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 font-semibold text-foreground">
                                {r.nombre}
                                {activo && (
                                  <Check
                                    className="size-4 text-brand"
                                    aria-label="perfil actual"
                                  />
                                )}
                              </div>
                              <div className="mt-0.5 text-xs leading-snug text-muted">
                                {r.cargoReal}
                              </div>
                            </div>
                          </div>
                          <p className="mt-3 flex-1 text-[13px] leading-relaxed text-muted">
                            {r.descripcion}
                          </p>
                          <div className="mt-3 flex items-center justify-between border-t border-panel-border pt-3 text-xs text-subtle">
                            <Capacidad rol={r} />
                            <span className="flex items-center gap-1 text-brand opacity-0 transition group-hover:opacity-100">
                              {entrando === r.id ? "Entrando…" : "Entrar"}{" "}
                              <ArrowRight className="size-3.5" />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="mt-7 border-t border-panel-border pt-5">
              <h3 className="etiqueta mb-3">Accesos directos</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/politica"
                  onClick={() => {
                    if (!elegido || !puede(rolActual, "ver_mando"))
                      guardarRol("director_plan");
                  }}
                  className="group flex items-center gap-3 rounded-xl border border-panel-border bg-panel-2 px-4 py-3 transition hover:border-panel-border-strong"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
                    <Scale className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground">
                      Política de autonomía de la IA
                    </div>
                    <div className="text-xs text-muted">
                      Qué hace la IA sola, qué firma una persona y qué queda
                      reservado · edita {ROLES.director_plan.nombre}
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/perifericos"
                  onClick={() => {
                    if (!(
                      elegido &&
                      (rolActual === "administrador" ||
                        rolActual === "jefe_sala_112")
                    ))
                      guardarRol("jefe_sala_112");
                  }}
                  className="group flex items-center gap-3 rounded-xl border border-panel-border bg-panel-2 px-4 py-3 transition hover:border-panel-border-strong"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                    <RadioTower className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground">
                      Sala de periféricos
                    </div>
                    <div className="text-xs text-muted">
                      Móviles emparejados, cámaras de tráfico y publicaciones ·
                      Administración y Sala 112
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-subtle">
            Roles adaptados de la Norma Básica de Protección Civil y del PEMAM.
            Detalle en docs/roles.md.
          </p>
        </section>
      </div>
    </div>
  );
}
