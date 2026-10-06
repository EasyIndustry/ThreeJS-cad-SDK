# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versiones
según [SemVer](https://semver.org): mientras sea `0.x`, una versión menor puede romper algo,
y si rompe queda dicho arriba de todo en esa entrada. Los pre-releases (`-rc.N`) se prueban
en una app antes del release (ver `CONTRIBUTING.md`).

## [0.7.0] - sin publicar (pre-release `v0.7.0-rc.1`)

Responde a [#6](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/6) (la pieza es su
bruto más una lista de operaciones, y la forma que resulta es un cálculo) y
[#7](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/7) (formas reales: perfiles,
torneados y su geometría), [#8](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/8)
(agarre), [#9](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/9) (colocación) y
[#10](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/10) (recortes entre piezas),
[#11](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/11) (estirar un conjunto),
[#12](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/12) (relaciones entre partes:
[#13](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/13) juntas,
[#14](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/14) uniones y
[#15](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/15) vínculos) y
[#16](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/16) (despiece).

### Breaking

- **`shape` ahora se valida y se interpreta**: `{ kind: 'profile', axis, section, params? }` o
  `{ kind: 'lathe', axis, contour }`. Las formas del formato viejo de la app (`profile`, `t`,
  `rot`, `lathe`, `shaft`) se rechazan al crear la pieza; esa migración es de la app.
- **`vertices`, `edges` y `faces` de una pieza con perfil, torneado u operaciones son los de su
  forma real**, no los de su caja (un caño de 4 × 4 tiene 16 vértices). En una caja lisa no
  cambia nada. `boundingBox`, `dims` y el bruto siguen siendo los de la caja.
- `Face`: `localAxis` y `localSide` pueden ser null (una cara que no mira hacia un eje de la
  pieza), suma `holes`, y `area` descuenta los agujeros.

- **`toJSON()` escribe `version: 5`** (las piezas traen `operations`, y el documento,
  `relations` y `counters.relation`). Esta versión carga los documentos de antes; uno guardado
  con ella **no lo lee bien la 0.6.0**, que no sabía de versiones y perdería las operaciones y
  las relaciones sin avisar. Desde esta versión, `load()` rechaza un
  documento de un formato más nuevo que el que entiende, en vez de cargarlo a medias.
- `shape` es solo la forma del bruto (perfil, torneado). Los cortes por contorno, que en la app
  viajaban como `shape.kind === 'cut'`, pasan a ser operaciones `{ kind: 'cut', axis, outline }`
  (una por eje); esa migración es de la app.

### Added

- `pieza.addOperation(op)`, `updateOperation(id, op)`, `removeOperation(id)` y
  `pieza.operations`: `{ kind: 'cut', axis, outline }` (contorno normalizado, pasante) y
  `{ kind: 'hole', axis, side, at, diameter, depth? }`. Posiciones normalizadas sobre el bruto:
  `resize` las reaplica. `OPERATION_KINDS`.
- `pieza.stock` (el bruto: `{ size, shape }`), `pieza.solid` (la forma que resulta, en el mundo) y
  `pieza.local.solid` (en el marco de la pieza).
- `Mesh`: una malla de triángulos como valor (`positions`, `indices`, `volume`, `boundingBox`,
  `transform`).
- `createWorkshop({ kernel: { intersect, subtract } })`: opcional, para dibujar con una malla
  más limpia. Sin kernel, el SDK calcula la forma solo (la parte en convexos).
- Perfiles y torneados: `SECTIONS` (`rect-tube`, `round-tube`, `round-bar`, `angle`, `channel`,
  `tee`), `createWorkshop({ sections })` para las de la app, `pieza.setShape(shape)`.
- Contacto y choque exactos, con la forma real: `{ exact: true }` en `touches`, `intersects`,
  `contactsWith`, `intersectionsWith`, `taller.contacts` y `taller.collisions`. Un contacto contra
  una superficie curva es la línea donde apoya.
- Agarre: `parte.closest(punto, { tolerance?, space? })` (vértice, arista o cara más cercana,
  con franja por eje), `taller.pick(rayo, { exclude? })` (la primera pieza que corta, contra su
  forma real) y `sameFeature(a, b)`.
- Estirar: `ensamble.stretchPlanes(axis)`, `stretchPlan({ axis, plane?, side, delta, locked? })`
  (previsualizar, con su límite) y `stretch(...)` (en un solo paso de deshacer), en el marco del
  ensamble. `taller.tolerances.minLength`.
- Recortes: la operación `{ kind: 'trim', against, mode: 'box' | 'shape' }`. Depende del marco
  relativo entre las dos piezas (mover el ensamble que las contiene no la recalcula); borrar la
  otra quita el recorte en el mismo paso; mover la otra avisa por la recortada.
- El contacto y el choque son exactos, sin pedirlo, en los pares donde alguna pieza tiene
  recortes (`exact: false` fuerza las cajas).
- Colocación, funciones que proponen y no aplican: `taller.snap(partes, { distance?, grid? })`,
  `taller.pushOut(partes, { floor?, up? })`, `taller.drop(partes, { floor?, up? })`,
  `taller.alignmentGuides(partes)` y `Transform.orient(caraA, caraB, { faceToward?, flip? })`.
  Andan con piezas giradas y con grupos.
- `taller.tolerances` suma `grab` (agarre) y `snap` (imán), y `GRAB_RATIO`: valores sugeridos en
  `config.js`.
- `Mesh.surfaces` y `Mesh.smooth`: qué triángulos son la misma cara y cuáles aproximan una
  curva; de ahí salen los vértices y las aristas reales.
- La forma se cachea por lo que la define (medidas, forma del bruto, operaciones): mover no la
  recalcula, las instancias comparten la de su fuente y deshacer vuelve a encontrarla.
- Relaciones entre partes, en el documento: entran en el deshacer, se guardan, se limpian si se
  borra una de sus partes y se copian al duplicar o soltar; las de la fuente de una instancia se
  ven en ella con ids de camino. `taller.relation(id)`, `taller.relations({ kind?, part? })`,
  `Relation` (`kind`, `parts`, `broken`, `meta`, `setMeta`, `remove`), eventos `'relation'`,
  `'relation-broken'` y `'relation-remove'`. `RELATION_KINDS`. En el modelo:
  `model.addRelation`, `updateRelation`, `removeRelation`, `relation`, `allRelations`,
  `relationsOf`.
- Juntas: `taller.addJoint({ type: 'revolute' | 'prismatic', moving, base, axis, limits? })`,
  `joint.at(value)` (sin tocar el modelo), `joint.setLimits`, `taller.hingeCandidates(móvil, base)`
  y `taller.slideCandidates(móvil, base)`, en el marco de la base. `JOINT_TYPES`.
- Uniones: `taller.addFixing({ a, b, points? | count?, holes?, policy? })`, con puntos
  normalizados sobre el parche de contacto, agujeros como operaciones de las dos piezas y
  política `'break' | 'remove'` si se separan. `fixing.points` (con el espesor atravesado),
  `fixing.direction`, `fixing.update(...)`. `pieza.thicknessAt(punto, dirección)`.
- Vínculos: `taller.addLink({ base, face, moving, gap? })` y `taller.validateLink(spec)`; una punta
  anclada mueve, dos estiran, en cascada y en el mismo paso de deshacer. `link.setGap(gap)`.
- Despiece: `taller.cutList({ groupBy? })`, con filas
  `{ stock, material, length, width, thickness, count, ids, fixings }`.

### Changed

- El adaptador de three dibuja la forma que resulta; si no se puede calcular (falta el
  kernel), dibuja la caja y deja el motivo en `geometry.userData.solidError`.
- `dims`, la caja y el contacto siguen siendo los del bruto.

## [0.6.0] - sin publicar (pre-release `v0.6.0-rc.1`)

Responde a [#2](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/2),
[#3](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/3) y
[#4](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/4), y saca del SDK lo que era de
una app en particular.

### Breaking

- **Se sacaron `TOUCH` y `PEN`** (las tolerancias de contacto, 0,2 y 0,15 cm). Ahora salen de
  `taller.tolerances` (`{ touch, penetration }`), según la unidad del documento. Con la unidad
  por defecto (cm) los valores son los mismos de antes.
- **El adaptador de three ya no colorea por especie de madera.** Sin `materialFor`, todas las
  piezas salen de un gris neutro (`#9a9a92`). Una app que dependía del color por defecto
  tiene que pasar su propio `materialFor`.
- **`addPiece` sin `material` ya no asume `'pino'`**: el default es `'default'`.
- **`toJSON()` escribe `version: 3`**, con `units` y partes que pueden ser `kind: 'instance'`.
  Esta versión carga los documentos de antes (los toma como cm); un documento guardado con
  ella no lo lee la 0.1.0.
- Los textos de `help()` y de `toString()` de `Contact` e `Intersection` ya no dicen "cm":
  dicen "unidades del documento".
- Los registros que guarda el modelo son inmutables (congelados). Leer `model.parts` sigue
  andando; escribirle encima, que nunca fue API, ahora falla.

### Added

- **Piezas ya orientadas** (#2): `Transform.fromEuler(radians)` (Euler XYZ, la convención de
  three.js) y `addPiece({ ..., placement, axes })`. `axes` inválidos fallan con un error claro.
- **Instancias y matrices** (#3): `taller.instantiate(parte, { name?, parent?, placement? })`
  coloca la misma pieza o el mismo ensamble otra vez, y editar la fuente cambia todas sus
  instancias. `parte.source`, `parte.instances`, `parte.detach()` (soltar, conservando el id).
  `taller.array(parte, spec)` y `arrayTransforms(spec)`: lineal, en área y polar
  (`fit: 'span' | 'step'`, `orient`); `count` cuenta a la original. Lo de adentro de una
  instancia se lee como piezas con id de camino (`I-1/P-2`), que entran al contacto.
- **Unidades y tolerancias**: `createWorkshop({ units, tolerances })` con
  `'mm' | 'cm' | 'm' | 'in' | 'ft'` (cm por defecto); `taller.units`, `taller.tolerances`.
  Los valores sugeridos viven solo en `src/config.js`, en la unidad natural de cada sistema
  (2 mm y 1,5 mm; 1/16 in y 3/64 in), y se llevan a la unidad del documento. `src/units.js`
  (`UNITS`, `convertLength`).
- **Deshacer y rehacer** (#4): `taller.undo()`, `redo()`, `canUndo`, `canRedo`,
  `clearHistory()`; `begin()` / `commit()` / `rollback()` y `transaction(fn)` para que varios
  cambios sean un solo paso; `createWorkshop({ historyLimit })` (100 por defecto). Avisos
  `'undo'`, `'redo'` y `'rollback'` con los ids que cambiaron.
- `CONTRIBUTING.md` (el contrato, el criterio de qué es agnóstico, la compatibilidad hacia
  atrás y el flujo de ramas y releases) y este `CHANGELOG.md`.

### Changed

- Toda operación es atómica: si falla a mitad de camino, el documento queda como estaba.
- `taller.contacts()` y `taller.collisions()` incluyen las piezas de adentro de las
  instancias. Sin instancias, dan lo mismo que antes.
- No se borra ni se deshace (`explode`) la fuente de una instancia: el error dice cuáles la
  usan. `duplicate()` de un conjunto con una fuente y sus instancias remapea las instancias a
  la fuente copiada.
- `load()` valida antes de reemplazar nada (instancia sin fuente, conjuntos que se contienen
  a sí mismos) y borra el historial; `clear()` borra el historial y conserva la unidad.
- El umbral con que se descarta una cara de contacto "astilla" es (tolerancia / 200)², en vez
  de un `1e-6` fijo en cm².
- El adaptador de three dibuja las piezas de adentro de las instancias (con su id de camino en
  `userData.id`) y escala sus ayudas visuales con la unidad del documento.

### Removed

- `lab/index.html`, la consola de prueba manual: tenía nombre y tema de una app de carpintería
  y nunca se vendorizaba. El testeo visual queda del lado de cada app.

## [0.1.0] - 2026-10-06

Primera versión. El núcleo puro (documento, partes, marcos, geometría, contacto e
intersección, con `help()` verificado por test) y el adaptador de three que espeja el
modelo en una escena.

[0.7.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/compare/v0.6.0-rc.1...claude/nice-newton-92bqym
[0.6.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/compare/v0.1.0...v0.6.0-rc.1
[0.1.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/releases/tag/v0.1.0
