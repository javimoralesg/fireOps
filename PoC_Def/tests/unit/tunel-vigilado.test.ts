// Prueba de extremo a extremo de scripts/tunel-vigilado.sh, SIN red. DUEÑO: sesión fireops-82.
// Reproduce los dos fallos del 19-09:
//   · la app se reinicia (npm run dev) → el guardián NO debe tocar el túnel (antes regeneraba
//     un túnel sano);
//   · el túnel muere → debe abrir otro y SEGUIR VIVO (antes moría con "unbound variable").
// El script real se ejecuta en una copia temporal con un `tunel.sh` falso: en vez de
// cloudflared, levanta un servidor local que hace de "URL pública" y la escribe en
// data/url-publica.txt, igual que el de verdad.
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORIGEN = fileURLToPath(new URL("../../scripts/tunel-vigilado.sh", import.meta.url));
const tienePython = (() => {
  try {
    execSync("python3 --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function esperar<T>(que: string, f: () => T | undefined | false, msMax: number): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const v = f();
    if (v) return v;
    await dormir(200);
  }
  throw new Error(`Se agotó la espera: ${que}`);
}
async function codigo(url: string): Promise<number> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).status;
  } catch {
    return 0;
  }
}

describe.skipIf(!tienePython)("scripts/tunel-vigilado.sh · el túnel se regenera solo y el guardián no muere", () => {
  const PUERTO_APP = 39000 + Math.floor(Math.random() * 400);
  const PUERTO_PUBLICO_BASE = PUERTO_APP + 500;
  let dir = "";
  let guardian: ChildProcess | undefined;
  let registro = "";
  let app: Server | undefined;
  let recuperaciones = 0;

  const archivoUrl = () => join(dir, "data", "url-publica.txt");
  const urlPublica = () => {
    try {
      return readFileSync(archivoUrl(), "utf8").trim();
    } catch {
      return "";
    }
  };
  const arrancarApp = () =>
    new Promise<void>((ok) => {
      app = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/api/happyrobot/recuperar") recuperaciones += 1;
        res.writeHead(req.url?.startsWith("/api/salud") || req.method === "POST" ? 200 : 404, { "content-type": "application/json" });
        res.end('{"ok":true}');
      }).listen(PUERTO_APP, "127.0.0.1", () => ok());
    });
  const pararApp = () => new Promise<void>((ok) => (app ? app.close(() => ok()) : ok()));

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "tunel-vigilado-"));
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "data"));
    copyFileSync(ORIGEN, join(dir, "scripts", "tunel-vigilado.sh"));
    chmodSync(join(dir, "scripts", "tunel-vigilado.sh"), 0o755);
    writeFileSync(join(dir, ".env.local"), "HAPPYROBOT_WEBHOOK_SECRET=prueba\n");
    // tunel.sh FALSO: servidor local con /api/salud en un puerto nuevo cada vez; escribe su URL y
    // la vacía al terminar, como el de verdad. Se llama "scripts/tunel.sh <puerto>" para que el
    // guardián lo reconozca y lo pueda cerrar igual que al real.
    writeFileSync(
      join(dir, "scripts", "tunel.sh"),
      `#!/usr/bin/env bash
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
N=$(( $(cat "$DIR/data/contador" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$DIR/data/contador"
P=$(( ${PUERTO_PUBLICO_BASE} + N ))
mkdir -p "$DIR/www$N/api" && echo ok > "$DIR/www$N/api/salud"
python3 -m http.server "$P" --bind 127.0.0.1 --directory "$DIR/www$N" >/dev/null 2>&1 &
HIJO=$!
trap 'kill $HIJO 2>/dev/null; : > "$DIR/data/url-publica.txt"; exit 0' INT TERM HUP
sleep 0.5
echo "http://127.0.0.1:$P" > "$DIR/data/url-publica.txt"
wait $HIJO
: > "$DIR/data/url-publica.txt"
`,
    );
    chmodSync(join(dir, "scripts", "tunel.sh"), 0o755);
    await arrancarApp();
    guardian = spawn("bash", [join(dir, "scripts", "tunel-vigilado.sh"), String(PUERTO_APP)], {
      cwd: dir,
      env: { ...process.env, TUNEL_VIGILADO_CADA: "1", TUNEL_VIGILADO_FALLOS: "3", LC_ALL: "es_ES.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    guardian.stdout?.on("data", (d) => (registro += d.toString()));
    guardian.stderr?.on("data", (d) => (registro += d.toString()));
  }, 30_000);

  afterAll(async () => {
    guardian?.kill("SIGTERM");
    await dormir(500);
    try {
      // UN solo patrón, y específico. Con `pkill -f "http.server" -f "${dir}"` el segundo `-f` se leía como
      // OTRO patrón ("-f") y mataba todo proceso con "-f" en su línea de comandos: los helpers de Electron
      // (`--enable-features`, `--field-trial-handle`) y el propio IDE se cerraban con "killed, code 15"
      // cada vez que corría esta suite (19-09, dos veces).
      execSync(`pkill -f "python3 -m http.server [0-9]+ --bind 127.0.0.1 --directory ${dir}/" 2>/dev/null || true`);
      execSync(`pkill -f "scripts/tunel.sh ${PUERTO_APP}" 2>/dev/null || true`);
      for (let n = 1; n <= 10; n++) execSync(`pkill -f "http.server ${PUERTO_PUBLICO_BASE + n}" 2>/dev/null || true`);
    } catch {
      /* limpieza tolerante */
    }
    await pararApp();
    rmSync(dir, { recursive: true, force: true });
  });

  it("al arrancar abre un túnel y su URL responde", async () => {
    const url = await esperar("URL pública escrita", () => urlPublica() || undefined, 10_000);
    await esperar("la URL responde", async () => (await codigo(`${url}/api/salud`)) === 200 || undefined, 5_000).catch(async () => {
      expect(await codigo(`${url}/api/salud`)).toBe(200);
    });
    expect(await codigo(`${url}/api/salud`)).toBe(200);
  }, 20_000);

  it("si la APP se reinicia, NO toca el túnel (misma URL) y espera a que vuelva", async () => {
    const antes = urlPublica();
    await pararApp();
    await dormir(6_000); // el doble de 3 fallos × 1 s: antes, aquí se regeneraba el túnel
    await arrancarApp();
    await dormir(2_000);
    expect(urlPublica()).toBe(antes);
    expect(registro).toMatch(/La app local \(:\d+\) no responde: espero/);
    expect(registro).not.toMatch(/Regenero el t/);
    expect(guardian?.exitCode).toBeNull();
  }, 20_000);

  it("si el TÚNEL muere, abre otro con URL nueva que responde, y el guardián sigue vivo", async () => {
    const antes = urlPublica();
    const puerto = new URL(antes).port;
    execSync(`pkill -f "http.server ${puerto}" 2>/dev/null || true`);
    const nueva = await esperar("URL nueva", () => {
      const u = urlPublica();
      return u && u !== antes ? u : undefined;
    }, 15_000);
    await dormir(800);
    expect(await codigo(`${nueva}/api/salud`)).toBe(200);
    expect(registro).toMatch(/Regenero el t/);
    expect(guardian?.exitCode).toBeNull();
  }, 25_000);

  it("nunca muere por una variable sin definir y pide la recuperación de llamadas al volver", () => {
    expect(registro).not.toMatch(/unbound variable/);
    expect(registro).toMatch(/Recupero lo que se perdiera/);
    expect(recuperaciones).toBeGreaterThanOrEqual(1);
  });
});
