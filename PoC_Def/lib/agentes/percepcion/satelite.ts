// =====================================================================
// Agente satélite. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Cada 10 min pide a NASA FIRMS los focos activos sobre España (VIIRS SNPP +
// NOAA-20, último día), los guarda en el estado, los agrupa a menos de 2 km y:
//   · grupo SIN incendio conocido a menos de 5 km → Observacion canal
//     "satelite" (es el verificador, de D, quien decide crear el foco);
//   · grupo junto a un incendio existente → sube su `confianza` y evento
//     "satelite" (dos fuentes independientes confirmando lo mismo).
// Sin FIRMS_MAP_KEY: estado "error" con el motivo y servicio en rojo. Nunca
// se inventa un foco.
// =====================================================================
import type { Agente, ContextoAgente } from "../../motor/contratos";
import type { Observacion } from "../../dominio/tipos";
import { agruparFocos, firmsDisponible, focosEspana } from "../../fuentes/firms";
import { haversine } from "../../fuentes/geo";
import { nuevoId } from "../../motor/ids";

const DISTANCIA_GRUPO_KM = 2;
const DISTANCIA_INCENDIO_KM = 5;

/** Ids de grupos ya observados, para no repetir la misma observación cada ciclo. */
const vistos = new Set<string>();

const claveGrupo = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

export const agenteSatelite: Agente = {
  id: "satelite",
  nombre: "Vigilancia satelital",
  categoria: "percepcion",
  descripcion:
    "Consulta los focos térmicos de NASA FIRMS (VIIRS) sobre España, los agrupa y avisa de los que no corresponden a ningún incendio conocido.",
  modelo: "determinista",
  cadenciaSeg: 600,

  async ciclo(ctx: ContextoAgente) {
    if (!firmsDisponible()) {
      const detalle =
        "FIRMS_MAP_KEY no configurada: sin ella no hay detección satelital real. Pídela en https://firms.modaps.eosdis.nasa.gov/api/map_key/ (llega por email en minutos).";
      ctx.estado.marcarServicio("NASA FIRMS", false, detalle);
      ctx.estado.actualizar(ctx.estado.agentes, "satelite", { estado: "error", ultimoError: detalle });
      ctx.informarTarea("Sin clave de NASA FIRMS: no puedo mirar los focos por satélite");
      return { resumen: detalle };
    }

    ctx.informarTarea("Consultando los focos térmicos de NASA FIRMS sobre España");
    let focos;
    try {
      focos = await focosEspana();
      ctx.estado.marcarServicio("NASA FIRMS", true, `${focos.length} focos en el último día`);
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      ctx.estado.marcarServicio("NASA FIRMS", false, detalle);
      ctx.estado.actualizar(ctx.estado.agentes, "satelite", { estado: "error", ultimoError: detalle });
      return { resumen: `NASA FIRMS no respondió: ${detalle}` };
    }

    for (const f of focos) if (!ctx.estado.focosSatelite.has(f.id)) ctx.estado.focosSatelite.set(f.id, f);
    ctx.estado.tocar();

    const grupos = agruparFocos(focos, DISTANCIA_GRUPO_KM);
    const incendios = ctx.estado.incendiosActivos();
    const observaciones: Observacion[] = [];
    let confirmados = 0;

    for (const grupo of grupos) {
      const cercano = incendios
        .map((i) => ({ i, d: haversine(i.centro, grupo.centro) }))
        .filter((x) => x.d <= DISTANCIA_INCENDIO_KM)
        .sort((a, b) => a.d - b.d)[0];

      if (cercano) {
        // El satélite confirma un incendio ya conocido: sube la confianza.
        const nueva = Math.min(1, +(cercano.i.confianza + 0.15).toFixed(2));
        if (nueva > cercano.i.confianza) {
          ctx.estado.actualizar(ctx.estado.incendios, cercano.i.id, { confianza: nueva, actualizadoEn: ctx.ahoraMundo });
          for (const f of grupo.focos) ctx.estado.actualizar(ctx.estado.focosSatelite, f.id, { incendioId: cercano.i.id });
          ctx.registrar(
            "satelite",
            `El satélite confirma ${cercano.i.nombre}: ${grupo.focos.length} foco(s) VIIRS a ${cercano.d.toFixed(1)} km, ${grupo.frpTotal.toFixed(0)} MW de potencia radiativa. Confianza ${Math.round(nueva * 100)} %`,
            { incendioId: cercano.i.id, nivel: "aviso", datos: { frpTotal: grupo.frpTotal, focos: grupo.focos.length } },
          );
          confirmados += 1;
        }
        continue;
      }

      const clave = claveGrupo(grupo.centro.lat, grupo.centro.lon);
      if (vistos.has(clave)) continue;
      vistos.add(clave);

      const principal = grupo.focos[0];
      const hora = new Date(principal.fechaHora).toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
      const observacion: Observacion = {
        id: nuevoId("obs"),
        canal: "satelite",
        recibidaEn: new Date().toISOString(),
        texto:
          `${grupo.focos.length} foco(s) térmico(s) detectados por ${principal.fuente.replace("_", " ")} en ${grupo.centro.lat.toFixed(4)}, ${grupo.centro.lon.toFixed(4)}: ` +
          `potencia radiativa ${grupo.frpTotal.toFixed(0)} MW, confianza ${principal.confianza}, pasada de las ${hora} (${principal.diaNoche === "N" ? "noche" : "día"}). ` +
          `No corresponde a ningún incendio conocido a menos de ${DISTANCIA_INCENDIO_KM} km.`,
        remitente: "NASA FIRMS",
        urlFuente: "https://firms.modaps.eosdis.nasa.gov/",
        punto: grupo.centro,
        referenciaExterna: principal.id,
      };
      ctx.estado.guardar(ctx.estado.observaciones, observacion);
      observaciones.push(observacion);
      ctx.registrar(
        "satelite",
        `Foco térmico nuevo por satélite en ${grupo.centro.lat.toFixed(3)}, ${grupo.centro.lon.toFixed(3)} (${grupo.frpTotal.toFixed(0)} MW, ${grupo.focos.length} píxel(es))`,
        { nivel: "critico", datos: { punto: grupo.centro, frpTotal: grupo.frpTotal, observacionId: observacion.id } },
      );
    }

    const resumen = `${focos.length} focos VIIRS en España, ${grupos.length} agrupaciones: ${observaciones.length} sin incendio conocido, ${confirmados} confirmando incendios activos`;
    ctx.informarTarea(resumen);
    return { resumen, observaciones: observaciones.length ? observaciones : undefined };
  },
};
