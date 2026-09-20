// /publico · Portal ciudadano: comunicados, mapa de focos y consejos. DUEÑO: constructor D.
import Link from "next/link";
import PortalCiudadano from "@/components/publico/PortalCiudadano";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Información a la ciudadanía · Atalaya",
  description: "Comunicados oficiales, incendios activos y qué hacer si el fuego se acerca.",
};

export default function PaginaPublica() {
  const organismo = process.env.ORGANISMO_NOMBRE?.trim() || "Centro de Coordinación de Incendios Forestales";
  const urlLlamadaWeb = process.env.HAPPYROBOT_WEB_CALL_URL?.trim() || undefined;
  // Número del 112 virtual (HappyRobot): lo atiende el agente de voz de «Atalaya · 112 entrante».
  const numeroEntrante = process.env.HAPPYROBOT_NUMERO_ENTRANTE?.trim() || undefined;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">{organismo}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Información a la ciudadanía</h1>
        <p className="mt-2 text-slate-600">
          Comunicados oficiales sobre los incendios forestales activos. Actualizado automáticamente.{" "}
          <Link href="/parte" className="font-medium text-amber-700 underline">
            Dar parte de un incendio
          </Link>
          .
        </p>
      </header>
      <PortalCiudadano urlLlamadaWeb={urlLlamadaWeb} numeroEntrante={numeroEntrante} />
    </main>
  );
}
