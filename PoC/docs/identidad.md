# Atalaya · Identidad visual v2

Guía para que todas las sesiones apliquen la misma identidad en sus archivos. Dueño: poc-25. Fuente de verdad de los valores: [`app/globals.css`](../app/globals.css).

## 1. Idea

**Sala de mando a plena luz.** Un centro de crisis no necesita gritar: necesita que el responsable lea rápido, entienda de dónde sale cada dato y actúe sin dudar. Por eso:

- **Tema claro por defecto**, con paneles blancos sobre un lienzo gris-azulado; **tema oscuro seleccionable** (`<html data-theme="dark">`, botón `SelectorTema`) para salas con poca luz.
- **Un solo color de marca** (petróleo) para acciones primarias y todo lo que hace la IA. El resto de colores son **estados** y solo aparecen cuando significan algo.
- **Tintes, no rellenos.** Un aviso es un fondo al 9 % con borde al 30 % y texto del color, no un bloque saturado.
- **Todo lo interactivo es informativo.** Cada cifra, etiqueta o icono explica qué es y de dónde sale (tooltip); cada fila clicable se ve clicable; cada acción dice qué va a pasar.

## 2. Tokens

Los **nombres** son un contrato entre sesiones; solo cambian los valores. Todos son hex opacos (funcionan `bg-danger/10`, `border-brand/40`…).

| Token Tailwind | Uso | Claro | Oscuro |
|---|---|---|---|
| `bg-background` | lienzo de la app | `#f2f5f7` | `#0e1319` |
| `bg-panel` | paneles principales, filas, botones secundarios | `#ffffff` | `#151b23` |
| `bg-panel-2` | tarjetas dentro de paneles, inputs, hover | `#f5f8fa` | `#1c242e` |
| `border-panel-border` | bordes y divisores | `#e3e9ee` | `#263039` |
| `border-panel-border-strong` | foco, selección, separadores fuertes | `#c9d3dc` | `#364250` |
| `text-foreground` | texto principal | `#16222e` | `#e7ecf1` |
| `text-muted` | secundario (≥ 6:1) | `#5a6b7c` | `#9aa8b6` |
| `text-subtle` | terciario: horas, ids, placeholders | `#7f8d9b` | `#6e7c8b` |
| `brand` / `accent` | marca, acciones primarias, IA | `#14707f` | `#5fc6d4` |
| `brand-2` | extremo claro del degradado, hover del primario | `#1e97a8` | `#2ea3b5` |
| `danger` | crítico, denegado, sospechoso | `#c4404a` | `#f28088` |
| `warning` | alta urgencia, plazo cerca, dato de guion | `#b3600e` | `#f2b45f` |
| `success` | ejecutado, verificado, dato real | `#1e7d4e` | `#62d093` |
| `info` | eventos, fase de detección | `#2a6db3` | `#78bbff` |

Sombras: `.superficie` (paneles) y `var(--sombra-flotante)` (menús, tooltips, diálogos). Radio: paneles 14 px (`rounded-2xl`), tarjetas 10 px (`rounded-[10px]` o `.fila-interactiva`), píldoras redondas, chips 8 px.

**Colores fijos (hex) en componentes: no.** Usa tokens o `color-mix(in srgb, var(--token) 10%, transparent)`. Para el grafo hay variables propias con valor claro y oscuro en `globals.css`: `--nodo-hospital`, `--nodo-comunicaciones`, `--nodo-ruta`, `--nodo-via`, `--nodo-bomberos`, `--nodo-policia`, `--nodo-sanitarios`, los tipos OSM `--nodo-residencia`, `--nodo-colegio`, `--nodo-subestacion`, `--nodo-estacion`, `--nodo-refugio`, `--nodo-gasolinera`, y `--humo` (penacho) y `--humo-nucleo` (eje del penacho, más denso). Reserva `--danger` para la incidencia. Si hace falta otra, pídesela a poc-25.

## 3. Tipografía

- **Manrope** (`font-sans`, `font-display`) para todo el texto; los titulares solo cambian el peso (700) y el tracking (−0,015 em). Nada de mayúsculas con tracking amplio salvo `.etiqueta`.
- **JetBrains Mono** (`font-mono`) para cifras, horas, ids, códigos. Siempre `tabular-nums` (activo en `body`).
- Escala en paneles densos: cuerpo 13 px (`text-[13px]`/`text-sm`), secundario 12 px (`text-xs`), meta 11 px (`text-[11px]`), eyebrow 10,5 px (`.etiqueta`). Titular de decisión 16–18 px semibold.
- Alias de compatibilidad: `--font-geist-*`, `--font-plex-*`, `--font-grotesk` apuntan a las nuevas familias.

