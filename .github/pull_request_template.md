## Qué cambia y por qué

<!-- Qué problema resuelve, para qué tipo de apps. -->

Cierra #

## Política

- [ ] Viene de un issue `aceptado` (o es un error).
- [ ] Es una herramienta general, no la solución de una app ([POLITICA.md](../POLITICA.md)).
- [ ] Si alcanzaba con un punto de extensión (opción, `config.js`, `shape`, `kernel`), es eso y no una función nueva.

## Contrato

- [ ] Entró primero al modelo, con su prueba en Node, y después a la API.
- [ ] Cada miembro nuevo tiene su línea en `help()` y `npm run docs` está corrido.
- [ ] `src/` no importa three, el DOM ni nada de afuera de `src/`.
- [ ] Los números que dependen de la unidad o del oficio van en `src/config.js`.
- [ ] Ninguna dependencia nueva, o está justificada en el issue.
- [ ] Lo que andaba sigue andando, o va en el `CHANGELOG.md` como **Ruptura** con cómo migrar.
- [ ] `npm test` y `npm run typecheck` pasan.
