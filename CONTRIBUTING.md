# Contribuir

Este SDK se vendoriza en varias apps. Lo que entra acá lo van a copiar todas, así que la
pregunta antes de cada cambio no es "¿le sirve a la app que lo pidió?" sino "¿le sirve a
cualquier CAD de piezas rígidas?".

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
2. Expuesta en `src/index.js` o `src/geometry.js`, con su línea en la tabla de `help()`.
3. Si se dibuja distinto, en `adapters/three/viewer.js` — que no decide nada: espeja, y no
   conoce materiales ni catálogos de ninguna app (ver "Agnóstico" arriba).

El tipado se verifica con `npm run typecheck`, en modo estricto. Los tipos van en JSDoc: los
archivos siguen siendo `.js` y no hay paso de build.

Nada de `src/` importa three, el DOM ni algo de afuera de `src/`, y hay una prueba que lo
frena si eso cambia: el núcleo lo puede usar un servidor.

## Compatibilidad hacia atrás (mientras sea 0.x)

- La API puede cambiar entre versiones menores. Lo que cuenta como **cambio que rompe algo**:
  - cambiar o quitar la firma de un método o propiedad pública;
  - cambiar un valor por defecto que afecta el resultado (una tolerancia, un default de
    `material`, el color que sale si no se pasa `materialFor`);
  - quitar o renombrar una entrada de `help()`;
  - cambiar el formato de `toJSON()` sin una migración.
- Lo que **no** cuenta como breaking: agregar un método, agregar una propiedad opcional a un
  `spec`, mejorar el rendimiento sin cambiar el resultado.
- Todo cambio que rompa algo queda **dicho arriba de todo** en la entrada de ese release en
  `CHANGELOG.md` — es lo que alguien vendorizando necesita leer antes de traer una versión
  nueva a su app.

## Release

1. Bump de versión en `package.json` (semver).
2. Entrada nueva en `CHANGELOG.md`, con lo que rompe (si rompe algo) en la primera línea.
3. Tag `vX.Y.Z` sobre el commit del release.
4. `git push origin <rama>` y `git push origin vX.Y.Z`.