## 4. Recetas (clases en `@layer components`)

| Clase | Para | Notas |
|---|---|---|
| `.pildora` (+ `-marca`, `-peligro`, `-aviso`, `-exito`, `-info`) | estado, fuente, ámbito, fase | siempre con icono o texto, nunca solo color |
| `.boton` + `-primario` / `-exito` / `-peligro` / `-secundario` / `-fantasma` (+ `-sm`) | acciones | **un primario por vista**; peligro solo en acciones destructivas o de denegación |
| `.chip` (`aria-pressed="true"` = activo) | filtros | mostrar el recuento en `font-mono` |
| `.fila-interactiva` (`aria-current="true"` = seleccionada) | filas y tarjetas clicables | añade un `ChevronRight` a la derecha y `cursor-pointer` |
| `.etiqueta` | eyebrow de sección | única mayúscula permitida |
| `.superficie` + `bg-panel border border-panel-border rounded-2xl` | panel | |
| `.ayuda` | icono (i) | vía `<Ayuda texto="…" />` |

Cabecera de panel estándar:

```tsx
<div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
  <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
    <Icono className="size-4 text-brand" /> Título del panel
    <Ayuda texto="Qué muestra este panel y de dónde salen los datos." />
  </h2>
  <span className="text-[11px] text-muted">… resumen numérico …</span>
</div>
```

## 5. Interactividad e información

- `<Tooltip contenido titulo lado>` envuelve cualquier elemento; `<Ayuda texto />` pone un (i). Se abre con ratón (retardo 160 ms) y con foco de teclado; se cierra con Escape. **Sustituye a `title=`** en todo lo que aporte contexto (umbrales, fuentes, cálculos).
- Cada métrica responde a tres preguntas: **qué es**, **de dónde sale** (fuente + hora) y **qué umbral la pone en rojo**.
- Lo clicable se ve clicable: hover con borde `panel-border-strong`, `ChevronRight`, `cursor-pointer`. Lo seleccionado usa `aria-current="true"`.
- Revelación progresiva: listas largas con "ver más", detalles plegados por defecto, duplicados agrupados.
- Confirmación en lo irreversible (reiniciar, eliminar regla, denegar): siempre inline, nunca `window.confirm`.
- Estados de carga y error inline y en el propio control (spinner en el botón, texto de error debajo).

## 6. Principios de UI/UX que aplicamos

1. **Jerarquía visual**: una acción primaria por vista; tres niveles de texto (foreground / muted / subtle); el color solo donde hay significado.
2. **Consistencia**: mismas recetas en todas las superficies (`/`, `/acceso`, `/ciudadano`, `/auditoria`).
3. **Visibilidad del estado del sistema**: conexión, modo de datos, fase, modelo que decidió, siempre a la vista y explicados.
4. **Reconocimiento antes que memoria**: etiquetas en lenguaje natural ("¿En qué se basa?", "Si no se actúa"), leyendas y tooltips.
5. **Prevención de errores y control**: confirmaciones inline, deshacer donde sea posible, permisos por rol explícitos ("Requiere firma de…").
6. **Accesibilidad**: contraste ≥ 4,5:1 en texto, foco visible (`:focus-visible`), `aria-*` en todo control, `prefers-reduced-motion` respetado, objetivos táctiles ≥ 32 px en acciones.
7. **Color nunca es el único canal**: icono + texto acompañan siempre al color de estado (daltonismo).
8. **Respeto al tiempo del mando**: densidad alta pero con aire (gap 12 px entre paneles, 8–12 px dentro), nada parpadea salvo la cuenta atrás < 60 s.

## 7. Qué NO hacer

- Colores Tailwind sueltos (`text-pink-300`, `bg-stone-400/10`…): rompen el tema oscuro y la coherencia.
- Rellenos saturados como fondo de tarjeta; mayúsculas con tracking en titulares; más de un botón primario por panel.
- `title=` para explicar algo importante; `window.confirm`; texto de 10 px en color `subtle`.
