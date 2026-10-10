# Política del repositorio

Este repo es un **módulo vendorizable** y **open source** (MIT): varias apps lo copian tal cual
y cualquiera puede usarlo, pedir cambios o contribuir. Esta política dice qué entra y cómo se
decide. Vale igual para un pedido de afuera y para uno de una app de casa: el que pide no
cambia la respuesta.

Todo es común a los módulos vendorizables salvo la última sección, **En este repo**, que es lo
único que cambia de un repo a otro.

## El principio

**No hacemos cambios con una utilidad específica: hacemos una herramienta específica para un
abanico de posibilidades.**

Un pedido nace casi siempre de una app concreta, y está bien que sea así. Pero lo que entra al
módulo no es la solución de esa app sino la herramienta que resuelve esa clase de problema para
cualquier app. Si no se puede generalizar, queda en la app.

## El filtro

Cada pedido (issue o PR) pasa por estas preguntas, en orden. La primera que corta decide.

1. **¿Qué problema resuelve?** El pedido se lee por la necesidad, no por la solución que trae.
   "Quiero un botón de vista frontal para mis placas" es, de fondo, "vistas con nombre y
   encuadre".
2. **¿Ya se puede?** Si la app lo resuelve con la API que hay, con un valor de `config.js` o con un punto de
   extensión, no hace falta cambiar el módulo: se responde con el cómo.
3. **¿A quién más le sirve?** Tiene que servirle al menos a dos tipos de app distintos, no a dos
   pantallas de la misma. Si el único caso es el de quien lo pide, no entra tal cual.
4. **¿Se puede generalizar?** Si la necesidad de fondo es general aunque el pedido no lo sea, se
   reescribe como herramienta general y entra así.
5. **¿Respeta el contrato del repo?** El de **En este repo**: forma de la API, módulos puros,
   dependencias, compatibilidad.

Ante la duda, se prefiere **un punto de extensión a una función nueva**: una marca que el módulo
respeta, una opción, un aviso (`on…`), un preset. Le deja a la app hacer lo suyo sin que lo suyo
entre al módulo.

## Qué puede pasar con un pedido

Cada pedido nuevo entra con la etiqueta `triage` y sale con una de estas:

| Etiqueta | Qué quiere decir | Qué pasa |
|---|---|---|
| `aceptado` | pasa el filtro tal cual | queda abierto hasta que se implementa |
| `generalizar` | la necesidad sirve, el pedido es muy puntual | se reescribe en el issue como herramienta general; con eso pasa a `aceptado` |
| `sin-cambios` | ya se puede con lo que hay | se cierra con el cómo (API, preset o extensión) |
| `fuera-de-alcance` | es de la app, no del SDK | se cierra con por qué y dónde resolverlo |

Ningún pedido se cierra sin una explicación. Un "no" dice siempre por qué y qué hacer en cambio.

Aparte, `error` marca lo que el módulo promete y no cumple. Un error no pasa por el filtro, salvo
que sea un pedido disfrazado: si "no anda" quiere decir "no hace lo que mi app necesita", es un
pedido.

Las etiquetas están en `.github/labels.json` y se crean solas en GitHub (`.github/workflows/labels.yml`).

## Vendorizar

- Se copia el módulo **tal cual**, en una versión publicada.
- **La copia no se edita.** Si una app necesita un cambio, vuelve acá como issue y pasa por el
  filtro. Una copia con parches propios deja de poder actualizarse.
- Lo que la app agrega va en la app, usando la API y los puntos de extensión.

## Versiones y compatibilidad

- [Semver](https://semver.org/lang/es/). Mientras sea 0.x, una versión menor puede romper; un
  parche nunca.
- Toda ruptura va en el `CHANGELOG.md` marcada **Ruptura**, con qué cambia y cómo migrar.
- Cuando se puede, lo viejo sigue andando una versión más, con un aviso en la consola.

## Dependencias

- Ninguna dependencia propia sin justificarla en el issue: cada una es una dependencia más para
  cada app que vendoriza el módulo.
- Las pesadas se cargan a pedido, para que una app que no las usa no las necesite.

## Open source

- Licencia MIT ([`LICENSE`](LICENSE)). Lo que se contribuye entra bajo la misma licencia.
- Convivencia: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Problemas de seguridad: [`SECURITY.md`](SECURITY.md), en privado.
- Cómo se contribuye: [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Idioma:** el repo está en castellano (código, documentación, issues). Un issue en otro idioma
  se acepta y se responde.

## En este repo

**threejs-cad-sdk:** qué forma tiene cada pieza y cómo se relaciona con las otras.

**La pregunta:** ¿le sirve a cualquier CAD de piezas rígidas?

- **Entra:** geometría, marcos, composición, contacto e intersección, y las relaciones entre
  partes que cualquier CAD necesita (uniones, juntas, vínculos, instancias), más lo que hace
  cómodo armar y editar (imán, agarre, estirar, despiece) con valores planos.
- **No entra:** nombres propios de una app, catálogos (materiales, herrajes, perfiles
  comerciales), precios, textos de interfaz, ni un método pensado para una sola tarea. Tampoco
  three en el núcleo: lo único que lo importa es el adaptador, y no decide nada.
- **Un cliente es una configuración**, no código: un default que asume el vocabulario de una sola
  industria (un color por especie de madera) es tan específico como un método con su nombre.
- **Puntos de extensión que ya hay:** `createWorkshop({ sections, kernel, tolerances })`,
  `geometryFor` y `materialFor` del adaptador, y los valores de `src/config.js`.
- **Una feature entra primero al modelo y después a la API**, con su prueba en Node y su línea en
  `help()`.
- **El contrato** (el técnico, con sus pruebas) está en [`CONTRIBUTING.md`](CONTRIBUTING.md).
