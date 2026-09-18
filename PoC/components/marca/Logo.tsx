// Identidad de marca de Atalaya v2: isotipo (torre vigía con baliza sobre una
// loseta petróleo) y logotipo. Colores vía tokens (--brand, --panel) para que
// funcione igual en tema claro y oscuro. Firmas estables (contrato con poc-18/26).

interface IsotipoProps {
  className?: string;
  /** Anima la baliza (usar solo en la cabecera, no en listas). */
  vivo?: boolean;
}

export function Isotipo({ className = "size-8", vivo = false }: IsotipoProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="atalaya-loseta" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-2)" />
          <stop offset="1" stopColor="var(--brand)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#atalaya-loseta)" />
      {/* Ondas de la baliza */}
      <path d="M9.6 10.6a8.2 8.2 0 0 1 12.8 0" fill="none" stroke="var(--panel)" strokeWidth="1.7" strokeLinecap="round" opacity="0.55" />
      <path d="M12.4 13a4.6 4.6 0 0 1 7.2 0" fill="none" stroke="var(--panel)" strokeWidth="1.7" strokeLinecap="round" />
      {/* Baliza */}
      <circle cx="16" cy="15.6" r="1.7" fill="var(--panel)" className={vivo ? "baliza-viva" : undefined} />
      {/* Torre */}
      <rect x="11.6" y="18.4" width="8.8" height="2.4" rx="1.2" fill="var(--panel)" />
      <path d="M13.4 21.6h5.2l1.3 6.4H12.1z" fill="var(--panel)" />
    </svg>
  );
}

interface LogoProps {
  /** Muestra el descriptor bajo el nombre. */
  descriptor?: boolean;
  vivo?: boolean;
  className?: string;
}

export function Logo({ descriptor = true, vivo = false, className = "" }: LogoProps) {
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <Isotipo className="size-9 shrink-0" vivo={vivo} />
      <div className="min-w-0 leading-none">
        <div className="font-display text-[17px] font-bold tracking-[-0.01em] text-foreground">Atalaya</div>
        {descriptor && (
          <div className="mt-1 truncate text-[11px] font-medium text-muted">Mando de crisis · IA supervisada</div>
        )}
      </div>
    </div>
  );
}
