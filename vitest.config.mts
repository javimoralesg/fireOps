// =====================================================================
// ATALAYA INCENDIOS · Configuración de pruebas. DUEÑO: constructor L.
// ---------------------------------------------------------------------
// Tres proyectos:
//   · unit        → tests/unit/**, entorno node, deterministas y SIN red.
//   · integracion → tests/integracion/**, contra el servidor vivo
//                   (ATALAYA_URL, por defecto http://localhost:3100),
//                   con agentes reales y tiempos largos.
//   · ui          → tests/ui/**, humo de pantallas (Playwright si está
//                   instalado; si no, se degrada a comprobar el HTML servido).
// Alias `@/` igual que en tsconfig.json.
// =====================================================================
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const raiz = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
const alias = { "@": raiz };
const entorno = ["tests/preparar-entorno.ts"];

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          setupFiles: entorno,
          testTimeout: 15_000,
          hookTimeout: 15_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integracion",
          include: ["tests/integracion/**/*.test.ts"],
          environment: "node",
          setupFiles: entorno,
          // Los agentes reales tardan: HelmCode puede pasar de 60 s por llamada.
          testTimeout: 300_000,
          hookTimeout: 300_000,
          // Un solo servidor compartido: nada de paralelizar ficheros ni tests.
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { concurrent: false },
          retry: 0,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "ui",
          include: ["tests/ui/**/*.test.ts"],
          environment: "node",
          setupFiles: entorno,
          testTimeout: 240_000,
          hookTimeout: 240_000,
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
  },
});
