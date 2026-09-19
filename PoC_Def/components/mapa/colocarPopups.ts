// Coloca cada popup del mapa donde quepa ENTERO. Leaflet solo sabe abrirlo
// encima del marcador y, si no cabe, mover el mapa (autoPan); aquí el mapa se
// queda quieto y es el popup el que busca sitio: encima y, si no entra, debajo,
// a la derecha o a la izquierda del marcador. Se corre a lo largo del borde
// cuando hace falta (la punta sigue señalando al marcador) y esquiva lo que
// flota sobre el mapa: panel de capas, leyenda, zoom, avisos. Si no cabe entero
// en ningún lado, se recorta en alto (scroll dentro) en el lado que más sitio
// deja. Ninguna parte del popup queda nunca oculta.
//
// Uso: `instalarColocadorPopups(mapa)` una vez por mapa (devuelve el desmontaje)
// y `autoPan: false` en cada popup; si no, Leaflet mueve el mapa antes de que
// este módulo lo recoloque. Sirve para react-leaflet y para Leaflet a pelo.
//
// Cómo: se mide el popup en su sitio natural y se desplaza con la propiedad CSS
// `translate`, que se suma al `transform` con el que Leaflet lo mueve por el
// mapa sin pisarlo. El lado va en `data-lado`, la posición de la punta en
// `--punta-x` / `--punta-y` y el tope de alto del contenido en `--popup-alto-max`
// (estilos en app/globals.css, junto a `.leaflet-popup-content`).
// DUEÑO: constructor E (mapa), 2026-09-19.

import type * as L from "leaflet";

type Lado = "arriba" | "abajo" | "derecha" | "izquierda";
/** Rectángulo en píxeles del contenedor del mapa (origen: su esquina superior izquierda). */
type Caja = { x0: number; y0: number; x1: number; y1: number };
type Colocacion = {
  lado: Lado;
  /** Esquina superior izquierda del popup. */
  x: number;
  y: number;
  alto: number;
  /** Dónde va la punta: distancia al borde izquierdo (arriba/abajo) o al superior (derecha/izquierda). */
  punta: number;
  /** Alto máximo del contenido en este sitio, por si crece después. */
  tope: number;
  /** Sin punta: el popup no toca al marcador, está en el hueco libre más cercano. */
  suelto: boolean;
};

/** Orden de preferencia: como siempre (encima) y, si no, lo más parecido. */
const ORDEN: Lado[] = ["arriba", "abajo", "derecha", "izquierda"];
/** Aire mínimo entre el popup y el borde del mapa o lo que flota sobre él. */
const MARGEN = 8;
/** Del borde del popup al marcador: la punta mide 12 px, más un respiro. */
const SEPARACION = 14;
/** La punta no se acerca más que esto a las esquinas del popup (radio 12 px, botón de cerrar). */
const PUNTA_MINIMA = 26;
/** Por debajo de este alto de contenido no merece la pena recortar: se prefiere otro lado. */
const ALTO_MINIMO = 96;
const SIN_TOPE = "9999px";

/**
 * Engancha el colocador a un mapa. Cada popup se coloca al abrirse, cada vez
 * que cambia de tamaño (el contenido de React se monta después de abrirse, y
 * crece con desplegables e imágenes) y cada vez que el mapa se mueve o cambia
 * de tamaño, porque entonces el marcador cambia de sitio respecto a los bordes.
 */
export function instalarColocadorPopups(mapa: L.Map): () => void {
  const abiertos = new Map<L.Popup, { recolocar: () => void; desmontar: () => void }>();

  const alAbrir = (e: L.PopupEvent) => {
    const popup = e.popup;
    const el = popup.getElement();
    if (!el || abiertos.has(popup)) return;
    // Por si el mismo popup se vuelve a abrir: el mapa no se mueve, se mueve el popup.
    popup.options.autoPan = false;
    let medida = { ancho: 0, alto: 0 };
    const recolocar = () => {
      medida = colocarPopup(mapa, popup, el);
    };
    recolocar();
    // El observador avisa después del layout y antes de pintar: el popup nunca
    // llega a verse en un sitio donde no cabe. La comparación evita el bucle
    // con los propios cambios de tamaño que hace este módulo.
    const obs = new ResizeObserver(() => {
      if (el.offsetWidth === medida.ancho && el.offsetHeight === medida.alto) return;
      recolocar();
    });
    obs.observe(el);
    abiertos.set(popup, { recolocar, desmontar: () => obs.disconnect() });
  };
  const alCerrar = (e: L.PopupEvent) => {
    abiertos.get(e.popup)?.desmontar();
    abiertos.delete(e.popup);
  };
  const recolocarTodos = () => {
    for (const a of abiertos.values()) a.recolocar();
  };

  mapa.on("popupopen", alAbrir);
  mapa.on("popupclose", alCerrar);
  mapa.on("moveend resize", recolocarTodos);
  return () => {
    mapa.off("popupopen", alAbrir);
    mapa.off("popupclose", alCerrar);
    mapa.off("moveend resize", recolocarTodos);
    for (const a of abiertos.values()) a.desmontar();
    abiertos.clear();
  };
}

