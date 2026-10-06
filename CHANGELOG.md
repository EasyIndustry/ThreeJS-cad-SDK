# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versiones
según [SemVer](https://semver.org): mientras sea `0.x`, una versión menor puede romper algo,
y si rompe queda dicho arriba de todo en esa entrada (ver `CONTRIBUTING.md`).

## [0.4.0] - 2026-10-06

Responde a [#3](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/3): instanciar una
parte, y matrices de piezas y de ensambles.

### Changed

- `toJSON()` escribe `version: 2` (puede traer partes `kind: 'instance'`). `load()` sigue
  leyendo documentos de la versión 1 sin cambios. Un documento con instancias no lo lee una
  versión anterior del SDK.
- `taller.contacts()` y `taller.collisions()` incluyen las piezas de adentro de las
  instancias (con id de camino, `I-1/P-2`). Sin instancias en el documento, dan lo mismo
  que antes.
- El adaptador de three dibuja las piezas de adentro de las instancias; sus mallas llevan el
  id de camino en `userData.id`.

### Added

- `taller.instantiate(parte, { name?, parent?, placement? })`: la misma pieza o el mismo
  ensamble colocado otra vez. Editar la fuente (medidas, forma, material, lo de adentro) cambia
  todas sus instancias.
- `parte.source` (de quién es copia, o null), `parte.instances` y `parte.detach()` (soltar:
  pasa a ser una parte de verdad, con el mismo id).
- `taller.array(parte, spec)` y `arrayTransforms(spec)`: matrices lineal, en área y polar
  (`fit: 'span' | 'step'`, `orient`). `count` cuenta a la original.
- Borrar o deshacer (`explode`) la fuente de una instancia falla con un error que dice qué
  instancias la usan; duplicar un conjunto con una fuente y sus instancias remapea las
  instancias a la fuente copiada.
- `load()` rechaza, sin dejar nada a medias, un documento con una instancia sin fuente o con
  un conjunto que se contiene a sí mismo.

Nada rompe una llamada existente: `duplicate()` sigue dando una copia independiente.

## [0.3.0] - 2026-10-06

Responde a [#2](https://github.com/EasyIndustry/ThreeJS-cad-SDK/issues/2): crear piezas
ya orientadas, para importar diseños existentes.

### Added

- `Transform.fromEuler(radians)`: el giro de un Euler XYZ en radianes (`Rx · Ry · Rz`), la
  misma convención que usa three.js para `Euler('XYZ')`. Sin traslación.
- `addPiece({ ..., placement, axes })`: `placement` (un `Transform`) orienta la pieza al
  crearla, en vez de crearla derecha y girarla después; `axes` fuerza cuál eje local es el
  largo, el ancho y el espesor (por tamaño si no se da). `axes` inválidos (que no sean 0,
  1, 2 sin repetir) tiran un error claro.

Nada de esto rompe una llamada existente: los dos campos son opcionales y el
comportamiento sin ellos es el mismo que antes.

## [0.2.0] - 2026-10-06

### Breaking

- El adaptador de three (`adapters/three/viewer.js`) ya no trae una tabla de colores por
  especie de madera. Si no se pasa `materialFor`, todas las piezas salen de un gris neutro
  (`#9a9a92`) en vez de variar por `material`. Cualquier app que dependía del color por
  defecto tiene que pasar su propio `materialFor` ahora.
- `addPiece` sin `material` ya no asume `'pino'`: el default es `'default'`. Una app que
  lee `pieza.material` esperando `'pino'` por defecto tiene que pasarlo explícito.

### Removed

- `lab/index.html`: la consola de prueba manual. Tenía nombre y tema de "Taller de
  carpintería", específico de una app, y nunca se vendorizaba (ya estaba fuera de `files`
  en `package.json`). El testeo visual manual queda del lado de cada app que vendoriza el
  SDK, con su propia escena.

### Added

- `CONTRIBUTING.md`: el contrato de geometría, el flujo para agregar una feature, el
  criterio de qué es agnóstico y la política de compatibilidad hacia atrás, movidos del
  README y ampliados.
- `CHANGELOG.md` (este archivo).

## [0.1.0] - 2026-10-06

Primera versión. El núcleo puro (documento, partes, marcos, geometría, contacto e
intersección, con `help()` verificado por test) y el adaptador de three que espeja el
modelo en una escena.

[0.4.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/releases/tag/v0.1.0
