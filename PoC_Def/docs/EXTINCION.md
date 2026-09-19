# Extinción realista: contención, hitos y fusión de focos

> Constructor K · 2026-09-19. Código: `lib/simulacion/contencion.ts`,
> `lib/simulacion/fusion.ts`, `lib/simulacion/geometria.ts`,
> `lib/agentes/analisis/propagacion.ts`, `lib/motor/orquestador.ts#cerrarIncendio`.
> Verificación: `npx tsx scripts/verificar-extincion.ts`.

## 1. Por qué

Hasta esta entrega el fuego de Atalaya **solo crecía**. Los medios llegaban, se
quedaban en `en_intervencion` y no cambiaban nada; el incendio únicamente se
paraba si un humano lo marcaba a mano. Petición de Javi: *"tampoco el que se
extinga el fuego de forma realista está pensado"*.

Un incendio real se apaga porque alguien **construye línea de control** alrededor
del perímetro. La terminología operativa española (y la que usa la sala):

| Estado | Qué significa |
|---|---|
| `activo` | Hay medios trabajando y el perímetro sigue creciendo |
| `estabilizado` | La línea cierra el 100 % del perímetro: ya no gana terreno |
| `controlado` | La línea aguanta sin riesgo de reproducción; se entra en **liquidación** (los medios SIGUEN en el terreno) |
| `extinguido` | Liquidación y remate terminados; los medios regresan a sus bases |

## 2. El modelo de contención

### 2.1 Ritmo de línea por unidad

```
ritmo_u = R0(tipo) · Dotación_u · Fcombustible · Fviento · Fataque
```

`R0` — metros de línea por **minuto de mundo**, en matorral, con la dotación de
referencia de ese tipo de medio:

| Tipo de unidad | R0 (m/min) | Dotación de referencia | Nota |
|---|---:|---|---|
| `bomberos` (autobomba) | 5 | 5 personas | Tendido de manguera + herramienta manual (4-6 en la literatura) |
| `brif` | 9 | 12 personas | Brigada helitransportada, línea manual rápida (8-10) |
| `agentes_forestales` | 3 | 2 personas | Quema de ensanche, contrafuego y remate |
| `maquinaria` | 20 | 1 vehículo | Buldócer / tractor de cadenas (15-25) |
| `medios_aereos` | 0 | — | No construyen línea: su efecto va en `factorExtincion` |
| `guardia_civil`, `policia`, `ambulancia`, `proteccion_civil` | 0 | — | Aseguran accesos, cortes y sanitario; **no extinguen** |

`Dotación_u = recorte(personas / referencia, 0,4 , 1,8)` (para maquinaria y
medios aéreos se escala por vehículos).

**Fuentes** de los órdenes de magnitud (valores calibrados para la demo, no una
tabla oficial):

- NWCG, *Fireline Handbook* (PMS 410-1) — tablas de *fireline production rates*
  en cadenas/hora (1 cadena = 20,12 m).
- Broyles, G. (2011) *Fireline Production Rates*, USDA Forest Service NTDP
  1151-1805 — producción por persona y por tipo de recurso.
- Hirsch, K.G. & Martell, D.L. (1996) *A review of initial attack fire crew
  productivity and effectiveness*, Int. J. Wildland Fire 6(4):199-215.
- Plucinski, M.P. (2019) *Contain and Control: Wildfire Suppression Effectiveness
  at Incidents and Across Landscapes*, Current Forestry Reports.

**Fcombustible** — abrir línea no cuesta lo mismo en pasto que en pinar:

| pasto | agrícola | matorral | bosque | urbano |
|---:|---:|---:|---:|---:|
| 1,6 | 1,8 | 1,0 | 0,6 | 0,8 |

**Fviento** — con viento fuerte la línea no aguanta y el trabajo directo es
imposible. `U = max(viento, 0,85 · rachas)` (el mismo viento efectivo que usa el
modelo de propagación):

| U (km/h) | Fviento |
|---|---|
| ≤ 30 | 1,00 |
| 30 → 50 | 1,00 → 0,55 (lineal) |
| > 50 | 0,55 → 0,20 (lineal hasta 70) |

**Fataque** — *ataque directo* frente a *línea indirecta*. En un foco pequeño y
poco intenso la dotación ataca el borde con agua y herramienta y avanza casi a
paso de persona; en un gran incendio hay que retirarse a abrir línea en
combustible sin quemar, que es mucho más lento. Se aproxima por el tamaño del
perímetro (proxy del paso de ataque inicial a ataque ampliado):

| Perímetro | Fataque |
|---|---|
| ≤ 2.000 m | 2,5 (ataque inicial) |
| 2.000 → 6.000 m | 2,5 → 1,0 (lineal) |
| > 6.000 m | 1,0 (gran incendio: construcción de línea) |

