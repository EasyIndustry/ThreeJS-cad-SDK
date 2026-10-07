# Referencia de la API — threejs-cad-sdk 0.7.0

> Generada por `scripts/docs.mjs` desde las tablas de `help()`, que una prueba verifica contra el código. No se edita a mano: `npm run docs`.
> Para entender cómo se usa cada cosa, el [README](https://github.com/EasyIndustry/ThreeJS-cad-SDK#readme). Para buscar, la [versión con buscador](index.html).

## Índice

- **Para empezar**
  - [Módulo](#module) — lo que se importa de 'threejs-cad-sdk'
  - [Workshop](#workshop) — el documento: crear, buscar y guardar partes
- **Partes**
  - [Part](#part) — lo que tiene toda parte: Piece y Assembly
  - [Piece](#piece) — una pieza: lo que se corta
  - [Assembly](#assembly) — un conjunto de partes con colocación propia
- **Relaciones**
  - [Relation](#relation) — una relación entre partes
  - [Joint](#joint) — una junta: bisagra (revolute) o corredera (prismatic)
  - [Fixing](#fixing) — una unión entre dos piezas que se tocan
  - [Link](#link) — la punta de una pieza anclada a la cara de otra
- **Valores**
  - [Point3d](#point3d) — un punto en el espacio
  - [Vector3d](#vector3d) — una dirección con largo
  - [Line](#line) — un segmento entre dos puntos
  - [BoundingBox](#boundingbox) — la caja alineada a los ejes que encierra algo
  - [Face](#face) — una cara de una pieza
  - [Transform](#transform) — mover y girar: el verbo común a toda geometría
  - [Contact](#contact) — dónde se tocan dos piezas
  - [Intersection](#intersection) — dos piezas que se meten una en otra
  - [Mesh](#mesh) — una malla de triángulos: la forma que resulta de una pieza
- **Adaptador**
  - [createThreeView](#three) — el adaptador de three ('threejs-cad-sdk/three')

<a id="module"></a>

## Módulo

_lo que se importa de 'threejs-cad-sdk'_

Todo sale de `createWorkshop()`: el documento, con sus partes, sus relaciones y su historial. Las medidas son números en la unidad del documento; los ángulos, en grados.

| Miembro | Qué hace |
|---|---|
| `createWorkshop({ units?, tolerances?, historyLimit?, kernel?, sections? })` | un documento nuevo (el Workshop): la puerta de entrada a todo. units: 'mm' \| 'cm' \| 'm' \| 'in' \| 'ft' (cm); tolerances pisa las sugeridas; historyLimit, cuántos pasos se deshacen (100); kernel { intersect, subtract } para mallas más limpias; sections, perfiles propios. También acepta un Model ya armado |
| `Part  Piece  Assembly` | las partes del documento: Part es lo común, Piece una pieza (lo que se corta), Assembly un conjunto de partes. No se construyen a mano: salen del Workshop |
| `Relation  Joint  Fixing  Link` | las relaciones entre partes: Relation es lo común; Joint una junta (bisagra o corredera), Fixing una unión, Link un vínculo. Salen del Workshop |
| `Point3d  Vector3d  Line  BoundingBox  Face  Transform  Contact  Intersection  Mesh` | las clases de valores: inmutables, sin identidad. Lo que se consulta de una parte |
| `sameFeature(a, b)` | ¿dos resultados de closest() son el mismo rasgo de la misma pieza? (para no redibujar mientras el cursor sigue sobre lo mismo) |
| `arrayTransforms(spec, { origin? })` | las transformaciones de una matriz lineal, en área o polar ({ type: 'linear' \| 'area' \| 'polar', count, … }); la 0 es la identidad |
| `convertLength(value, from, to)` | llevar una medida de una unidad a otra |
| `tolerancesFor(unit, overrides?)` | las tolerancias sugeridas para una unidad, con lo que se pise: { touch, penetration, grab, snap, minLength } |
| `UNITS` | las unidades que se pueden usar, con su sistema y cuántos mm miden |
| `TOLERANCE_PRESETS` | las tolerancias sugeridas de cada sistema, en su unidad natural (las lleva a la del documento tolerancesFor) |
| `GRAB_RATIO` | la franja del agarre en cada eje de una pieza no pasa de esta proporción de su largo |
| `OPERATION_KINDS` | las operaciones que se le pueden hacer al bruto de una pieza |
| `SECTIONS` | las secciones de perfil que trae el SDK: { nombre: (params, ancho, alto) => sección } |
| `RELATION_KINDS` | los tipos de relación que el SDK pone en orden |
| `JOINT_TYPES` | los tipos de junta |
| `WORKSHOP_MEMBERS` | la tabla de lo que tiene un Workshop (la que imprime taller.help()) |
| `MODULE_MEMBERS` | esta tabla |

**Valores**

| Nombre | Valor |
|---|---|
| `UNITS` | mm: {system: metric, mm: 1} · cm: {system: metric, mm: 10} · m: {system: metric, mm: 1000} · in: {system: imperial, mm: 25.4} · ft: {system: imperial, mm: 304.8} |
| `TOLERANCE_PRESETS` | metric: {unit: mm, touch: 2, penetration: 1.5, grab: 10, snap: 25, minLength: 10} · imperial: {unit: in, touch: 0.0625, penetration: 0.046875, grab: 0.375, snap: 1, minLength: 0.375} |
| `GRAB_RATIO` | 0.3 |
| `OPERATION_KINDS` | 'cut', 'hole', 'trim' |
| `SECTIONS` | 'rect-tube', 'round-tube', 'round-bar', 'angle', 'channel', 'tee' |
| `RELATION_KINDS` | 'joint', 'fixing', 'link' |
| `JOINT_TYPES` | 'revolute', 'prismatic' |

<a id="workshop"></a>

## Workshop

_el documento: crear, buscar y guardar partes_

Lo que devuelve `createWorkshop()`. En los ejemplos se llama `taller`, pero el nombre de la variable es de quien lo usa.

| Miembro | Qué hace |
|---|---|
| `addPiece({ name?, size, material?, shape?, center?, placement?, axes? })` | una pieza nueva: size en la unidad del documento sobre sus ejes locales; placement (Transform) la orienta al crearla; axes fuerza cuál eje es el largo, el ancho y el espesor |
| `assemble(parts, { name? })` | un ensamble con esas partes hermanas; se anida, no se aplasta |
| `instantiate(part, { name?, parent?, placement? })` | una instancia: la misma parte colocada otra vez; editar la fuente cambia todas |
| `array(part, spec)` | repetir una parte en línea, en área o alrededor de un eje: crea instancias (ver arrayTransforms) |
| `pick(ray, { exclude? })` | la primera pieza que corta un rayo { origin, direction }, contra su forma real: { part, point, distance, normal }, o null |
| `snap(parts, { against?, distance?, grid? })` | imán: { transform, snaps } que pega sus caras a las de otras piezas cercanas (no aplica nada) |
| `pushOut(parts, { against?, floor?, up? })` | si está metida en otras, { transform, from } que la saca por el lado de menor penetración |
| `drop(parts, { against?, floor?, up? })` | apoyar: { transform, distance, on } hasta tocar lo de abajo o el piso |
| `alignmentGuides(parts, { against?, tolerance? })` | los planos de otras piezas con los que quedó alineada, los más cercanos primero |
| `addJoint({ type, moving, base, axis, limits?, meta? })` | una junta: la móvil gira sobre axis ('revolute') o corre a lo largo de él ('prismatic'); se abre con joint.at(value) |
| `hingeCandidates(moving, base)` | los cantos donde puede ir una bisagra, en el marco de la base; cada uno va directo a addJoint |
| `slideCandidates(moving, base)` | las direcciones en que la móvil corre sin chocar con la base; cada una va directo a addJoint |
| `addFixing({ a, b, points?, count?, holes?, policy?, meta? })` | una unión entre dos piezas que se tocan: puntos normalizados en el parche, agujeros en las dos |
| `addLink({ base, face, moving, gap?, meta? })` | un vínculo: la punta de moving anclada a una cara de base; una punta mueve, dos estiran |
| `validateLink({ base, face, moving })` | ¿se puede crear ese vínculo? { ok } o { ok: false, reason: 'over-constrained' \| 'cycle' \| 'not-parallel' \| …, message } |
| `relation(id)` | una relación por su id (Joint, Fixing, Link) |
| `relations({ kind?, part? })` | las relaciones del documento, con las de adentro de las instancias |
| `cutList({ groupBy? })` | el despiece: { stock, material, length, width, thickness, count, ids, fixings } por grupo de piezas idénticas |
| `part(id)` | una parte por su id |
| `parts` | todas las partes |
| `roots` | las partes de primer nivel (las que no están en un ensamble) |
| `units` | la unidad de todas las medidas del documento: 'mm', 'cm', 'm', 'in' o 'ft' |
| `tolerances` | las tolerancias en uso, en esa unidad: { touch, penetration } (ver config.js) |
| `contacts({ tolerance?, exact? })` | todos los contactos entre piezas (Contact); exact: con la forma real |
| `collisions({ tolerance?, exact? })` | todas las piezas que se meten unas en otras (Intersection) |
| `tree()` | el árbol de partes, como texto |
| `on(fn)` | enterarse de cada cambio ({ type, ids }); deshacer avisa con 'undo' y 'redo', cancelar con 'rollback', y las relaciones con 'relation', 'relation-broken' y 'relation-remove'; devuelve cómo desuscribirse |
| `undo()` | volver al documento de antes del último paso; false si no había nada |
| `redo()` | volver a hacer lo último que se deshizo; false si no había nada |
| `canUndo` | ¿hay algo para deshacer? |
| `canRedo` | ¿hay algo para rehacer? |
| `begin()` | abrir una transacción: lo que se haga hasta commit() es un solo paso de deshacer (se anidan) |
| `commit()` | cerrar la transacción abierta |
| `rollback()` | cancelar la transacción abierta: el documento vuelve a como estaba en begin() |
| `transaction(fn)` | hacer fn como un solo paso de deshacer; si tira, todo vuelve a como estaba |
| `clearHistory()` | olvidar lo que se puede deshacer y rehacer |
| `toJSON()` | todo el documento, para guardar |
| `load(data)` | cargar un documento guardado (borra el historial) |
| `clear()` | vaciar el documento (borra el historial; conserva la unidad) |
| `model` | el modelo por dentro (para el visor y las pruebas) |
| `Point3d  Vector3d  Line  BoundingBox  Face  Transform  Contact  Intersection  Mesh` | las clases de valores, a mano |
| `help()` | esta tabla |

<a id="part"></a>

## Part

_lo que tiene toda parte: Piece y Assembly_

Identidad, colocación, geometría consultable y los verbos. La geometría se lee en el mundo, o en el marco de la parte con `local`.

| Miembro | Qué hace |
|---|---|
| `id` | su identificador (P-1, E-1…) |
| `kind` | 'piece' o 'assembly' |
| `name` | su nombre |
| `parent` | el ensamble que la contiene, o null |
| `source` | de quién es copia, si es una instancia (o de adentro de una); si no, null |
| `instances` | las instancias que se colocaron de ella |
| `placement` | su colocación en el mundo (Transform) |
| `axes` | sus ejes locales x, y, z vistos desde el mundo (Vector3d) |
| `vertices` | sus vértices en el mundo (Point3d), los de su forma real. vertices[0].x se lee, no se escribe |
| `edges` | sus aristas rectas en el mundo (Line); las de una superficie curva no se ofrecen |
| `faces` | sus caras planas en el mundo (Face), con sus agujeros |
| `boundingBox` | la caja que la encierra, alineada al mundo |
| `local` | lo mismo en su propio marco: local.vertices, local.edges, local.faces, local.boundingBox (y local.solid, en una pieza) |
| `transform(t)` | aplicarle un Transform: el verbo del que salen los demás |
| `move(v) / move(from, to)` | trasladar por un vector, o de un punto a otro |
| `rotate(degrees, axis?, center?)` | girar en grados; eje 'x' \| 'y' \| 'z' o un vector; por el centro de su caja |
| `duplicate()` | copia exacta en el mismo lugar, con todo lo de adentro (independiente: no sigue a la original) |
| `detach()` | soltar una instancia: pasa a ser una parte de verdad, que ya no sigue a su fuente |
| `rename(name)` | cambiarle el nombre |
| `remove()` | borrarla, con todo lo que cuelga de ella |
| `touches(other, { tolerance?, exact? })` | ¿se toca con la otra sin meterse? (a tolerances.touch o menos). exact: con la forma real, no la caja |
| `intersects(other, { tolerance?, exact? })` | ¿se mete en la otra? (más de tolerances.penetration) |
| `contactsWith(other, { tolerance?, exact? })` | dónde se toca con la otra (Contact). Con ella misma: sus uniones internas |
| `intersectionsWith(other, { tolerance?, exact? })` | lo que comparte de volumen con la otra (Intersection) |
| `closest(point, { tolerance?, space? })` | el vértice, la arista o la cara más cercana: { kind, piece, point, edge, face, key }, o null |
| `toString()` | para leer |
| `help()` | esta tabla |

<a id="piece"></a>

## Piece

_una pieza: lo que se corta_

Además, todo lo de [Part](#part).

| Miembro | Qué hace |
|---|---|
| `size` | sus medidas en su marco local: { x, y, z } |
| `dims` | { length, width, thickness }: largo, ancho y espesor — gire como gire |
| `directions` | hacia dónde corren su largo, ancho y espesor en el mundo (Vector3d) |
| `material` | su material |
| `shape` | la forma de su bruto: { kind: 'profile', axis, section, params? }, { kind: 'lathe', axis, contour } o null (una caja) |
| `stock` | su bruto, lo que se compra: { size, shape }; las operaciones no lo cambian |
| `operations` | lo que se le hace al bruto, en orden: { id, kind: 'cut' \| 'hole', … } |
| `solid` | la forma que resulta (Mesh), en el mundo: se calcula, no se guarda |
| `resize(size)` | cambiar sus medidas en su marco local; las operaciones se reaplican |
| `setMaterial(m)` | cambiarle el material |
| `setShape(shape)` | cambiarle la forma del bruto (perfil, torneado; null: una caja) |
| `addOperation(op)` | agregar una operación: { kind: 'cut', axis, outline } o { kind: 'hole', axis, side, at, diameter, depth? } |
| `updateOperation(id, op)` | reemplazar una operación, en su lugar |
| `removeOperation(id)` | sacar una operación: la forma vuelve a la de antes |
| `thicknessAt(point, direction)` | cuánto material atraviesa la recta por point en esa dirección (la pared, si es un caño), o null |
| `static help()` | esta tabla, sin crear una pieza |

<a id="assembly"></a>

## Assembly

_un conjunto de partes con colocación propia_

Además, todo lo de [Part](#part).

| Miembro | Qué hace |
|---|---|
| `children` | las partes de adentro, primer nivel |
| `pieces` | todas las piezas de adentro, a cualquier profundidad |
| `explode()` | deshacerlo: sus partes quedan en el mismo lugar |
| `stretchPlanes(axis, { locked? })` | dónde se puede cortar para estirar sobre un eje del ensamble: { plane, gap }, el hueco más ancho primero |
| `stretchPlan({ axis, plane?, side?, delta?, locked?, minLength? })` | lo que haría estirar, sin hacerlo: qué se estira, se mueve o se queda, y el límite |
| `stretch({ axis, plane?, side?, delta?, locked?, minLength? })` | estirar (o achicar) por un plano, en un solo paso de deshacer |
| `static help()` | esta tabla, sin crear un ensamble |

<a id="relation"></a>

## Relation

_una relación entre partes_

Viven en el documento entre partes guardadas: entran en el deshacer, se guardan y se limpian solas si se borra una de sus partes.

| Miembro | Qué hace |
|---|---|
| `id` | su identificador (R-1…; I-1/R-2 si es de adentro de una instancia) |
| `record` | lo guardado, tal cual: { id, kind, parts, data, ops, broken, meta } |
| `kind` | 'joint', 'fixing' o 'link' |
| `parts` | las partes que relaciona |
| `broken` | null si vale; si no, por qué |
| `meta` | lo que la app guardó con ella (el SDK no lo lee) |
| `isVirtual` | ¿es de adentro de una instancia? (se lee; se cambia en la fuente) |
| `setMeta(meta)` | cambiar lo que la app guarda con ella |
| `remove()` | borrarla, con las operaciones que son de ella |
| `toString()` | para leer |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una relación |

<a id="joint"></a>

## Joint

_una junta: bisagra (revolute) o corredera (prismatic)_

Además, todo lo de [Relation](#relation).

| Miembro | Qué hace |
|---|---|
| `type` | 'revolute' (gira) o 'prismatic' (corre) |
| `moving` | la parte que se mueve |
| `base` | la parte respecto de la cual se mueve (el eje vive en su marco) |
| `axis` | el eje en el mundo (Line de largo 1 en su dirección) |
| `limits` | { min, max } en grados o unidades del documento, o null |
| `setLimits(limits)` | cambiarle los límites ({ min, max }, [min, max] o null) |
| `at(value)` | abierta en value, sin cambiar nada: { value, limited, transform, placement, placements: { [id de pieza]: Transform } } |

<a id="fixing"></a>

## Fixing

_una unión entre dos piezas que se tocan_

Además, todo lo de [Relation](#relation).

| Miembro | Qué hace |
|---|---|
| `a` | la pieza por donde entra (la cabeza queda en su cara de afuera) |
| `b` | la pieza donde agarra |
| `policy` | 'break' (si se separan queda rota) o 'remove' (se borra) |
| `count` | cuántos puntos reparte sola, o null si van puestos a mano |
| `holes` | los agujeros en cada pieza: { a: { diameter, depth? } \| null, b: … } |
| `placement` | dónde está ahora: { patch, faceA, faceB, direction, points }, o null si no se tocan |
| `direction` | hacia dónde entra, de a hacia b (Vector3d), o null |
| `points` | sus puntos: { uv, point, thickness: { a, b } } |
| `update({ points?, count?, holes?, policy? })` | cambiar sus puntos, su reparto, sus agujeros o su política |

<a id="link"></a>

## Link

_la punta de una pieza anclada a la cara de otra_

Además, todo lo de [Relation](#relation).

| Miembro | Qué hace |
|---|---|
| `base` | la pieza de la cara (la que manda) |
| `moving` | la pieza anclada (la que sigue) |
| `face` | la cara de la base: { localAxis, localSide } |
| `end` | la punta anclada de la móvil: { localAxis, localSide } |
| `gap` | la separación, hacia afuera de la base (0: al ras; negativo: se mete) |
| `setGap(gap)` | cambiar la separación |

<a id="point3d"></a>

## Point3d

_un punto en el espacio_

| Miembro | Qué hace |
|---|---|
| `new Point3d(x, y, z)` | un punto nuevo |
| `x  y  z` | sus coordenadas (solo lectura) |
| `static from(v)` | un Point3d a partir de [x, y, z] o de un objeto con x, y, z |
| `static origin` | el (0, 0, 0) |
| `distanceTo(p)` | la distancia a otro punto |
| `add(v)` | el punto corrido por un vector |
| `subtract(p)` | el Vector3d que va de p a este punto |
| `transform(t)` | el punto transformado (devuelve uno nuevo) |
| `equals(p, tol?)` | ¿es el mismo punto, con tolerancia? |
| `toArray()` | [x, y, z] |
| `toString()` | para leer: (x, y, z) |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una instancia |

<a id="vector3d"></a>

## Vector3d

_una dirección con largo_

| Miembro | Qué hace |
|---|---|
| `new Vector3d(x, y, z)` | un vector nuevo |
| `x  y  z` | sus componentes (solo lectura) |
| `static from(v)` | un Vector3d a partir de [x, y, z] o de un objeto con x, y, z |
| `static xAxis` | el <1, 0, 0> |
| `static yAxis` | el <0, 1, 0> |
| `static zAxis` | el <0, 0, 1> |
| `length` | su largo |
| `unitize()` | el mismo vector con largo 1 |
| `multiply(s)` | el vector multiplicado por un número |
| `add(v)` | la suma con otro vector |
| `reverse()` | el vector al revés |
| `dot(v)` | producto escalar |
| `cross(v)` | producto vectorial: perpendicular a los dos |
| `angleTo(v)` | el ángulo con otro vector, en grados |
| `transform(t)` | el vector girado (la traslación no lo afecta) |
| `equals(v, tol?)` | ¿es el mismo vector, con tolerancia? |
| `toArray()` | [x, y, z] |
| `toString()` | para leer: <x, y, z> |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una instancia |

<a id="line"></a>

## Line

_un segmento entre dos puntos_

| Miembro | Qué hace |
|---|---|
| `new Line(from, to)` | un segmento nuevo |
| `from  to` | sus dos puntas (Point3d) |
| `length` | su largo |
| `direction` | el Vector3d de from a to |
| `midpoint` | el punto del medio |
| `transform(t)` | el segmento transformado (devuelve uno nuevo) |
| `toString()` | para leer |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una instancia |

<a id="boundingbox"></a>

## BoundingBox

_la caja alineada a los ejes que encierra algo_

| Miembro | Qué hace |
|---|---|
| `new BoundingBox(min, max)` | una caja nueva |
| `min  max` | sus dos esquinas opuestas (Point3d) |
| `static fromPoints(points)` | la caja que encierra a todos los puntos |
| `center` | el centro |
| `diagonal` | de min a max: ancho, alto y profundidad |
| `corners` | las 8 esquinas |
| `contains(p, tol?)` | ¿el punto está adentro? |
| `union(b)` | la caja que encierra a las dos |
| `transform(t)` | la caja que encierra a esta, transformada |
| `toString()` | para leer |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una instancia |

<a id="face"></a>

## Face

_una cara de una pieza_

| Miembro | Qué hace |
|---|---|
| `piece` | el id de la pieza |
| `localAxis  localSide` | cuál cara es en la pieza: eje local y lado (+1 o -1); null si no mira hacia un eje |
| `normal` | hacia dónde mira (Vector3d) |
| `center` | su centro (Point3d) |
| `vertices` | su contorno, en orden (4 esquinas en una caja) |
| `holes` | sus agujeros: un contorno por agujero (vacío en una caja) |
| `edges` | sus aristas (Line), las del contorno y las de los agujeros |
| `area` | su superficie sin los agujeros, en unidades del documento al cuadrado |
| `transform(t)` | la cara transformada (devuelve una nueva) |
| `toString()` | para leer |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una instancia |

<a id="transform"></a>

## Transform

_mover y girar: el verbo común a toda geometría_

| Miembro | Qué hace |
|---|---|
| `static identity()` | la que no hace nada |
| `static translation(v) / translation(from, to)` | trasladar por un vector, o de un punto a otro |
| `static rotation(degrees, axis?, center?)` | girar en grados; eje 'x' \| 'y' \| 'z' o un vector; centro por defecto el origen |
| `static orient(faceA, faceB, { faceToward?, flip? })` | lleva la cara A sobre la B (centros juntos, enfrentadas o del mismo lado); flip gira 180° |
| `static fromEuler(radians)` | el giro de un Euler XYZ en radianes (Rx · Ry · Rz), la convención 'XYZ' de three.js; sin traslación |
| `static apply(t, items)` | aplicarla a todo un array (piezas, ensambles, puntos…) |
| `static check(t)` | falla con un mensaje claro si t no es un Transform |
| `frame` | la matriz por dentro: { r (3×3 por filas), t } |
| `multiply(other)` | componer: primero other, después esta |
| `inverse()` | la que deshace a esta |
| `isIdentity` | ¿no hace nada? |
| `isQuarterTurn` | ¿gira solo en cuartos de vuelta? |
| `translationVector` | cuánto traslada (Vector3d) |
| `eulerDegrees` | el giro como Euler XYZ, en grados |
| `toString()` | para leer |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una instancia |

<a id="contact"></a>

## Contact

_dónde se tocan dos piezas_

| Miembro | Qué hace |
|---|---|
| `kind` | 'face' (se tocan dos caras), 'edge' (una arista apoyada) o 'point' (un vértice) |
| `a  b` | los ids de las dos piezas |
| `points` | face: el polígono donde se solapan · edge: sus dos puntas · point: el punto |
| `area` | la superficie de contacto, en unidades del documento al cuadrado (0 si es arista o punto) |
| `normal` | hacia dónde mira el contacto, de a hacia b (Vector3d) |
| `faceA  faceB` | cuál cara de cada pieza, en la pieza: { localAxis, localSide } (null si no es de cara) |
| `center` | el centro del contacto |
| `line` | la arista de contacto (Line), si es de arista; si no, null |
| `transform(t)` | el contacto transformado (devuelve uno nuevo) |
| `toString()` | para leer |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear un contacto |

<a id="intersection"></a>

## Intersection

_dos piezas que se meten una en otra_

| Miembro | Qué hace |
|---|---|
| `a  b` | los ids de las dos piezas |
| `volume` | el volumen compartido, en unidades del documento al cubo |
| `depth` | cuánto se meten: lo mínimo que habría que correr una (en unidades del documento) |
| `vertices` | los vértices del sólido compartido |
| `faces` | sus caras, como polígonos de Point3d |
| `boundingBox` | la caja que lo encierra |
| `transform(t)` | transformado (devuelve uno nuevo) |
| `toString()` | para leer |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una |

<a id="mesh"></a>

## Mesh

_una malla de triángulos: la forma que resulta de una pieza_

| Miembro | Qué hace |
|---|---|
| `new Mesh({ positions, indices })` | una malla nueva |
| `positions` | x, y, z de cada vértice, uno detrás de otro |
| `indices` | de a tres: los vértices de cada triángulo, antihorario visto desde afuera |
| `surfaces` | a qué superficie pertenece cada triángulo, o null si no se sabe |
| `smooth` | por superficie: ¿aproxima una curva? (o null) |
| `static from(m)` | una Mesh a partir de cualquier { positions, indices } |
| `vertexCount` | cuántos vértices tiene |
| `triangleCount` | cuántos triángulos tiene |
| `volume` | el volumen que encierra |
| `boundingBox` | la caja que la encierra |
| `transform(t)` | la malla transformada (devuelve una nueva) |
| `toString()` | para leer |
| `help()` | esta tabla |
| `static help()` | esta tabla, sin crear una instancia |

<a id="three"></a>

## createThreeView

_el adaptador de three ('threejs-cad-sdk/three')_

Lo único del SDK que importa three. No es dueño de nada: escucha los eventos del documento y deja cada malla donde el modelo dice. Renderer, cámara y controles son de la app.

| Miembro | Qué hace |
|---|---|
| `createThreeView(workshop, { scene, geometryFor?, materialFor?, colors? })` | espeja el documento en una escena de three: cuelga un grupo en scene y lo mantiene al día con los eventos del modelo. geometryFor(piece) y materialFor(piece) son los ganchos de la app (por defecto: la forma que resulta y un gris neutro). colors: { edge, highlight, contact, collision } |
| `group` | el grupo que el adaptador cuelga en la escena |
| `meshes` | las mallas por id de pieza (las de adentro de una instancia, con su id de camino), para elegir con un raycaster |
| `sync()` | sincroniza ya, sin esperar al próximo cuadro |
| `show` | capas de ayuda: show.axes(on), show.boxes(on), show.labels(on) (necesita un CSS2DRenderer) y show.contacts(on) (verde donde se tocan, rojo donde chocan) |
| `highlight(...parts)` | resalta partes, con todo lo de adentro; sin argumentos, apaga |
| `rebuild()` | rehace todas las mallas (si cambió lo que devuelven los ganchos) |
| `dispose()` | se desengancha del modelo y saca todo de la escena |
