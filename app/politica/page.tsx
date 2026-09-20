// /politica · Política de autonomía: quién decide qué. DUEÑO: constructor D.
import Link from "next/link";
import EditorPolitica from "@/components/politica/EditorPolitica";

export const metadata = {
  title: "Política de autonomía · Atalaya",
  description: "Qué puede hacer cada agente por su cuenta y qué tiene que aprobar una persona.",
};

export default function PaginaPolitica() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <Link href="/" className="text-sm font-medium text-slate-500 hover:text-slate-900">
          ← Sala de mando
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Política de autonomía</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Aquí se decide hasta dónde llegan los agentes solos. Nada de lo que cambies aquí ejecuta nada: solo cambia quién tiene que dar el
          visto bueno la próxima vez. Lo que ya está en marcha sigue su curso.
        </p>
      </header>
      <EditorPolitica />
    </main>
  );
}
