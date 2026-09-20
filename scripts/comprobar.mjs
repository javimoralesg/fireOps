#!/usr/bin/env node
// =====================================================================
// ATALAYA INCENDIOS · Comprobación rápida del servidor
// ---------------------------------------------------------------------
// Llama a /api/salud y /api/estado y resume qué hay vivo y qué está roto.
// Uso: node scripts/comprobar.mjs [http://localhost:3000]
// DUEÑO: constructor A.
// =====================================================================

const base = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

async function pedir(ruta) {
  const t0 = Date.now();
  const r = await fetch(`${base}${ruta}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const ms = Date.now() - t0;
  if (!r.ok) throw new Error(`${ruta} → HTTP ${r.status} (${ms} ms)`);
  return { datos: await r.json(), ms };
}

const marca = (ok) => (ok ? "✓" : "✗");

try {
  const { datos: salud, ms: msSalud } = await pedir("/api/salud");
  const { datos: estado, ms: msEstado } = await pedir("/api/estado");

  console.log(`\nAtalaya en ${base}\n${"─".repeat(60)}`);
  console.log(`Salud            ${marca(salud.ok)}  (${msSalud} ms)`);
  console.log(`Ejecución        ${salud.ejecucion.nombre} · ${salud.ejecucion.estado}`);
  console.log(`Reloj de mundo   ${salud.reloj.ahoraMundo}  ×${salud.reloj.factor}${salud.reloj.pausado ? "  [EN PAUSA]" : ""}  tick ${salud.reloj.tick}`);
  console.log(`Orquestador      ${marca(salud.nucleo.arrancado)}  tick ${salud.nucleo.tickMs} ms · ${salud.nucleo.agentes} agentes` + (salud.nucleo.ocupados.length ? ` · ocupados: ${salud.nucleo.ocupados.join(", ")}` : ""));
  console.log(`Agentes          ${salud.agentes.total} registrados, ${salud.agentes.pausados} en pausa` + (salud.agentes.enError.length ? `, en error: ${salud.agentes.enError.join(", ")}` : ""));
  console.log(`Memoria          ${salud.proceso.memoriaMB.rss} MB RSS · heap ${salud.proceso.memoriaMB.heapUsado}/${salud.proceso.memoriaMB.heapTotal} MB · ${salud.proceso.tiempoEnPieS} s en pie`);
  console.log(`URL pública      ${salud.urlPublica.valor ?? "(sin configurar)"} [${salud.urlPublica.origen}]`);

  console.log(`\nEstado (versión ${estado.version}, ${msEstado} ms)`);
  console.log(`  incendios ${estado.incendios.length} (${salud.incendiosActivos} activos) · unidades ${estado.unidades.length} · poblaciones ${estado.poblaciones.length}`);
  console.log(`  cámaras ${estado.camaras.length} (${estado.camaras.filter((c) => c.vigilada).length} vigiladas) · observaciones ${estado.observaciones.length}`);
  console.log(`  decisiones ${estado.decisiones.length} (${salud.decisionesPendientes} esperando a un humano) · informes ${(estado.informes ?? []).length} · eventos ${estado.eventos.length}`);

  const servicios = Object.entries(salud.servicios);
  console.log(`\nServicios externos (${servicios.length})`);
  if (!servicios.length) console.log("  (ninguno ha hablado todavía)");
  for (const [nombre, v] of servicios.sort((a, b) => Number(a[1].ok) - Number(b[1].ok))) {
    console.log(`  ${marca(v.ok)} ${nombre.padEnd(24)} ${v.detalle ?? ""}`);
  }

  const ultimos = estado.eventos.slice(-5);
  if (ultimos.length) {
    console.log(`\nÚltimos eventos`);
    for (const e of ultimos) console.log(`  [${e.nivel}] ${e.tipo}: ${e.mensaje}`);
  }
  console.log();
  process.exit(salud.serviciosCaidos.length ? 0 : 0);
} catch (e) {
  console.error(`\n✗ No se pudo comprobar ${base}: ${e.message}\n   ¿Está el servidor levantado? (npm run dev / npm run start)\n`);
  process.exit(1);
}
