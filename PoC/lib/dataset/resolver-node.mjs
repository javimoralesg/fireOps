// Permite ejecutar los .ts del dataset con Node ≥ 22.18 (type stripping) sin instalar tsx:
//   node --import ./lib/dataset/resolver-node.mjs lib/dataset/validar.ts
// Node no resuelve imports relativos sin extensión; este hook prueba con ".ts" e "/index.ts".
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(especificador, contexto, siguiente) {
    const relativo = especificador.startsWith("./") || especificador.startsWith("../");
    if (relativo && !/\.[cm]?[jt]s$/.test(especificador) && contexto.parentURL) {
      for (const ext of [".ts", "/index.ts"]) {
        const url = new URL(especificador + ext, contexto.parentURL);
        if (existsSync(fileURLToPath(url))) return siguiente(url.href, contexto);
      }
    }
    return siguiente(especificador, contexto);
  },
});
