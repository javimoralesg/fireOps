// Helpers para las route handlers: JSON, errores y lectura tolerante del body.

export function ok(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function fallo(err: unknown, status = 400) {
  const mensaje = err instanceof Error ? err.message : String(err);
  return Response.json({ error: mensaje }, { status, headers: { "cache-control": "no-store" } });
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function comprobarSecretoWebhook(req: Request): boolean {
  const esperado = process.env.HAPPYROBOT_WEBHOOK_SECRET?.trim();
  if (!esperado) return true; // sin secreto configurado se acepta (demo)
  const recibido = req.headers.get("x-webhook-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return recibido === esperado;
}