/** Coloca un popup abierto y devuelve su tamaño final (para que el observador distinga los cambios ajenos). */
function colocarPopup(mapa: L.Map, popup: L.Popup, el: HTMLElement): { ancho: number; alto: number } {
  const contenedor = mapa.getContainer();
  const C = contenedor.getBoundingClientRect();
  const W = contenedor.clientWidth;
  const H = contenedor.clientHeight;
  const contenido = el.querySelector<HTMLElement>(".leaflet-popup-content");

  // 1. Medida natural: sin desplazar y sin tope de alto. Soltar el tope
  //    devuelve a cero el scroll de dentro, así que se guarda y se restaura.
  const scrolls = guardarScroll(el);
  el.style.removeProperty("translate");
  el.style.setProperty("--popup-alto-max", SIN_TOPE);
  const r0 = el.getBoundingClientRect();
  const ancho = r0.width;
  const altoNatural = r0.height;
  // Lo que el popup añade alrededor del contenido (márgenes, borde): no cambia al recortarlo.
  const cromo = contenido ? altoNatural - contenido.getBoundingClientRect().height : 0;
  const baseX = r0.left - C.left;
  // Leaflet ancla el popup por abajo: si se recorta, el borde inferior no se mueve.
  const baseFondo = r0.bottom - C.top;

  const origen = cajaOrigen(mapa, popup, C);
  // Marcador fuera del mapa (el usuario lo ha arrastrado): el popup se va con
  // él, como en Leaflet, en vez de quedarse pegado a un borde señalando a la nada.
  if (origen.x1 < 0 || origen.x0 > W || origen.y1 < 0 || origen.y0 > H) {
    el.dataset.lado = "arriba";
    delete el.dataset.suelto;
    el.style.removeProperty("--punta-x");
    el.style.removeProperty("--punta-y");
    restaurarScroll(scrolls);
    return { ancho: el.offsetWidth, alto: el.offsetHeight };
  }
  const estorbos = cajasEstorbo(contenedor, C, W, H);
  const cx = (origen.x0 + origen.x1) / 2;
  const cy = (origen.y0 + origen.y1) / 2;

  /** Alto de contenido que cabe en cada lado (negativo: ni siquiera entra a lo ancho). */
  const capacidad = (lado: Lado): number => {
    switch (lado) {
      case "arriba":
        return origen.y0 - SEPARACION - MARGEN - cromo;
      case "abajo":
        return H - MARGEN - (origen.y1 + SEPARACION) - cromo;
      case "derecha":
        return origen.x1 + SEPARACION + ancho <= W - MARGEN ? H - 2 * MARGEN - cromo : -1;
      case "izquierda":
        return origen.x0 - SEPARACION - ancho >= MARGEN ? H - 2 * MARGEN - cromo : -1;
    }
  };

  /**
   * Sitio en un lado para un popup de `alto` píxeles, o null si no cabe entero.
   * Con la punta en el marcador, o `suelto`: sin punta, en cualquier hueco del
   * eje transversal (para marcadores arrinconados junto a un panel).
   */
  const intentar = (lado: Lado, alto: number, suelto = false): Colocacion | null => {
    if (alto - cromo > capacidad(lado) + 0.5) return null;
    if (lado === "arriba" || lado === "abajo") {
      const y = lado === "arriba" ? origen.y0 - SEPARACION - alto : origen.y1 + SEPARACION;
      const holgura = Math.min(PUNTA_MINIMA, ancho / 2);
      const x = sitioLibre({
        deseado: cx - ancho / 2,
        minimo: suelto ? MARGEN : Math.max(MARGEN, cx - ancho + holgura),
        maximo: suelto ? W - MARGEN - ancho : Math.min(W - MARGEN - ancho, cx - holgura),
        prohibidos: estorbos
          .filter((e) => e.y0 < y + alto + MARGEN && e.y1 > y - MARGEN)
          .map((e) => [e.x0 - ancho - MARGEN, e.x1 + MARGEN]),
      });
      return x === null ? null : { lado, x, y, alto, punta: cx - x, tope: capacidad(lado), suelto };
    }
    const x = lado === "derecha" ? origen.x1 + SEPARACION : origen.x0 - SEPARACION - ancho;
    const holgura = Math.min(PUNTA_MINIMA, alto / 2);
    const y = sitioLibre({
      deseado: cy - alto / 2,
      minimo: suelto ? MARGEN : Math.max(MARGEN, cy - alto + holgura),
      maximo: suelto ? H - MARGEN - alto : Math.min(H - MARGEN - alto, cy - holgura),
      prohibidos: estorbos
        .filter((e) => e.x0 < x + ancho + MARGEN && e.x1 > x - MARGEN)
        .map((e) => [e.y0 - alto - MARGEN, e.y1 + MARGEN]),
    });
    return y === null ? null : { lado, x, y, alto, punta: cy - y, tope: capacidad(lado), suelto };
  };

  // 2. Dónde ponerlo, de más a menos deseable: (a) entero y pegado al
  //    marcador, con la punta; (b) recortado (scroll dentro) a lo que cabe
  //    hasta el borde del mapa o hasta el estorbo más cercano; (c) lo mismo
  //    pero suelto, sin punta, corrido por el eje transversal a cualquier
  //    hueco (marcador arrinconado junto a un panel); (d) en el hueco libre
  //    del mapa donde más contenido se vea, aunque no toque al marcador;
  //    (e) último recurso: encima o debajo, pegado dentro del mapa, sin
  //    esquivar nada. Verlo entero manda sobre verlo pegado al marcador.

  /** Altos de popup que caben en un lado: hasta el borde del mapa y hasta cada estorbo que se cruce. */
  const alturas = (lado: Lado): number[] => {
    const tope = capacidad(lado) + cromo;
    if (tope - cromo < ALTO_MINIMO) return [];
    const lista = [tope];
    if (lado === "arriba") {
      const fondo = origen.y0 - SEPARACION;
      for (const e of estorbos) lista.push(fondo - (e.y1 + MARGEN));
    } else if (lado === "abajo") {
      const cima = origen.y1 + SEPARACION;
      for (const e of estorbos) lista.push(e.y0 - MARGEN - cima);
    } else {
      const x = lado === "derecha" ? origen.x1 + SEPARACION : origen.x0 - SEPARACION - ancho;
      const ocupados = estorbos.filter((e) => e.x0 < x + ancho + MARGEN && e.x1 > x - MARGEN).map((e): [number, number] => [e.y0 - MARGEN, e.y1 + MARGEN]);
      for (const [a, b] of huecos(ocupados, MARGEN, H - MARGEN)) lista.push(b - a);
    }
    return lista.filter((h) => h > 0 && h <= tope);
  };

  const buscar = (suelto: boolean): Colocacion | null => {
    for (const lado of ORDEN) {
      const c = intentar(lado, altoNatural, suelto);
      if (c) return c;
    }
    const candidatos: { lado: Lado; alto: number }[] = [];
    for (const lado of ORDEN) {
      for (const alto of alturas(lado)) if (alto < altoNatural && alto - cromo >= ALTO_MINIMO) candidatos.push({ lado, alto });
    }
    candidatos.sort((a, b) => b.alto - a.alto);
    for (const { lado, alto } of candidatos) {
      const c = intentar(lado, alto, suelto);
      if (c) return c;
    }
    return null;
  };

  /** El hueco libre del mapa (entre bordes y estorbos) donde más contenido se ve; a igual alto, el más cercano al marcador. */
  const enHuecoLibre = (): Colocacion | null => {
    const cortes = new Set<number>([MARGEN, W - MARGEN]);
    for (const e of estorbos) {
      cortes.add(acotar(e.x0 - MARGEN, MARGEN, W - MARGEN));
      cortes.add(acotar(e.x1 + MARGEN, MARGEN, W - MARGEN));
    }
    const xs = [...cortes].sort((a, b) => a - b);
    let mejor: Colocacion | null = null;
    let distancia = Infinity;
    for (let i = 0; i < xs.length; i += 1) {
      for (let j = i + 1; j < xs.length; j += 1) {
        const xa = xs[i];
        const xb = xs[j];
        if (xb - xa < ancho) continue;
        const ocupados = estorbos.filter((e) => e.x0 - MARGEN < xb && e.x1 + MARGEN > xa).map((e): [number, number] => [e.y0 - MARGEN, e.y1 + MARGEN]);
        for (const [ya, yb] of huecos(ocupados, MARGEN, H - MARGEN)) {
          const alto = Math.min(altoNatural, yb - ya);
          if (alto - cromo < ALTO_MINIMO) continue;
          const x = acotar(cx - ancho / 2, xa, xb - ancho);
          const y = acotar(cy - alto / 2, ya, yb - alto);
          const d = Math.hypot(x + ancho / 2 - cx, y + alto / 2 - cy);
          if (!mejor || alto > mejor.alto + 0.5 || (Math.abs(alto - mejor.alto) <= 0.5 && d < distancia)) {
            mejor = { lado: "arriba", x, y, alto, punta: 0, tope: yb - ya - cromo, suelto: true };
            distancia = d;
          }
        }
      }
    }
    return mejor;
  };

  let eleccion: Colocacion | null = buscar(false) ?? buscar(true) ?? enHuecoLibre();
  if (!eleccion) {
    // Último recurso (mapa minúsculo): encima o debajo, recortado a lo que
    // cabe en el mapa y pegado dentro de sus bordes, sin esquivar nada más.
    const tope = Math.max(ALTO_MINIMO, H - 2 * MARGEN - cromo);
    const alto = Math.min(altoNatural, tope + cromo);
    const lado: Lado = origen.y0 - SEPARACION - alto >= MARGEN ? "arriba" : "abajo";
    const y = acotar(lado === "arriba" ? origen.y0 - SEPARACION - alto : origen.y1 + SEPARACION, MARGEN, Math.max(MARGEN, H - MARGEN - alto));
    const x = acotar(cx - ancho / 2, MARGEN, Math.max(MARGEN, W - MARGEN - ancho));
    const holgura = Math.min(PUNTA_MINIMA, ancho / 2);
    eleccion = { lado, x, y, alto, punta: acotar(cx - x, holgura, ancho - holgura), tope, suelto: false };
  }

  // 3. Aplicar: lado y punta para el CSS, tope de alto y desplazamiento.
  el.dataset.lado = eleccion.lado;
  if (eleccion.suelto) el.dataset.suelto = "";
  else delete el.dataset.suelto;
  el.style.setProperty("--popup-alto-max", `${Math.max(ALTO_MINIMO, Math.round(eleccion.tope))}px`);
  if (eleccion.lado === "arriba" || eleccion.lado === "abajo") {
    el.style.setProperty("--punta-x", `${Math.round(eleccion.punta)}px`);
    el.style.removeProperty("--punta-y");
  } else {
    el.style.setProperty("--punta-y", `${Math.round(eleccion.punta)}px`);
    el.style.removeProperty("--punta-x");
  }
  const altoReal = el.offsetHeight;
  const dx = eleccion.x - baseX;
  const dy = eleccion.y + altoReal - baseFondo;
  el.style.setProperty("translate", `${Math.round(dx)}px ${Math.round(dy)}px`);
  restaurarScroll(scrolls);
  return { ancho: el.offsetWidth, alto: altoReal };
}

