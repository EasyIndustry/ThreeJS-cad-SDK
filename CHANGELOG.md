# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versiones
según [SemVer](https://semver.org): mientras sea `0.x`, una versión menor puede romper algo,
y si rompe queda dicho arriba de todo en esa entrada (ver `CONTRIBUTING.md`).

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

[0.2.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/EasyIndustry/ThreeJS-cad-SDK/releases/tag/v0.1.0
