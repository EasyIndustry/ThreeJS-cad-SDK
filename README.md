# threejs-cad-sdk

Un modelo de CAD para apps de [three.js](https://threejs.org): piezas, ensambles, marcos
locales y del mundo, contacto e intersección. La API copia la forma y los nombres de
RhinoCommon (`Point3d`, `Transform`, `BoundingBox`, `vertices`, `faces`), y cada clase dice
lo que sabe hacer con `help()`.

```js
const taller = createWorkshop();
const tapa = taller.addPiece({ name: 'Tapa', size: [90, 1.8, 50], center: [0, 75, 0] });
tapa.rotate(30, 'y');
tapa.vertices[0].x;        // en el mundo — se lee, no se escribe
tapa.local.vertices;       // lo mismo, en el marco de la pieza
tapa.dims;                 // { length: 90, width: 50, thickness: 1.8 } — gire como gire
tapa.touches(pata);        // ¿se tocan?  tapa.contactsWith(pata): dónde
taller.help();             // todo lo que hay
```

- **Sin build.** Módulos ES de JavaScript, con tipos en JSDoc verificados por `tsc` en modo
  estricto. El navegador los carga tal cual.
- **Núcleo puro.** `src/` no importa three ni el DOM: corre igual en el navegador y en Node,
  y lo puede usar un servidor (por ejemplo, para presupuestar con la misma geometría que ve
  el cliente).
- **three, en un adaptador.** `adapters/three/viewer.js` espeja el modelo en una escena. Es
  lo único que importa three, y es opcional.
- **Sin dependencias.** Ni de ejecución ni de build. three es *peer* y solo para el adaptador.

## Estructura

```
src/                 el núcleo: modelo, marcos, geometría, contacto. Puro.
  index.js           la API: createWorkshop, Piece, Assembly y los valores
  model.js           el árbol de partes y sus marcos
  frame.js           marcos: rotación 3×3 + traslación, cuartos de vuelta exactos
  geometry.js        Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection
  contact.js         contacto e intersección entre cajas orientadas
  help.js            help(): la ayuda de cada clase
adapters/three/      el visor para three (opcional)
examples/demo.js     un bastidor con una diagonal, ensamblado, girado y repetido
test/                las pruebas, en Node
```

## Usarlo

### En el navegador, sin build

Con un importmap para three (solo si usás el adaptador):

```html
<script type="importmap">
  { "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/" } }
</script>
<script type="module">
  import { createWorkshop } from './vendor/threejs-cad-sdk/src/index.js';
  import { createThreeView } from './vendor/threejs-cad-sdk/adapters/three/viewer.js';

  const taller = createWorkshop();
  const vista = createThreeView(taller, { scene });   // tu escena, tu cámara, tu renderer
  vista.show.contacts(true);
</script>
```

El adaptador no crea renderer, cámara ni controles: eso es de la app. Cuelga un grupo en la
escena que le pases y lo mantiene igual al modelo. La forma y el material de cada pieza los
podés decidir vos con `geometryFor(piece)` y `materialFor(piece)`; por defecto, una caja de
sus medidas y un color por material.

### En Node

```js
import { createWorkshop } from './vendor/threejs-cad-sdk/src/index.js';
```

Nada más: el núcleo no necesita three.

## Vendorizar

La idea es copiar una versión fija del SDK adentro de tu app, en vez de instalarlo. Sin
build, sin `node_modules`, y la app sabe exactamente qué versión usa.

```bash
VERSION=v0.1.0
git clone --depth 1 --branch "$VERSION" https://github.com/EasyIndustry/ThreeJS-cad-SDK.git /tmp/threejs-cad-sdk
DEST=web/vendor/threejs-cad-sdk
rm -rf "$DEST" && mkdir -p "$DEST"
cp -r /tmp/threejs-cad-sdk/{src,adapters,examples,LICENSE} "$DEST"/
echo "$VERSION $(git -C /tmp/threejs-cad-sdk rev-parse HEAD)" > "$DEST/VERSION"
```

Las reglas para que la copia siga siendo una copia:

- **No se edita en la app.** Un arreglo va acá, sale en una versión, y se vuelve a vendorizar.
- **`VERSION` dice de dónde salió**: la etiqueta y el commit exacto.
- **La licencia viaja con el código** (MIT pide que el aviso acompañe las copias).

Las versiones siguen [semver](https://semver.org). Mientras sea `0.x`, la API puede cambiar
entre versiones menores; cada cambio que rompa algo queda dicho en la nota de la versión.

## Probarlo

```bash
npm test             # las pruebas, en Node (sin navegador)
npm run typecheck    # tsc estricto
```

El testeo visual, a mano, queda del lado de cada app que vendoriza el SDK: arma su propia
escena con `adapters/three/viewer.js` (o lee `examples/demo.js` como punto de partida).

## La idea

**Una pieza se define en su marco local, y esa definición no cambia nunca al moverla ni al
girarla.** Lo único que cambia es su *marco*: dónde está y cómo está girada. Es la
separación que hace Rhino entre la geometría y su transformación.

Sin esa separación, girar 90° termina reescribiendo las medidas y la forma para que la pieza
*parezca* girada sin dejar de estar alineada a los ejes, y la orientación termina diciendo
cuál es el ancho. De ahí salen bugs como girar un ensamble de largueros y que se les
reescriba la forma, o que un ensamble armado y girado no se pueda repetir. Este SDK nació
para sacar esos dos, y las primeras pruebas los reproducen.

Los niveles:

| nivel | qué es | dónde |
|---|---|---|
| **definición** | lo que la pieza ES: medidas, material, forma, cuál eje es el largo | `PieceDef` en `model.js` |
| **marco** | dónde está y cómo está girada, respecto de su padre | `frame.js` |
| **composición** | partes adentro de partes: un ensamble es una parte más | `AssemblyDef` en `model.js` |

Una **parte** es lo que se mueve, se gira, se duplica y se mete en un ensamble. Hay dos:

- la **pieza** es una hoja: tiene todo lo fabricable.
- el **ensamble** es un nodo: no tiene nada fabricable propio, compone. Su caja sale de sus
  hijos. Como es una parte más, se anida: ensamblar dos ensambles los mete adentro de uno
  nuevo, no los aplasta en uno.

Cada parte guarda su marco **respecto de su padre**. Girar un ensamble es tocar *un*
marco: los hijos no se enteran y en el mundo giran con él.

### Por qué matrices y no Euler

El marco es una matriz de rotación 3×3 y una traslación. Componer Eulers acumula error y
los cuartos de vuelta dejan de ser exactos (`cos(π/2)` da `6e-17`, no `0`). Con matriz,
cada composición se **asienta**: lo que queda a menos de `1e-9` de `-1`, `0` o `1` se clava
ahí. Así girar 90° cuatro veces vuelve *exactamente* al principio, y una pieza girada un
cuarto de vuelta tiene una caja en el mundo con números limpios — que es lo que necesitan
el imán, las fijaciones y los cortes para ser exactos.

`fromEuler` / `toEuler` hacen de puente con lo que guarda el giro como Euler XYZ (como
`THREE.Euler 'XYZ'`). Hay una prueba que verifica que `fromEuler` gira igual que esa
convención, escrita a mano aparte del SDK.

## Las capas

```
UI                      botones, gestos, paneles            ─┐
API (SDK)               Piece, Assembly, Point3d, Transform… │ cada capa usa
Modelo + geometría      el "kernel" nuestro: puro, sin three ─┘ solo la de abajo

Adaptador de three     escucha al modelo y dibuja. No decide nada. (adapters/three/)
```

La API copia la **forma y los nombres** de RhinoCommon, no su kernel: el kernel de Rhino
(booleanas, recortes, NURBS) no se escribe acá. La única pieza de kernel que se usa de
verdad son las booleanas, y se toma prestada de `three-bvh-csg`. three no está debajo del
modelo: lo mira desde el costado.

## El contrato: cómo se escribe una geometría

Toda clase de geometría sigue un contrato fijo (un solo verbo de colocación, consultas de
solo lectura, `help()` verificado por test, sin three ni DOM en el núcleo) que las pruebas
hacen cumplir. Está escrito completo, junto con el criterio de qué entra a este SDK y qué
queda en la app que lo vendoriza, en [`CONTRIBUTING.md`](CONTRIBUTING.md).

Dos clases de cosas, como en Rhino:

- **Valores** (`Point3d`, `Vector3d`, `Line`, `BoundingBox`, `Face`, `Transform`):
  inmutables, sin identidad. `transform(t)` devuelve uno nuevo.
- **Partes del documento** (`Piece`, `Assembly`): tienen id y viven en el modelo.
  `transform(t)` las mueve y devuelve la misma.

## El ensamble

Un ensamble es **un conjunto de partes con una colocación propia**. No tiene geometría:
todo lo que se le pregunta (vértices, caja, caras) se calcula recorriendo sus partes. Lo
único que agrega es una transformación — es lo que en Rhino es un *Block*, no un *Group*:

- **Group**: una lista sin origen. Transformarla aplica el giro a cada miembro.
- **Block**: lista + una transformación. Transformarlo cambia esa transformación.

Las dos dan lo mismo en el mundo. La diferencia aparece al repetir y editar una vez (los
cuatro cajones), al tener un origen propio (la puerta gira sobre su bisagra) y en que lo
de adentro sigue valiendo cuando el conjunto se mueve.

Y para una selección suelta que no tiene que persistir, alcanza con un array:
`Transform.apply(t, [a, b, c])`.

## Unidades y tolerancias

El SDK no sabe de centímetros: una medida es un número en la **unidad del documento**, que se
elige al crearlo y viaja con él al guardarlo.

```js
const a = createWorkshop();                       // cm, si no se dice otra
const b = createWorkshop({ units: 'mm' });        // 'mm' | 'cm' | 'm' | 'in' | 'ft'
b.units;                                          // 'mm'
b.tolerances;                                     // { touch: 2, penetration: 1.5 }, en mm
createWorkshop({ units: 'in' }).tolerances;       // { touch: 0.0625, penetration: 0.046875 }, en pulgadas
```

- **Cada unidad pertenece a un sistema** (`mm`, `cm`, `m`: métrico; `in`, `ft`: imperial), y de él
  salen los valores sugeridos.
- **Los valores sugeridos viven en [`src/config.js`](src/config.js)**, y solo ahí (una prueba lo hace
  cumplir). Están escritos en la unidad natural de cada sistema —2 mm y 1,5 mm; 1/16 in y 3/64 in—
  y se llevan a la unidad del documento, así que la misma escena física da las mismas respuestas
  en mm, en cm, en m o en pulgadas. Para otro criterio se cambia ese archivo, o se pisa desde
  afuera con `createWorkshop({ tolerances: { touch, penetration } })`.
- **Un documento guardado trae su unidad.** Al cargarlo (`load`), la del documento manda; uno
  guardado antes de que se guardara la unidad era de cm, que era lo único que había.
- **No hay conversión automática del contenido:** cambiar la unidad de un documento que ya tiene
  piezas no es cambiar un campo, es reescalar sus números. `convertLength(valor, de, a)` está para
  hacerlo a mano.
- Las ayudas visuales del adaptador de three (ejes, tubos de contacto, etiquetas) se escalan con la
  unidad.

## Instancias y matrices

Una **instancia** es la misma pieza o el mismo ensamble colocado otra vez. Es lo que en Rhino
es un *Block* (y no una copia): guarda solo de quién es copia y su marco, y todo lo demás —
medidas, forma, material, lo de adentro de un ensamble — se lee de la fuente cada vez. Editar
la fuente cambia todas sus instancias, sin hacer nada más.

```js
const modulo = taller.assemble([base, tapa, lateral1, lateral2], { name: 'Módulo' });
const copias = taller.array(modulo, { type: 'linear', count: 4, direction: [0, 1, 0], distance: 120 });
tapa.resize([60, 2, 18]);       // cambian los cuatro
copias[0].source;               // el módulo
modulo.instances;               // las tres copias
copias[0].detach();             // ya no sigue a la fuente: pasa a ser un ensamble de verdad
```

- **`duplicate()`** da una copia independiente; **`taller.instantiate(parte)`** da una que sigue
  a la original. Las dos tienen sentido: una es "hacé otro igual", la otra "es el mismo".
- **Lo de adentro de una instancia se lee, no se cambia por separado.** Sus piezas aparecen en
  `vertices`, `pieces` y `taller.contacts()` como piezas de verdad, con un id de camino
  (`I-1/P-2`: la pieza `P-2` de la fuente, tal como queda dentro de `I-1`). Moverlas o
  cambiarlas por separado falla con un mensaje que dice a qué instancia pertenecen: se cambia
  la fuente, o se suelta la instancia.
- **`detach()` conserva el id** (la app guarda ids) y el lugar. Lo de adentro pasa a ser partes
  nuevas, con su propio id.
- **No se borra ni se deshace la fuente de una instancia**: antes se suelta o se borra la
  instancia, y el error dice cuáles son.
- **Duplicar un conjunto que tiene una fuente y sus instancias** (un ensamble con un módulo y tres
  copias) da un conjunto que se basta a sí mismo: las copias siguen al módulo copiado, no al de
  afuera.
- Un documento guardado con instancias lo lee esta versión y las siguientes (`version: 2`); uno
  guardado antes se carga igual.

### Matrices

`taller.array(parte, spec)` repite una parte creando instancias, y `arrayTransforms(spec)` es
la misma cuenta sin tocar el documento (devuelve las transformaciones, en el mundo). `count`
cuenta a la original: con `count: 4` se crean tres instancias.

| `type` | qué hace |
|---|---|
| `'linear'` | en una dirección: `{ count, direction, distance, fit? }` |
| `'area'` | en dos: `{ count, count2, direction, direction2, distance, distance2, fit? }` |
| `'polar'` | alrededor de un eje: `{ count, axis?, center?, angle?, fit?, orient? }` |

- **`fit: 'span'`** (por defecto): `distance` es el largo total, de la primera a la última, y
  el paso se reparte. **`fit: 'step'`**: `distance` es la separación entre dos consecutivas, y
  sumar copias alarga la fila. Qué manda, la medida total o el paso, lo decide quien llama.
- **Polar:** un barrido de 360° no repite la primera copia (4 copias = cada 90°, no cada 120°);
  uno menor incluye las dos puntas. Con `fit: 'step'`, `angle` es lo que gira cada paso.
  `orient: true` (por defecto) gira cada copia con el barrido; `orient: false` la deja paralela
  a la original y solo cambia de lugar.
- Las matrices **crean** instancias y listo: no queda un objeto "matriz" que se re-evalúe. Si la
  cantidad depende de otra cosa (un volumen que se estira), quien llama vuelve a calcularla.

## La API

```js
import { createWorkshop, Point3d, Transform } from './src/sdk/index.js';
const taller = createWorkshop();

const cubo = taller.addPiece({ name: 'Larguero', size: [200, 4, 10], center: [0, 2, 0] });
cubo.vertices[0].x;                       // se lee
cubo.move(cubo.vertices[0], new Point3d(0, 0, 0));   // de un punto a otro
cubo.rotate(90, cubo.directions.length);  // sobre su propio largo
const e = taller.assemble([cubo, otro], { name: 'Marco' });
e.duplicate().move([0, 0, 80]);
```

Las medidas son números en la unidad del documento (ver [Unidades y tolerancias](#unidades-y-tolerancias)); los ángulos, en grados. Lo completo de cada clase está en su `help()`, que es la
fuente de verdad (y está verificada): `taller.help()`, `Piece.help()`, `Assembly.help()`,
`Point3d.help()`, `Vector3d.help()`, `Line.help()`, `BoundingBox.help()`, `Face.help()`,
`Transform.help()`.

### Contacto e intersección

Tres preguntas distintas, porque en un ensamble son tres cosas distintas:

| | |
|---|---|
| `a.touches(b)` | ¿se tocan sin meterse? Ahí va cola, un tornillo, un tarugo |
| `a.intersects(b)` | ¿se meten una en otra? Un choque: hay que recortar o mover |
| `a.contactsWith(b)` | dónde se tocan: `Contact` de cara (el polígono donde se solapan, con su área), de arista o de punto |
| `a.intersectionsWith(b)` | lo que comparten: `Intersection` con su sólido, su volumen y cuánto se meten |
| `taller.contacts()` · `taller.collisions()` | todos, en el documento |
| `e.contactsWith(e)` | un ensamble contra sí mismo: sus uniones internas |

Se tocan si están a `taller.tolerances.touch` o menos, y chocan si se meten más de
`taller.tolerances.penetration`. Esos valores no están escritos en el código: salen de
[`src/config.js`](src/config.js), según la unidad del documento (ver más abajo). Se pueden pisar
para una pregunta (`a.touches(b, { tolerance: 0.05 })`, en la unidad del documento) o para todo el
taller (`createWorkshop({ tolerances: { touch: 0.05 } })`).

Funciona con piezas giradas como estén: son cajas orientadas, no alineadas al mundo (que
para una pieza girada son más grandes que la pieza). El teorema de los ejes separadores (los
15 ejes) dice si chocan y cuánto, y el recorte de polígonos dice dónde.

El adaptador de three, con `vista.show.contacts(true)`, pinta de verde donde se tocan y de rojo
donde se meten. La demo (`examples/demo.js`) tiene un choque que nadie había visto cuando se
escribió: la diagonal de 80 no entra entre los largueros y se mete 2,1 en cada uno.

### Por qué la pieza se llama `Piece` y no `Box`

En Rhino `Box` es una caja. Una pieza puede ser un perfil, una pata torneada o algo cortado
en el CAD: no es una caja. Lo que sí es, por ahora, es lo que se *consulta* de ella (ver
"Lo que todavía no está").

## Cómo se agrega algo

La regla: **una feature entra primero al modelo y después a la API**, y antes de escribir
nada, el criterio de qué es agnóstico (ver `CONTRIBUTING.md`). El flujo completo, la
política de compatibilidad hacia atrás y el proceso de release están en
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Lo que todavía no está

Dicho para que nadie lo dé por hecho:

- **La geometría consultable de una pieza es su caja.** La forma (perfil, torneado, corte del
  CAD) viaja en la definición y el visor la dibuja con el mismo constructor que el taller,
  pero `vertices`, `edges` y `faces` devuelven los de la caja. Los de la forma real van
  después, también en el marco local.
- **Transformaciones rígidas solamente.** Escalar una pieza es cambiarle las medidas
  (`resize`), no una transformación; espejar va a necesitar saber de qué mano es cada
  forma. Las dos llegan como constructores nuevos de `Transform` cuando hagan falta.
- **El contacto se calcula con la caja de la pieza.** Para una tabla es exacto; para una pata
  torneada o un caño, es el contacto de su caja. Cuando las piezas tengan su geometría real,
  el contacto la va a usar.
- **No hay fijaciones, juntas de movimiento, vínculos ni recortes.** Son relaciones
  entre partes, y cada una va a entrar siguiendo la regla de arriba.
- **No hay deshacer.**

## Licencia

[MIT](LICENSE) © 2026 EasyIndustry.