`ritmo total = Σ ritmo_u` de las unidades **`en_intervencion` sobre ese foco**.

### 2.2 Perímetro controlado

```
perimetroTotalM       = longitud del polígono actual (geometria.perimetroM)
perimetroControladoM += ritmo · minutos de mundo         (acumula, tope = total)
fraccion              = controlado / total
estimadoControlMin    = (total − controlado) / (ritmo − crecimiento)
```

`crecimiento` es el ritmo observado de crecimiento del perímetro (m/min) entre
este ciclo y el anterior. **La línea nueva tiene que cubrir también lo que el
fuego gana**, así que la fracción puede bajar; si `ritmo ≤ crecimiento`,
`estimadoControlMin` es `undefined`: el incendio se les está yendo de las manos y
la sala lo dice con esas palabras.

### 2.3 Efecto sobre la propagación

```
velocidad efectiva de cabeza = velocidad del modelo elíptico
                             × (1 − fraccion)^1,5
                             × Faéreos
                             × Flluvia
```

- `(1 − fraccion)^1,5` — con medio perímetro cogido el fuego no avanza a la
  mitad, avanza a un 35 %; con el perímetro cerrado se para.
- `Faéreos` = **0,6 nominal** (0,50 con calma, 0,70 acercándose a 40 km/h): las
  descargas reducen la velocidad de la cabeza entre un **30 % y un 50 %**
  mientras el viento sea **< 40 km/h** y sea **de día** (ventana orto-ocaso;
  aquí hora de mundo **07-21** en `Europe/Madrid`). Fuera de eso, `Faéreos = 1`.
  Fuente: Plucinski, M.P. & Pastor, E. (2013) *Criteria and methodology for
  evaluating aerial wildfire suppression*, Int. J. Wildland Fire 22:1144-1154.
  Se consideran activos si hay una unidad `medios_aereos` sobre el foco **o** si
  una acción `solicitar_medios_aereos` de una decisión de ese foco está
  `ejecutada`.
- `Flluvia` = **0,2** si ha llovido **> 5 mm en 24 h** (`precipitacionAcumulada`
  de Open-Meteo, la misma serie horaria real que usa el meteorólogo), 1 si no.

Sin medios trabajando el fuego **sigue creciendo exactamente como antes**
(`fraccion = 0` ⇒ factor 1).

`propagar`, `predecir` y `evaluarPoblaciones` aceptan ese factor como tercer
parámetro opcional (por defecto 1). `lib/simulacion/propagacion.ts` **no** importa
`contencion.ts`: la dependencia va en un solo sentido.

### 2.4 Hitos y rebrote

| Condición | Efecto |
|---|---|
| `fraccion ≥ 1` | `estabilizado` + `contencion.estabilizadoEn`; evento crítico *"Estabilizado: perímetro 100 % controlado por N unidades"* |
| ≥ **60 min de mundo** estabilizado sin rebrote | Se **propone** `declarar_controlado {estado: "controlado"}` |
| ≥ **120 min de mundo** controlado (liquidación) | Se **propone** `declarar_controlado {estado: "extinguido"}` |
| Viento efectivo **+20 km/h** sobre el de estabilizar, **o** peligro `extremo` | **REBROTE**: `fraccion` baja un 20 %, se borran los hitos, vuelve a `activo`, evento crítico |

Las dos decisiones las propone el agente `propagacion` y por política
(`declarar_controlado` → `humano`, riesgo mínimo 50) **siempre las firma una
persona**: quedan en `pendiente_humano` en la bandeja de la sala.

Un foco `confirmado` pasa a `activo` en cuanto la **primera unidad llega** al
terreno (el agente se despierta con `unidad_llega`).

### 2.5 Qué ve la sala

Todo vive en `incendio.contencion`:

```ts
{
  perimetroTotalM, perimetroControladoM, fraccion, ritmoMmin,
  unidadesTrabajando, mediosAereos, estimadoControlMin,
  estabilizadoEn, controladoEn, extinguidoEn, calculadoEn,
  vientoEstabilizadoKmh, rebrotes, lluvia24Mm, explicacion
}
```

`explicacion` es una frase lista para pintar, p. ej.:
*"2 unidad(es) construyen línea a 22,2 m/min: 62 % de 2,75 km de perímetro
controlado; control total estimado en ~35 min."*

### 2.6 Cierre y regreso a base

`cerrarIncendio` (orquestador) cambia de comportamiento:

- **`controlado` NO cierra nada**: es el paso a liquidación. Los medios se quedan
  rematando y las cámaras siguen vigilando; solo se sella `contencion.controladoEn`.
