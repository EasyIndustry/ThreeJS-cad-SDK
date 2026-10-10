# Contribuir

Este SDK se vendoriza en varias apps. Lo que entra acá lo van a copiar todas, así que la
pregunta antes de cada cambio no es "¿le sirve a la app que lo pidió?" sino "¿le sirve a
cualquier CAD de piezas rígidas?".

**Primero, [`POLITICA.md`](POLITICA.md):** qué entra, cómo se evalúa un pedido y qué puede pasar
con él. Un pedido de una app de casa pasa por el mismo filtro que uno de afuera. Un pedido es un
issue con la plantilla *Pedido*; un error, con la plantilla *Error*; un PR, mejor después de un
issue `aceptado`.

## Agnóstico: qué entra y qué no

- **Entra:** geometría, marcos, composición, contacto e intersección, y las relaciones entre
  partes que cualquier CAD necesita (uniones, juntas, vínculos, instancias).
- **No entra:** nombres propios de una app, catálogos (materiales, herrajes, perfiles
  comerciales), precios, textos de interfaz, ni un método pensado para una sola tarea.
- Un pedido real casi siempre nace de una app concreta (ver los issues). Eso está bien — es
  la mejor fuente de requisitos — pero la forma que toma acá tiene que poder pensarse sin
  saber de dónde salió el pedido. Si un nombre, un default o una lista de valores posibles
  solo tiene sentido para quien lo pidió, es una señal de que hay que generalizarlo o de que
  no es de este repo.
- **Los números que dependen de la unidad o del oficio van en `src/config.js`**, y solo ahí: ni
  una tolerancia ni un valor "sugerido" se escribe a mano en el resto de `src/` (una prueba lo
  hace cumplir). Un valor nuevo de ese tipo entra a `config.js`, en la unidad natural de cada
  sistema, y se lleva a la unidad del documento con `convertLength`.
- Un default también es superficie de API: un valor por defecto que asume el vocabulario de
  una sola industria (un color por tipo de madera, un material por defecto que es una
  especie de madera) es tan específico de una app como un método con su nombre.

## El contrato: cómo se escribe una geometría

Toda clase de geometría cumple esto, y las pruebas lo hacen cumplir:

1. **Un solo verbo cambia la colocación: `transform(t)`.** Mover y girar son constructores
   de `Transform` (`Transform.translation`, `Transform.rotation`) más un atajo en la
   instancia (`move`, `rotate`). Por eso cualquier geometría sabe moverse igual.
2. **La definición se cambia por métodos explícitos** (`resize`, `setMaterial`, `rename`),
   nunca escribiendo sobre algo que devolvió una consulta.
3. **Las consultas son propiedades y devuelven valores de solo lectura.** `cubo.vertices`
   es un array congelado de `Point3d` congelados: `cubo.vertices[0].x` se lee, no se
   escribe. Hay una prueba que intenta escribirlos y exige que falle.
4. **Mundo por defecto, local en espejo:** `cubo.vertices` y `cubo.local.vertices`.
5. **Cada clase declara sus miembros con una línea de descripción** (`static members`), y
   de ahí salen `cubo.help()` y `Point3d.help()`. Una prueba exige que cada miembro público
   esté en la tabla y que cada entrada de la tabla exista: agregar un método sin
   documentarlo hace caer la prueba con el nombre del método.
6. **Sin three, sin DOM.** Una prueba lo frena si pasa.
7. **Nada entra sin su prueba en Node**, y recién después se expone.

## Cómo se agrega algo

La regla: **una feature entra primero al modelo y después a la API.**

1. En `src/model.js` (o un módulo de `src/`), con su prueba en `test/sdk.test.mjs`, en Node.
2. Expuesta en `src/index.js` o `src/geometry.js`, con su línea en la tabla de `help()` (lo
   que exporta el módulo, en `MODULE_MEMBERS`; lo que devuelve el adaptador, en
   `adapters/three/members.js`).
3. Si se dibuja distinto, en `adapters/three/viewer.js` — que no decide nada: espeja, y no
   conoce materiales ni catálogos de ninguna app (ver "Agnóstico" arriba).
4. `npm run docs`: regenera la referencia de la API (`docs/API.md` y `docs/index.html`) desde
   esas tablas. No se edita a mano, y una prueba falla si quedó atrás del código.

El tipado se verifica con `npm run typecheck`, en modo estricto. Los tipos van en JSDoc: los
archivos siguen siendo `.js` y no hay paso de build.

Nada de `src/` importa three, el DOM ni algo de afuera de `src/`, y hay una prueba que lo
frena si eso cambia: el núcleo lo puede usar un servidor.

## Compatibilidad hacia atrás (mientras sea 0.x)

- La API puede cambiar entre versiones menores. Lo que cuenta como **cambio que rompe algo**:
  - cambiar o quitar la firma de un método o propiedad pública;
  - cambiar un valor por defecto que afecta el resultado (un valor de `config.js`, un default de
    `material`, el color que sale si no se pasa `materialFor`);
  - quitar o renombrar una entrada de `help()`;
  - cambiar el formato de `toJSON()` sin una migración.
- Lo que **no** cuenta como breaking: agregar un método, agregar una propiedad opcional a un
  `spec`, mejorar el rendimiento sin cambiar el resultado.
- Todo cambio que rompa algo queda **dicho arriba de todo** en la entrada de ese release en
  `CHANGELOG.md` — es lo que alguien vendorizando necesita leer antes de traer una versión
  nueva a su app.

## Ramas, pre-releases y releases

- **`main`** solo tiene lo publicado: cada commit de `main` con tag `vX.Y.Z` es un release.
- **`test`** es lo que se está probando en una app antes de publicarlo. El trabajo se hace en
  ramas propias y, cuando algo está listo para probar, `test` avanza a ese commit.
- **Pre-release `vX.Y.Z-rc.N`** sobre un commit de `test`: es lo que una app vendoriza para
  probar. Cada issue que entra suma un rc (`-rc.2`, `-rc.3`…), o abre la versión siguiente.
- **Release `vX.Y.Z`** sale de `main`, cuando el último rc anduvo bien en la app.

### Publicar un pre-release

1. `package.json` dice la versión del rc (`0.6.0-rc.1`), `CHANGELOG.md` tiene su entrada
   (lo que rompe, arriba de todo) y `npm run docs` está corrido.
2. `test` apunta a ese commit.
3. ```bash
   gh release create v0.6.0-rc.1 --prerelease --target <sha completo> --title v0.6.0-rc.1 --notes-file <notas>
   ```
   `--target` necesita el SHA de 40 caracteres: con uno abreviado, GitHub contesta
   "target_commitish is invalid".

### Publicar un release

1. PR de `test` a `main`, mergeado **con merge commit o fast-forward, nunca squash**: los tags
   de los rc tienen que seguir apuntando a commits que estén en `main`.
2. En `main`, un commit de release: `package.json` pasa a `X.Y.Z` (sin `-rc.N`), la entrada
   del CHANGELOG toma la fecha del release y `npm run docs` (la referencia dice la versión).
3. `gh release create vX.Y.Z --target <sha completo del commit de release> --notes-file <notas>`.

### La referencia en GitHub Pages

`docs/` se publica con GitHub Pages desde `main` (Settings → Pages → Deploy from a branch →
`main`, carpeta `/docs`), en https://easyindustry.github.io/ThreeJS-cad-SDK/. Como sale de
`main`, muestra la API del último release, no la de lo que se está probando en `test`.

