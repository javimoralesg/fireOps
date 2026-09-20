// Las credenciales opcionales no son una avería: debe quedar claro en salud y
// en las capacidades que las consumen. Un proveedor configurado que no responde
// conserva, en cambio, su estado de error.
import { beforeEach, describe, expect, it, vi } from "vitest";

const dobles = vi.hoisted(() => ({
  firms: false,
  exa: false,
  aemet: false,
  vision: false,
  focosEspana: vi.fn<() => Promise<unknown[]>>(),
  proveedorDisponible: vi.fn<(papel?: string) => boolean>(),
}));

vi.mock("@/lib/fuentes/avisos", () => ({
  avisosMeteoalarmEspana: vi.fn(async () => []),
  aemetDisponible: () => dobles.aemet,
}));
vi.mock("@/lib/fuentes/bluesky", () => ({ buscarPosts: vi.fn(async () => []) }));
vi.mock("@/lib/fuentes/dgtCamaras", () => ({ listarCamarasDgt: vi.fn(async () => []), listarTodasLasCamaras: vi.fn(async () => []), imagenCamara: vi.fn() }));
vi.mock("@/lib/fuentes/camarasMadrid", () => ({ listarCamarasMadrid: vi.fn(async () => []) }));
vi.mock("@/lib/fuentes/camarasMovil", () => ({ fotogramaDe: vi.fn() }));
vi.mock("@/lib/fuentes/exa", () => ({ exaDisponible: () => dobles.exa, buscarNoticias: vi.fn(async () => []) }));
vi.mock("@/lib/fuentes/firms", () => ({
  firmsDisponible: () => dobles.firms,
  focosEspana: (...a: []) => dobles.focosEspana(...a),
  agruparFocos: vi.fn(() => []),
}));
vi.mock("@/lib/fuentes/openMeteo", () => ({ meteoActual: vi.fn(async () => ({ temperaturaC: 20, humedadPct: 30, vientoKmh: 5, direccionTexto: "N" })) }));
vi.mock("@/lib/fuentes/overpass", () => ({ pingOverpass: vi.fn(async () => "ok") }));
vi.mock("@/lib/fuentes/osrm", () => ({ ruta: vi.fn(async () => ({ distanciaM: 1_000, duracionS: 60 })) }));
vi.mock("@/lib/fuentes/nominatim", () => ({ municipioDe: vi.fn(async () => ({ municipio: "Ávila", provincia: "Ávila" })) }));
vi.mock("@/lib/fuentes/rss", () => ({ noticiasGoogle: vi.fn(async () => []) }));
vi.mock("@/lib/fuentes/geo", () => ({ haversine: vi.fn(() => 0) }));
vi.mock("@/lib/ia/llm", () => ({
  completarJson: vi.fn(),
  modeloPara: vi.fn(() => "modelo-vision"),
  motivoIndisponible: vi.fn((papel?: string) => `falta clave de ${papel ?? "razonamiento"}`),
  proveedorDisponible: dobles.proveedorDisponible,
}));

import { agenteSatelite } from "@/lib/agentes/percepcion/satelite";
import { agenteVigiaCamaras } from "@/lib/agentes/percepcion/vigiaCamaras";
import { GET as saludPrensa } from "@/app/api/fuentes/prensa/route";
import { GET as saludSatelite } from "@/app/api/fuentes/satelite/route";
import { comprobarFuentes } from "@/lib/fuentes/salud";

function contexto() {
  return {
    estado: { marcarServicio: vi.fn(), actualizar: vi.fn(), agentes: new Map() },
    informarTarea: vi.fn(),
  } as unknown as Parameters<typeof agenteVigiaCamaras.ciclo>[0];
}

beforeEach(() => {
  dobles.firms = false;
  dobles.exa = false;
  dobles.aemet = false;
  dobles.vision = false;
  dobles.focosEspana.mockReset();
  dobles.proveedorDisponible.mockReset();
  dobles.proveedorDisponible.mockImplementation((papel) => (papel === "vision" ? dobles.vision : true));
});

describe("servicios opcionales sin credenciales", () => {
  it("los expone como opcionales, no como fuentes caídas, y consulta la clave específica de visión", async () => {
    const fuentes = await comprobarFuentes();

    for (const nombre of ["NASA FIRMS", "Exa", "AEMET", "Visión"]) {
      expect(fuentes.find((f) => f.nombre === nombre)).toMatchObject({ ok: true, opcional: true });
    }
    expect(dobles.focosEspana).not.toHaveBeenCalled();
    expect(dobles.proveedorDisponible).toHaveBeenCalledWith("vision");
  });

  it("mantiene en rojo un FIRMS configurado que falla", async () => {
    dobles.firms = true;
    dobles.focosEspana.mockRejectedValueOnce(new Error("FIRMS 503 temporal"));

    const firms = (await comprobarFuentes()).find((f) => f.nombre === "NASA FIRMS");

    expect(firms).toMatchObject({ ok: false });
    expect(firms?.opcional).toBeUndefined();
    expect(firms?.detalle).toContain("FIRMS 503 temporal");
  });

  it("Vigía y Satélite quedan neutrales y no marcan una ficha errónea si falta su credencial opcional", async () => {
    const vigia = contexto();
    const satelite = contexto();

    await agenteVigiaCamaras.ciclo(vigia);
    await agenteSatelite.ciclo(satelite);

    expect(vigia.estado.marcarServicio).toHaveBeenCalledWith("Visión", true, expect.stringContaining("opcional"));
    expect(satelite.estado.marcarServicio).toHaveBeenCalledWith("NASA FIRMS", true, expect.stringContaining("opcional"));
    expect(vigia.estado.actualizar).not.toHaveBeenCalled();
    expect(satelite.estado.actualizar).not.toHaveBeenCalled();
  });

  it("las APIs de consulta informan una capacidad opcional, sin 5xx ni bloque rojo", async () => {
    const [respuestaPrensa, respuestaSatelite] = await Promise.all([
      saludPrensa(new Request("http://atalaya.test/api/fuentes/prensa")),
      saludSatelite(new Request("http://atalaya.test/api/fuentes/satelite")),
    ]);

    expect(respuestaPrensa.status).toBe(200);
    await expect(respuestaPrensa.json()).resolves.toMatchObject({ exa: { ok: true, disponible: false, opcional: true } });
    expect(respuestaSatelite.status).toBe(200);
    await expect(respuestaSatelite.json()).resolves.toMatchObject({ disponible: false, opcional: true, total: 0 });
  });
});
