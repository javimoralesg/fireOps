// Marca "Atalaya": torre de vigía con una llama encendida arriba.
// DUEÑO: constructor E. SVG propio, sin dependencias ni imágenes externas.

export function Logo({ tamano = 28, className = "" }: { tamano?: number; className?: string }) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Atalaya"
      className={className}
      fill="none"
    >
      {/* Llama del vigía */}
      <path
        d="M16 2.4c2.4 2.5 3.4 4.3 3.4 6.1 0 2-1.5 3.4-3.4 3.4s-3.4-1.4-3.4-3.4c0-1.1.5-2.2 1.5-3.4.4.9.9 1.4 1.5 1.6-.2-1.6.1-2.9.4-4.3Z"
        fill="var(--fuego)"
      />
      {/* Cuerpo de la torre */}
      <path
        d="M11.4 13.6h9.2l1.3 3H10.1l1.3-3Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M11.6 18.1h8.8l1.6 10.3H10l1.6-10.3Z"
        fill="currentColor"
        opacity="0.65"
      />
      {/* Almenas y ventana */}
      <path d="M9.6 11.6h12.8v2H9.6z" fill="currentColor" />
      <rect x="14.6" y="20.4" width="2.8" height="4.4" rx="1.4" fill="var(--panel)" />
      {/* Suelo */}
      <path d="M7.4 28.4h17.2v1.9H7.4z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

/** Logo + nombre, para la barra superior. */
export function Marca({ organismo }: { organismo?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo tamano={30} className="shrink-0 text-brand" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[15px] font-semibold tracking-tight text-foreground">Atalaya</span>
        <span className="truncate text-[11px] text-muted">{organismo ?? "Sala de mando · Incendios forestales"}</span>
      </span>
    </span>
  );
}