- **`extinguido` / `descartado`**: los medios **regresan a su base por carretera**
  con ruta real de OSRM (`despachador.retirar` → estado `regreso`; el despachador
  los pone `disponible` al llegar). Antes se teletransportaban a base de golpe.
  Si OSRM falla para una unidad concreta, se libera a mano y queda anotado.

## 3. Fusión de focos

Dos columnas que se juntan son **un solo incendio**. `lib/simulacion/fusion.ts`,
ejecutado por el agente `propagacion` al principio de cada ciclo:

- **Criterio**: perímetros solapados o a **< 300 m borde a borde**
  (`distanciaEntrePerimetrosM`). Es el orden de magnitud a partir del cual el
  sector intermedio deja de ser defendible y la dirección de extinción unifica el
  dispositivo.
- **Superviviente**: el foco más consolidado (un `confirmado` absorbe a un
  `detectado`) y, a igualdad, el más antiguo por `detectadoEn`.
- **Perímetro**: envolvente convexa de los vértices de los dos perímetros,
  remuestreada a 36 radios desde el nuevo centro **por intersección de rayo**
  (`radiosPorRayo`), que es fiel a la geometría — `radiosPorRumbo` interpola los
  sectores vacíos con la media de los vecinos e inflaría el área varias veces con
  dos lenguas alargadas. La envolvente incluye el hueco entre los dos focos: es
  una unión por exceso, pero ese hueco se consume en minutos.
- `areaHa` recalculada · `nivelGravedad` y `confianza` = máximo de los dos ·
  `observaciones` concatenadas · nombre `"Incendio de A – B"` (si comparten
  municipio se conserva el del superviviente).
- **El absorbido no se borra**: pasa a estado `fusionado` con `fusionadoEn`, así
  su hilo, sus decisiones y sus actas siguen íntegros para la auditoría.
  `incendiosActivos()` excluye `fusionado`.
- **Unidades** del absorbido → `incendioId` del superviviente (sin sector: lo
  recalcula el coordinador). **Poblaciones** de los dos → superviviente, con
  distancia y rumbo recalculados desde el nuevo centro (no puede haber duplicados:
  la `Poblacion` se indexa por su id de OSM).
- **Decisiones pendientes** de los dos focos → `caducada` con motivo
  *"focos fusionados"* en el historial.
- El **`Cluster`** de `patrones` que contenía a los dos pasa a tipo
  `mismo_incendio`.
- **Contención**: la línea construida en los dos focos se suma, pero se borran
  `estabilizadoEn` y `controladoEn`: la fusión reabre el perímetro.
- Evento `incendio_actualizado` **crítico** y se despierta a `coordinador`,
  `proteccion_poblacion`, `patrones` y `portavoz`.

Las cadenas A-B-C se resuelven en ciclos sucesivos (hasta 5 fusiones por ciclo).

## 4. Limitaciones asumidas

- No hay intensidad de llama por tramo: la decisión ataque directo/indirecto se
  aproxima por el tamaño del perímetro.
- La línea no tiene calidad ni anchura, y no se modelan relevos ni fatiga.
- El rebrote solo mira viento e índice de peligro, no puntos calientes concretos.
- La unión de perímetros es convexa: no representa uniones en forma de herradura.

Es un modelo **operativo**, para que la sala vea la carrera entre el fuego y los
medios y para poder decidir; no un simulador de extinción.

## 5. Verificación

```
npx tsx scripts/verificar-extincion.ts
```

14 comprobaciones, todas en verde:

| Escenario | Resultado |
|---|---|
| 2 ha de matorral, 2 autobombas a los 30 min, viento 15 km/h | **estabilizado a los 147 min de mundo, 32 ha** |
| Lo mismo con viento de 50 km/h | **no se estabiliza**: 4 % de perímetro, 921 ha en 3 h |
| Sin medios | 172 ha frente a 32 ha con 2 autobombas |
| Lluvia de 12 mm en 24 h | 12 ha frente a 172 ha |
| Con medios aéreos | estabiliza a los 79 min en vez de 147 |
| Dos focos a 1 km en pasto con viento 40 km/h | se fusionan a los 8 min: 6,1 + 6,1 ha → 21 ha |
| Ciclo real del agente `propagacion` | `confirmado → activo → estabilizado`, decisión *Declarar CONTROLADO* `[humano]`, liquidación, decisión *Declarar EXTINGUIDO*, y rebrote al doblarse el viento |

Probado además en vivo en el servidor compartido `:3100`: al declarar un foco
extinguido, las dos BRIF pasan a `regreso` con ruta real de OSRM (22,6 km / 33 min
y 11,7 km / 21 min) hasta su base, en vez de aparecer allí de golpe.
