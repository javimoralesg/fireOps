// Carga `.env.local` en process.env antes de cualquier prueba. DUEÑO: constructor L.
// Next lo hace solo; vitest no. Sin esto, lib/ia/llm.ts arrancaría sin proveedor.
// No se imprime ninguna clave: solo se cuentan las variables cargadas.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));

for (const nombre of [".env.local", ".env"]) {
  const ruta = `${raiz}${nombre}`;
  if (!existsSync(ruta)) continue;
  for (const linea of readFileSync(ruta, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const i = limpia.indexOf("=");
    if (i < 1) continue;
    const clave = limpia.slice(0, i).trim();
    let valor = limpia.slice(i + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}
