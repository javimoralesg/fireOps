"use client";
// "Unir un móvil": QR y enlace a /movil, para que un teléfono haga de cámara en
// directo. DUEÑO: constructor E. Dependencia: qrcode (genera el PNG en cliente).

import { useEffect, useState } from "react";
import { Copy, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { Boton } from "@/components/ui/Boton";
import { Dialogo } from "@/components/ui/Dialogo";
import { useToast } from "@/components/ui/Toast";

export function DialogoMovil({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [imagen, setImagen] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    // Cámara y GPS del teléfono exigen HTTPS: si hay URL pública (túnel o Railway) el QR la usa;
    // `localhost` no sirve para otro dispositivo.
    (async () => {
      let base = window.location.origin;
      try {
        const r = await fetch("/api/salud", { cache: "no-store" });
        const j = (await r.json()) as { urlPublica?: { valor?: string | null } };
        const publica = j.urlPublica?.valor;
        if (publica && /^https:\/\//.test(publica)) base = publica.replace(/\/$/, "");
      } catch {
        /* sin salud: se usa el origen actual */
      }
      const destino = `${base}/movil`;
      if (!vivo) return;
      try {
        const img = await QRCode.toDataURL(destino, { width: 320, margin: 1, errorCorrectionLevel: "M" });
        if (!vivo) return;
        setUrl(destino);
        setImagen(img);
      } catch (e: unknown) {
        if (!vivo) return;
        setUrl(destino);
        setError(e instanceof Error ? e.message : "No se ha podido generar el código QR.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [abierto]);

  const sinHttps = url !== "" && !url.startsWith("https://");

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Unir un móvil como cámara"
      descripcion="Escanea el código con el teléfono: compartirá su ubicación y fotogramas, y el Vigía los analizará como una cámara más."
      ancho="sm"
      pie={
        <Boton variante="secundario" onClick={onCerrar}>
          Cerrar
        </Boton>
      }
    >
      <div className="flex flex-col items-center gap-3">
        {sinHttps ? (
          <p className="w-full rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-[12.5px] text-foreground" role="alert">
            <strong>Este enlace no es HTTPS</strong>: el teléfono no podrá usar la cámara ni el GPS. Lanza el túnel con{" "}
            <code>scripts/tunel.sh 3000</code> (o despliega en Railway) y vuelve a abrir este cuadro: el QR pasará a la URL pública.
          </p>
        ) : null}
        {imagen ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={imagen} alt={`Código QR con el enlace ${url}`} className="size-56 rounded-xl border border-panel-border bg-white p-2" />
        ) : error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : (
          <p className="text-[13px] text-muted">Generando el código…</p>
        )}
        <p className="flex items-center gap-1.5 break-all rounded-lg border border-panel-border bg-panel-2 px-2.5 py-1.5 text-[12.5px] text-muted">
          <Smartphone className="size-4 shrink-0" aria-hidden /> {url}
        </p>
        <Boton
          tamano="sm"
          icono={<Copy />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast.exito("Enlace copiado");
            } catch {
              toast.aviso("No se ha podido copiar", "Selecciona el texto y cópialo a mano.");
            }
          }}
        >
          Copiar el enlace
        </Boton>
      </div>
    </Dialogo>
  );
}
