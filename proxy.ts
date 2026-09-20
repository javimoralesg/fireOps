// Proxy de Next (antes "middleware"): solo actúa sobre la raíz "/".
// Un teléfono que entra por la URL del túnel sin ruta (la que imprime el script o
// la que se copia a mano) se encontraba con la sala de mando estrujada a 400 px.
// El móvil en esta app solo hace una cosa: ser cámara en /movil, así que ahí va.
// Escape para ver la sala en un teléfono a propósito: "/?sala".
// Next convierte la Location en relativa cuando el host coincide con el de la
// petición, así que detrás de cloudflared el teléfono se queda en el dominio público.
// DUEÑO: sesión fireops-2a (móvil por QR). Sin dependencias fuera de next/server.
import { NextResponse, type NextRequest } from "next/server";

const UA_MOVIL = /\b(iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone)\b/i;

export function proxy(peticion: NextRequest): NextResponse {
  const ua = peticion.headers.get("user-agent") ?? "";
  if (peticion.nextUrl.searchParams.has("sala") || !UA_MOVIL.test(ua)) return NextResponse.next();
  return NextResponse.redirect(new URL("/movil", peticion.url), 307);
}

export const config = { matcher: "/" };