/**
 * Posición a lo largo de un eje lo más cerca posible de la deseada, dentro de
 * [minimo, maximo] y fuera de los tramos prohibidos (abiertos). Los candidatos
 * son la deseada acotada y los extremos de cada tramo: el óptimo está siempre
 * en uno de ellos.
 */
function sitioLibre({
  deseado,
  minimo,
  maximo,
  prohibidos,
}: {
  deseado: number;
  minimo: number;
  maximo: number;
  prohibidos: [number, number][];
}): number | null {
  if (minimo > maximo + 0.5) return null;
  const candidatos = [acotar(deseado, minimo, maximo)];
  for (const [a, b] of prohibidos) candidatos.push(a, b);
  let mejor: number | null = null;
  for (const c of candidatos) {
    if (c < minimo - 0.5 || c > maximo + 0.5) continue;
    if (prohibidos.some(([a, b]) => c > a && c < b)) continue;
    if (mejor === null || Math.abs(c - deseado) < Math.abs(mejor - deseado)) mejor = c;
  }
  return mejor;
}

/** Tramos libres de [minimo, maximo] una vez quitados los ocupados. */
function huecos(ocupados: [number, number][], minimo: number, maximo: number): [number, number][] {
  const orden = ocupados.filter(([a, b]) => b > minimo && a < maximo).sort((p, q) => p[0] - q[0]);
  const lista: [number, number][] = [];
  let desde = minimo;
  for (const [a, b] of orden) {
    if (a > desde) lista.push([desde, a]);
    desde = Math.max(desde, b);
  }
  if (maximo > desde) lista.push([desde, maximo]);
  return lista;
}

