// /parte · Formulario ciudadano de aviso de incendio. DUEÑO: constructor D.
import Link from "next/link";
import FormularioParte from "@/components/publico/FormularioParte";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dar parte de un incendio · Atalaya",
  description: "Avisa a la sala de coordinación de un incendio forestal con tu ubicación.",
};

export default function PaginaParte() {
  const urlLlamadaWeb = process.env.HAPPYROBOT_WEB_CALL_URL?.trim() || undefined;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <Link href="/publico" className="text-sm font-medium text-slate-500 hover:text-slate-900">
          ← Información a la ciudadanía
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Dar parte de un incendio</h1>
        <p className="mt-2 text-slate-600">Tu aviso entra directamente en la sala de coordinación y se cruza con el satélite, las cámaras y el resto de llamadas.</p>
      </header>
      <FormularioParte urlLlamadaWeb={urlLlamadaWeb} />
    </main>
  );
}
