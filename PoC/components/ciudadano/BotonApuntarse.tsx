"use client";

import { useState, useSyncExternalStore } from "react";
import { CABECERA_ROL } from "@/lib/roles";

// Inscripción de voluntariado desde el portal: POST /api/voluntarios/[id]/aceptar.
// Recuerda en este navegador a qué tareas se apuntó para no contar dos veces.

const CLAVE = "atalaya.voluntariado";

function apuntadas(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
  } catch {
    return [];
  }
}

export function BotonApuntarse({ tareaId, lleno }: { tareaId: string; lleno: boolean }) {
  const yaApuntado = useSyncExternalStore(
    () => () => {},
    () => apuntadas().includes(tareaId),
    () => false,
  );
  const [estado, setEstado] = useState<"libre" | "enviando" | "apuntado" | "error">("libre");
  const [error, setError] = useState<string | null>(null);

  const apuntarse = async () => {
    setEstado("enviando");
    setError(null);
    try {
      const r = await fetch(`/api/voluntarios/${encodeURIComponent(tareaId)}/aceptar`, {
        method: "POST",
        headers: { "content-type": "application/json", [CABECERA_ROL]: "ciudadano" },
        credentials: "omit",
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(cuerpo?.error ?? "No se pudo completar la inscripción");
      try {
        localStorage.setItem(CLAVE, JSON.stringify([...apuntadas(), tareaId]));
      } catch {
        /* sin almacenamiento: la inscripción ya cuenta en el servidor */
      }
      setEstado("apuntado");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la inscripción");
      setEstado("error");
    }
  };

  if (estado === "apuntado" || yaApuntado) {
    return (
      <p role="status" className="mt-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-center text-[15px] font-semibold text-success">
        Te has apuntado · gracias. Preséntate en el lugar indicado.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={apuntarse}
        disabled={lleno || estado === "enviando"}
        className="mt-3 w-full rounded-xl border border-brand/40 bg-brand/15 px-4 py-3 text-[15px] font-semibold text-brand transition hover:bg-brand/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {lleno ? "Cupo completo · gracias" : estado === "enviando" ? "Apuntando…" : "Me apunto"}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-center text-[13px] text-danger">
          {error}
        </p>
      )}
    </>
  );
}
