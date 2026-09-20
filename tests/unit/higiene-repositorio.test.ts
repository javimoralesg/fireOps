// Estos checks evitan volver a publicar estado de ejecución, URLs efímeras o
// cachés del compilador, sin impedir que crezca la documentación de protocolos.
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const raizRepo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

describe("higiene del repositorio", () => {
  it("no versiona artefactos generados por una ejecución o por TypeScript", () => {
    const generados = [
      "data/aprendizaje/ejecuciones.json",
      "data/aprendizaje/lecciones.json",
      "data/url-publica.txt",
      "tsconfig.tsbuildinfo",
    ];
    const versionados = execFileSync("git", ["ls-files", "--", ...generados], {
      cwd: raizRepo,
      encoding: "utf8",
    }).trim().split("\n").filter(Boolean);

    expect(versionados).toEqual([]);
  });

  it("permite añadir nuevos protocolos bajo data/protocolos", () => {
    const candidato = "data/protocolos/nuevo-protocolo.md";
    const comprobacion = spawnSync("git", ["check-ignore", "--no-index", candidato], {
      cwd: raizRepo,
      encoding: "utf8",
    });

    expect(comprobacion.status).toBe(1);
  });
});
