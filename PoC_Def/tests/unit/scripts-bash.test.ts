// Higiene de los scripts bash (scripts/*.sh). DUEÑO: sesión fireops-82 (2026-09-19).
// Motivo: el 19-09 el guardián del túnel murió al regenerarlo con "PUERTO: unbound
// variable": en bash 3.2 de macOS, "$PUERTO…" (puntos suspensivos pegados) se lee como
// la variable "PUERTO…" y, con `set -u`, el script se cae. Mismo fallo en dev-movil.sh.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../../scripts/", import.meta.url));
const SCRIPTS = readdirSync(DIR).filter((f) => f.endsWith(".sh"));

/** Líneas (sin comentarios) con una variable $NOMBRE pegada a un carácter no ASCII. */
export function variablesPegadasANoAscii(fuente: string): string[] {
  return fuente
    .split("\n")
    .map((linea, i) => ({ linea, n: i + 1 }))
    .filter(({ linea }) => !linea.trim().startsWith("#"))
    .filter(({ linea }) => /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/.test(linea))
    .map(({ linea, n }) => `${n}: ${linea.trim()}`);
}

describe("scripts bash", () => {
  it("hay scripts que revisar (tunel.sh, tunel-vigilado.sh, dev-movil.sh…)", () => {
    expect(SCRIPTS).toEqual(expect.arrayContaining(["tunel.sh", "tunel-vigilado.sh", "dev-movil.sh"]));
  });

  it("el detector reconoce el fallo real y no da falsos positivos", () => {
    expect(variablesPegadasANoAscii('echo "Abriendo túnel nuevo hacia :$PUERTO…"')).toHaveLength(1);
    expect(variablesPegadasANoAscii('echo "Abriendo túnel nuevo hacia :${PUERTO}…"')).toEqual([]);
    expect(variablesPegadasANoAscii('echo "túnel hacia $PUERTO …"')).toEqual([]);
    expect(variablesPegadasANoAscii('# comentario con "$PUERTO…"')).toEqual([]);
  });

  for (const script of SCRIPTS) {
    it(`${script}: ninguna variable pegada a un carácter no ASCII (usar \${VAR})`, () => {
      expect(variablesPegadasANoAscii(readFileSync(`${DIR}${script}`, "utf8"))).toEqual([]);
    });
    it(`${script}: bash lo compila (bash -n)`, () => {
      expect(() => execFileSync("bash", ["-n", `${DIR}${script}`], { stdio: "pipe" })).not.toThrow();
    });
  }
});