function acotar(v: number, minimo: number, maximo: number): number {
  return Math.min(Math.max(v, minimo), maximo);
}

/**
 * Lo que señala el popup: el icono del marcador, un círculo, o el punto. Del
 * icono cuenta su caja a lo ancho (la punta apunta al icono, no a la etiqueta
 * con el nombre, mucho más ancha) y, a lo alto, también lo que cuelga de él
 * (la etiqueta debajo, la flecha de rumbo encima): el popup no las tapa.
 */
function cajaOrigen(mapa: L.Map, popup: L.Popup, C: DOMRect): Caja {
  // `_source` es privado de Leaflet pero estable en toda la 1.x: la capa a la que va atado el popup.
  const origen = (popup as unknown as { _source?: L.Layer })._source;
  const latlng = popup.getLatLng();
  const p = latlng ? mapa.latLngToContainerPoint(latlng) : { x: 0, y: 0 };
  if (origen && "getIcon" in origen && typeof (origen as L.Marker).getElement === "function") {
    const icono = (origen as L.Marker).getElement();
    const r = icono?.getBoundingClientRect();
    if (icono && r && r.width > 0 && r.height > 0) {
      const caja = { x0: r.left - C.left, y0: r.top - C.top, x1: r.right - C.left, y1: r.bottom - C.top };
      for (const n of icono.querySelectorAll("*")) {
        const h = n.getBoundingClientRect();
        if (h.width === 0 || h.height === 0) continue;
        caja.y0 = Math.min(caja.y0, h.top - C.top);
        caja.y1 = Math.max(caja.y1, h.bottom - C.top);
      }
      return caja;
    }
  }
  if (origen && typeof (origen as L.CircleMarker).getRadius === "function") {
    if (typeof (origen as L.Circle).getBounds === "function") {
      // Círculo geográfico (radio en metros): su caja en píxeles sale de los límites.
      const b = (origen as L.Circle).getBounds();
      const a = mapa.latLngToContainerPoint(b.getNorthWest());
      const z = mapa.latLngToContainerPoint(b.getSouthEast());
      return { x0: a.x, y0: a.y, x1: z.x, y1: z.y };
    }
    const r = (origen as L.CircleMarker).getRadius();
    return { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r };
  }
  return { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
}

/** Lo que flota sobre el mapa y taparía el popup: controles de Leaflet y las cajas pintadas de los hermanos del contenedor. */
function cajasEstorbo(contenedor: HTMLElement, C: DOMRect, W: number, H: number): Caja[] {
  const rects: DOMRect[] = [];
  for (const control of contenedor.querySelectorAll<HTMLElement>(".leaflet-control")) {
    const r = control.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push(r);
  }
  const padre = contenedor.parentElement;
  if (padre) {
    for (const hijo of padre.children) if (hijo !== contenedor) recogerPintados(hijo, rects);
  }
  const cajas: Caja[] = [];
  for (const r of rects) {
    const c = { x0: r.left - C.left, y0: r.top - C.top, x1: r.right - C.left, y1: r.bottom - C.top };
    if (c.x1 <= 0 || c.y1 <= 0 || c.x0 >= W || c.y0 >= H) continue;
    cajas.push(c);
  }
  return cajas;
}

/**
 * Baja por el árbol hasta el primer elemento que pinta algo (fondo, borde,
 * sombra): esa es la caja visible. Los envoltorios transparentes que ocupan
 * todo el ancho (`absolute inset-x-0`) no cuentan, solo lo que hay dentro.
 */
function recogerPintados(el: Element, salida: DOMRect[]) {
  if (!(el instanceof HTMLElement)) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return;
  if (pinta(s)) {
    salida.push(r);
    return;
  }
  for (const h of el.children) recogerPintados(h, salida);
}

function pinta(s: CSSStyleDeclaration): boolean {
  const fondo = s.backgroundColor;
  const conFondo = fondo !== "transparent" && !/^rgba\(\d+, \d+, \d+, 0\)$/.test(fondo);
  return conFondo || s.backgroundImage !== "none" || s.boxShadow !== "none" || (s.borderTopStyle !== "none" && parseFloat(s.borderTopWidth) > 0);
}

function guardarScroll(el: HTMLElement): [HTMLElement, number][] {
  const lista: [HTMLElement, number][] = [];
  for (const n of el.querySelectorAll<HTMLElement>("*")) if (n.scrollTop > 0) lista.push([n, n.scrollTop]);
  return lista;
}

function restaurarScroll(lista: [HTMLElement, number][]) {
  for (const [n, top] of lista) if (n.scrollTop !== top) n.scrollTop = top;
}
