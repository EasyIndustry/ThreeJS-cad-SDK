// SDK del taller: la API para el que desarrolla encima. La interfaz no toca el modelo:
// llama a esto.
//
//   const taller = createWorkshop();
//   const a = taller.addPiece({ name: 'Larguero', size: [200, 4, 10] });
//   a.rotate(45, 'z');
//   a.vertices[0].x;            // en el mundo
//   a.local.vertices;           // en el marco de la pieza
//   a.dims;                     // { length: 200, width: 10, thickness: 4 } — gire como gire
//   a.help();                   // todo lo que tiene una pieza
//
// Dos clases de cosas, como en Rhino:
//   - VALORES (Point3d, Vector3d, Line, BoundingBox, Face, Transform; ver geometry.js):
//     inmutables, sin identidad.
//   - PARTES del documento (Piece, Assembly): tienen id y viven en el modelo. Lo que se
//     consulta de ellas son valores, de solo lectura; se cambian por métodos explícitos.
//
// Una parte es lo que se transforma, se duplica y se mete en un ensamble (Composite): la
// pieza es una hoja, con todo lo fabricable; el ensamble es un conjunto de partes con una
// transformación propia, y su geometría es la de sus partes. Una instancia es la misma pieza
// o el mismo ensamble colocado otra vez: se ve y se consulta como lo que copia (`source` dice
// de quién es copia), y editar la fuente la cambia a ella también.
//
// Una feature nueva entra primero al modelo (model.js), con su prueba en Node, y recién
// después se expone acá — con su línea en la tabla de help(), que una prueba exige.
import { Model } from './model.js';
import { Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection, vec3 } from './geometry.js';
import { obbOf, satDepth, intersectBoxes, contactsOf, candidatePairs } from './contact.js';
import { arrayTransforms } from './array.js';
import { UNITS, convertLength } from './units.js';
import { TOLERANCE_PRESETS, tolerancesFor } from './config.js';
import { help } from './help.js';

export { Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection, arrayTransforms, UNITS, convertLength, TOLERANCE_PRESETS, tolerancesFor };

/** @typedef {import('./model.js').Space} Space */
/** @typedef {import('./geometry.js').PointLike} PointLike */
/** @typedef {import('./geometry.js').VectorLike} VectorLike */
/** @typedef {import('./geometry.js').AxisLike} AxisLike */
/** @typedef {import('./help.js').Member} Member */
/** @typedef {import('./array.js').ArraySpec} ArraySpec */
/** @typedef {import('./units.js').Unit} Unit */
/** @typedef {import('./config.js').Tolerances} Tolerances */

/** @typedef {{ model: Model, part: (id: string) => Part, forget: (ids: string[]) => void, tolerances: () => Readonly<Tolerances> }} Ctx */
/** El documento al que pertenece cada parte, sin colgárselo a la parte a la vista. @type {WeakMap<Part, Ctx>} */
const ctxOf = new WeakMap();
/** @param {Part} p */
const ctx = (p) => /** @type {Ctx} */ (ctxOf.get(p));
const AXES = /** @type {const} */ (['x', 'y', 'z']);

const AX_NAME = /** @type {const} */ (['x', 'y', 'z']);
/** @param {{ axis: 0 | 1 | 2, side: 1 | -1 } | null} f */
const caraLocal = (f) => (f ? { localAxis: AX_NAME[f.axis], localSide: f.side } : null);
/** @param {Model} m @param {string} id */
const piezasDe = (m, id) => m.piecesOf(id).map((p) => p.id);

/**
 * Los contactos entre las piezas de dos grupos (cada par una vez). Un par que se mete uno
 * en otro (más de `pen`) no cuenta como contacto: eso es una intersección.
 * @param {Model} m @param {string[]} as @param {string[]} bs @param {number} tol @param {number} pen
 */
function contactos(m, as, bs, tol, pen) {
  /** @type {Contact[]} */
  const out = [];
  for (const [x, y] of candidatePairs(m, as, bs, tol)) {
    const A = obbOf(m, x), B = obbOf(m, y);
    const depth = satDepth(A, B);
    if (depth < -tol || depth > pen) continue;
    for (const c of contactsOf(A, B, tol)) {
      out.push(new Contact({ kind: c.kind, a: x, b: y, points: c.points, area: c.area, normal: c.normal, faceA: caraLocal(c.faceA), faceB: caraLocal(c.faceB) }));
    }
  }
  return Object.freeze(out);
}

/** Las intersecciones entre las piezas de dos grupos. @param {Model} m @param {string[]} as @param {string[]} bs @param {number} tol */
function intersecciones(m, as, bs, tol) {
  /** @type {Intersection[]} */
  const out = [];
  for (const [x, y] of candidatePairs(m, as, bs, 0)) {
    const A = obbOf(m, x), B = obbOf(m, y);
    const depth = satDepth(A, B);
    if (depth <= tol) continue;
    const r = intersectBoxes(A, B);
    if (r) out.push(new Intersection({ a: x, b: y, volume: r.volume, depth, vertices: r.vertices, faces: r.faces }));
  }
  return Object.freeze(out);
}

/** @param {unknown} x @returns {string} */
const idDe = (x) => {
  if (typeof x === 'string') return x;
  if (x instanceof Part) return x.id;
  throw new TypeError('va otra parte (o su id)');
};

/**
 * Lo que tiene toda parte: identidad, colocación, geometría consultable y los verbos.
 * No se construye a mano: sale de `taller.addPiece`, `taller.assemble` o `taller.part(id)`.
 */
export class Part {
  /** @param {Ctx} c @param {string} id */
  constructor(c, id) {
    ctxOf.set(this, c);
    /** @readonly */ this.id = id;
    Object.freeze(this);
  }

  get kind() { return ctx(this).model.get(this.id).kind; }
  get name() { return ctx(this).model.get(this.id).name; }
  /** El ensamble que la contiene, o null. @returns {Part | null} */
  get parent() { const p = ctx(this).model.get(this.id).parent; return p ? ctx(this).part(p) : null; }
  /**
   * De qué parte es copia: la fuente, si es una instancia, o la parte que copia, si es de
   * adentro de una. Null si es una original.
   * @returns {Part | null}
   */
  get source() { const s = ctx(this).model.get(this.id).source; return s ? ctx(this).part(s) : null; }
  /** Las instancias que se colocaron de esta parte. @returns {readonly Part[]} */
  get instances() { return Object.freeze(ctx(this).model.instancesOf(this.id).map((i) => ctx(this).part(i))); }
  /** Su colocación en el mundo: el Transform que lleva de su marco local al mundo. */
  get placement() { return new Transform(ctx(this).model.worldFrame(this.id)); }
  /** Sus ejes locales x, y, z, vistos desde el mundo. */
  get axes() {
    const r = ctx(this).model.worldFrame(this.id).r;
    return Object.freeze({ x: new Vector3d(r[0], r[3], r[6]), y: new Vector3d(r[1], r[4], r[7]), z: new Vector3d(r[2], r[5], r[8]) });
  }

  // ---------- geometría, en el mundo ----------
  get vertices() { return this.#vertices('world'); }
  get edges() { return this.#edges('world'); }
  get faces() { return this.#faces('world'); }
  get boundingBox() { return this.#box('world'); }
  /** La misma geometría, en el marco local de la parte. */
  get local() {
    const self = this;
    return Object.freeze({
      get vertices() { return self.#vertices('local'); },
      get edges() { return self.#edges('local'); },
      get faces() { return self.#faces('local'); },
      get boundingBox() { return self.#box('local'); },
    });
  }

  /** @param {Space} s */
  #vertices(s) { return Object.freeze(ctx(this).model.positions(this.id, s).map((v) => new Point3d(...v))); }
  /** @param {Space} s */
  #edges(s) { return Object.freeze(ctx(this).model.edges(this.id, s).map(([a, b]) => new Line(a, b))); }
  /** @param {Space} s */
  #faces(s) {
    return Object.freeze(ctx(this).model.faces(this.id, s).map((f) => new Face({
      piece: f.piece, localAxis: AXES[f.axis], localSide: f.side, normal: f.normal, center: f.center, vertices: f.corners,
    })));
  }
  /** @param {Space} s */
  #box(s) { const b = ctx(this).model.box(this.id, s); return new BoundingBox(b.min, b.max); }

  // ---------- verbos: todos son una transformación ----------

  /** El verbo del que salen los demás. Solo cambia la colocación. @param {Transform} t */
  transform(t) { ctx(this).model.transform(this.id, Transform.check(t).frame); return this; }
  /**
   * Trasladar: por un vector, o de un punto a otro (como mover de a dos clics).
   * @param {VectorLike | PointLike} a @param {PointLike} [b]
   */
  move(a, b) { return this.transform(Transform.translation(a, b)); }
  /**
   * Girar en grados. El eje es 'x' | 'y' | 'z' del mundo o un vector (p. ej. una dirección
   * propia: `pieza.directions.length`). Gira por el centro de su caja si no se dice otro.
   * @param {number} degrees @param {AxisLike} [axis] @param {PointLike} [center]
   */
  rotate(degrees, axis = 'z', center) {
    return this.transform(Transform.rotation(degrees, axis, center ?? this.boundingBox.center));
  }
  /** Copia exacta en el mismo lugar, con todo lo que tiene adentro. @returns {Part} */
  duplicate() { return ctx(this).part(ctx(this).model.duplicate(this.id)); }
  /**
   * Suelta una instancia: pasa a ser una parte de verdad, copia de lo que era su fuente, que
   * ya no la sigue. Conserva su id y su lugar.
   */
  detach() {
    const c = ctx(this);
    const antes = c.model.subtree(this.id);
    c.model.detach(this.id);
    c.forget(antes.filter((id) => id !== this.id));
    return this;
  }
  /** @param {string} name */
  rename(name) { ctx(this).model.rename(this.id, name); return this; }
  /** La borra del documento, con todo lo que cuelga de ella. */
  remove() {
    const c = ctx(this);
    const ids = c.model.subtree(this.id);
    c.model.remove(this.id);
    c.forget(ids);
  }
  // ---------- contacto con otras partes ----------
  // Entre las piezas de esta parte y las de la otra. Una parte contra sí misma da lo que
  // pasa adentro: e.contactsWith(e) son las uniones entre las piezas de un ensamble.

  // `tolerance`, si se pasa, va en la unidad del documento; si no, la del taller (`taller.tolerances`).

  /** ¿Se toca con la otra (a `tolerance` o menos), sin meterse? @param {Part | string} other @param {{ tolerance?: number }} [opts] */
  touches(other, { tolerance } = {}) { return this.contactsWith(other, { tolerance }).length > 0; }
  /** ¿Se mete en la otra más de `tolerance`? @param {Part | string} other @param {{ tolerance?: number }} [opts] */
  intersects(other, { tolerance } = {}) { return this.intersectionsWith(other, { tolerance }).length > 0; }
  /** Dónde se toca con la otra. @param {Part | string} other @param {{ tolerance?: number }} [opts] */
  contactsWith(other, { tolerance } = {}) {
    const { model: m, tolerances } = ctx(this);
    const t = tolerances();
    return contactos(m, piezasDe(m, this.id), piezasDe(m, idDe(other)), tolerance ?? t.touch, t.penetration);
  }
  /** Lo que comparte de volumen con la otra. @param {Part | string} other @param {{ tolerance?: number }} [opts] */
  intersectionsWith(other, { tolerance } = {}) {
    const { model: m, tolerances } = ctx(this);
    return intersecciones(m, piezasDe(m, this.id), piezasDe(m, idDe(other)), tolerance ?? tolerances().penetration);
  }

  toString() { return `${this.kind === 'piece' ? 'Piece' : 'Assembly'} ${this.id} «${this.name}»`; }

  /** @type {Member[]} */
  static members = [
    ['id', 'su identificador (P-1, E-1…)'],
    ['kind', "'piece' o 'assembly'"],
    ['name', 'su nombre'],
    ['parent', 'el ensamble que la contiene, o null'],
    ['source', 'de quién es copia, si es una instancia (o de adentro de una); si no, null'],
    ['instances', 'las instancias que se colocaron de ella'],
    ['placement', 'su colocación en el mundo (Transform)'],
    ['axes', 'sus ejes locales x, y, z vistos desde el mundo (Vector3d)'],
    ['vertices', 'sus vértices en el mundo (Point3d). vertices[0].x se lee, no se escribe'],
    ['edges', 'sus aristas en el mundo (Line)'],
    ['faces', 'sus caras en el mundo (Face)'],
    ['boundingBox', 'la caja que la encierra, alineada al mundo'],
    ['local', 'lo mismo en su propio marco: local.vertices, local.edges, local.faces, local.boundingBox'],
    ['transform(t)', 'aplicarle un Transform: el verbo del que salen los demás'],
    ['move(v) / move(from, to)', 'trasladar por un vector, o de un punto a otro'],
    ["rotate(degrees, axis?, center?)", "girar en grados; eje 'x' | 'y' | 'z' o un vector; por el centro de su caja"],
    ['duplicate()', 'copia exacta en el mismo lugar, con todo lo de adentro (independiente: no sigue a la original)'],
    ['detach()', 'soltar una instancia: pasa a ser una parte de verdad, que ya no sigue a su fuente'],
    ['rename(name)', 'cambiarle el nombre'],
    ['remove()', 'borrarla, con todo lo que cuelga de ella'],
    ['touches(other, { tolerance? })', '¿se toca con la otra sin meterse? (a tolerances.touch o menos)'],
    ['intersects(other, { tolerance? })', '¿se mete en la otra? (más de tolerances.penetration)'],
    ['contactsWith(other, { tolerance? })', 'dónde se toca con la otra (Contact). Con ella misma: sus uniones internas'],
    ['intersectionsWith(other, { tolerance? })', 'lo que comparte de volumen con la otra (Intersection)'],
    ['toString()', 'para leer'],
    ['help()', 'esta tabla'],
  ];
}

export class Piece extends Part {
  /** Sus medidas en su marco local, sobre x, y, z (en la unidad del documento). */
  get size() {
    const s = ctx(this).model.piece(this.id).size;
    return Object.freeze({ x: s[0], y: s[1], z: s[2] });
  }
  /** Largo, ancho y espesor: salen de su definición, así que girarla no los cambia nunca. */
  get dims() { return Object.freeze({ ...ctx(this).model.dims(this.id) }); }
  /** Hacia dónde corren su largo, su ancho y su espesor, en el mundo. Para girar sobre su propio largo: rotate(90, p.directions.length). */
  get directions() {
    const a = ctx(this).model.piece(this.id).axes;
    const ax = this.axes;
    return Object.freeze({ length: ax[AXES[a.length]], width: ax[AXES[a.width]], thickness: ax[AXES[a.thickness]] });
  }
  get material() { return ctx(this).model.piece(this.id).material; }
  /** Su forma (perfil, torneado, corte del CAD), o null si es un prisma. */
  get shape() {
    const s = ctx(this).model.piece(this.id).shape;
    return s ? Object.freeze(JSON.parse(JSON.stringify(s))) : null;
  }
  /** Cambiar sus medidas, en su marco local. No cambia cuál eje es el largo. @param {PointLike} size */
  resize(size) { ctx(this).model.resize(this.id, vec3(size, 'medidas')); return this; }
  /** @param {string} material */
  setMaterial(material) { ctx(this).model.setMaterial(this.id, material); return this; }

  /** @param {{ print?: boolean }} [opts] */
  static help(opts) { return help('Piece — una pieza: lo que se corta', [...Piece.members, ...Part.members], opts); }
  /** @param {{ print?: boolean }} [opts] */
  help(opts) { return Piece.help(opts); }

  /** @type {Member[]} */
  static members = [
    ['size', 'sus medidas en su marco local: { x, y, z }'],
    ['dims', '{ length, width, thickness }: largo, ancho y espesor — gire como gire'],
    ['directions', 'hacia dónde corren su largo, ancho y espesor en el mundo (Vector3d)'],
    ['material', 'su material'],
    ['shape', 'su forma (perfil, torneado, corte), o null si es un prisma'],
    ['resize(size)', 'cambiar sus medidas en su marco local'],
    ['setMaterial(m)', 'cambiarle el material'],
    ['static help()', 'esta tabla, sin crear una pieza'],
  ];
}

export class Assembly extends Part {
  /** Las partes que tiene adentro, en el primer nivel. @returns {readonly Part[]} */
  get children() {
    const p = ctx(this).model.get(this.id);
    return Object.freeze(p.kind === 'assembly' ? p.children.map((c) => ctx(this).part(c)) : []);
  }
  /** Todas las piezas que tiene adentro, a cualquier profundidad. */
  get pieces() { return Object.freeze(ctx(this).model.piecesOf(this.id).map((p) => /** @type {Piece} */ (ctx(this).part(p.id)))); }
  /** Lo deshace: sus partes quedan sueltas (o en el ensamble de arriba), en el mismo lugar. */
  explode() {
    const c = ctx(this);
    const kids = c.model.disassemble(this.id);
    c.forget([this.id]);
    return Object.freeze(kids.map((k) => c.part(k)));
  }

  /** @param {{ print?: boolean }} [opts] */
  static help(opts) { return help('Assembly — un conjunto de partes con colocación propia', [...Assembly.members, ...Part.members], opts); }
  /** @param {{ print?: boolean }} [opts] */
  help(opts) { return Assembly.help(opts); }

  /** @type {Member[]} */
  static members = [
    ['children', 'las partes de adentro, primer nivel'],
    ['pieces', 'todas las piezas de adentro, a cualquier profundidad'],
    ['explode()', 'deshacerlo: sus partes quedan en el mismo lugar'],
    ['static help()', 'esta tabla, sin crear un ensamble'],
  ];
}

/**
 * Un documento: el árbol de partes y la puerta de entrada a todo lo demás.
 *
 * `units`: la unidad de todas las medidas (mm, cm, m, in o ft; cm si no se dice). Es un dato
 * del documento: se guarda con él, y un documento cargado trae la suya.
 * `tolerances`: pisa las tolerancias que sugiere config.js para esa unidad, en esa unidad.
 * También se puede pasar un `Model` ya armado en lugar de las opciones.
 * @param {Model | { units?: Unit, tolerances?: Partial<Tolerances> }} [init]
 */
export function createWorkshop(init = {}) {
  const model = init instanceof Model ? init : new Model({ units: init.units });
  const override = init instanceof Model ? {} : init.tolerances ?? {};
  tolerancesFor(model.units, override); // que un valor inválido falle al crear, no en la primera pregunta
  /** @type {Map<string, Part>} */
  const cache = new Map();
  /** @type {Ctx} */
  const c = {
    model,
    tolerances: () => tolerancesFor(model.units, override),
    part(id) {
      const kind = model.get(id).kind; // que falle acá, con un mensaje claro, si no existe
      let h = cache.get(id);
      if (!h || h.kind !== kind) {
        h = kind === 'piece' ? new Piece(c, id) : new Assembly(c, id);
        cache.set(id, h);
      }
      return h;
    },
    forget(ids) { for (const id of ids) cache.delete(id); },
  };
  /** @param {(Part | string)[]} list */
  const ids = (list) => list.map((x) => (typeof x === 'string' ? x : x.id));

  /**
   * Una instancia de una pieza o de un ensamble: la misma parte colocada otra vez. Editar la
   * fuente (medidas, forma, material, lo de adentro) se ve en todas sus instancias. Nace
   * encima de la fuente; `placement` la mueve y la gira, en el mundo.
   * @param {Part | string} part
   * @param {{ name?: string, parent?: Part | string | null, placement?: Transform }} [opts]
   *   parent: el ensamble donde queda (el de la fuente si no se dice; null: suelta).
   * @returns {Part}
   */
  function instantiate(part, { name, parent, placement } = {}) {
    const id = model.instantiate(idDe(part), {
      name,
      parent: parent === undefined || parent === null ? parent : idDe(parent),
      placement: placement ? Transform.check(placement).frame : undefined,
    });
    return c.part(id);
  }

  const workshop = {
    model,
    Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection,
    /**
     * Una pieza nueva.
     * @param {{ name?: string, size: PointLike, material?: string, shape?: object | null,
     *           center?: PointLike, placement?: Transform, axes?: { length: 0|1|2, width: 0|1|2, thickness: 0|1|2 } }} spec
     *   size: largo de cada eje local, en la unidad del documento. center: dónde queda su centro (el origen si no se dice).
     *   placement: la orienta al crearla, en vez de crearla derecha y girarla después (p. ej.
     *   `Transform.fromEuler([rx, ry, rz])`, para importar un diseño que guarda Euler).
     *   axes: cuál eje local es el largo, el ancho y el espesor; por tamaño si no se dice.
     */
    addPiece({ name, size, material, shape, center = [0, 0, 0], placement, axes }) {
      const id = model.addPiece({
        name, size: vec3(size, 'medidas'), material, shape, at: vec3(center, 'centro'),
        r: placement ? Transform.check(placement).frame.r : undefined,
        axes,
      });
      return /** @type {Piece} */ (c.part(id));
    },
    /**
     * Junta partes hermanas en un ensamble nuevo. Si alguna ya es un ensamble, queda
     * adentro: se anida, no se aplasta.
     * @param {(Part | string)[]} parts @param {{ name?: string }} [opts]
     */
    assemble(parts, opts) { return /** @type {Assembly} */ (c.part(model.assemble(ids(parts), opts))); },
    instantiate,
    /**
     * Repite una parte en línea, en área o alrededor de un eje (ver `arrayTransforms`).
     * `count` cuenta a la original: con 4 se crean 3 instancias, que siguen a la fuente.
     * @param {Part | string} part @param {ArraySpec} spec
     * @returns {readonly Part[]} las instancias nuevas
     */
    array(part, spec) {
      const p = c.part(idDe(part));
      const ts = arrayTransforms(spec, { origin: p.boundingBox.center });
      return Object.freeze(ts.slice(1).map((t) => instantiate(p, { placement: t })));
    },
    /** @param {string} id */
    part(id) { return c.part(id); },
    get parts() { return Object.freeze([...model.parts.keys()].map((id) => c.part(id))); },
    get roots() { return Object.freeze(model.roots().map((p) => c.part(p.id))); },
    /** La unidad de todas las medidas del documento. */
    get units() { return model.units; },
    /** Las tolerancias en uso, en la unidad del documento: las sugeridas para ella (config.js) y lo que se haya pisado. */
    get tolerances() { return c.tolerances(); },
    /** Todos los contactos entre piezas del documento. @param {{ tolerance?: number }} [opts] */
    contacts({ tolerance } = {}) {
      const ps = model.allPieces().map((p) => p.id);
      const t = c.tolerances();
      return contactos(model, ps, ps, tolerance ?? t.touch, t.penetration);
    },
    /** Todas las piezas que se meten unas en otras. @param {{ tolerance?: number }} [opts] */
    collisions({ tolerance } = {}) {
      const ps = model.allPieces().map((p) => p.id);
      return intersecciones(model, ps, ps, tolerance ?? c.tolerances().penetration);
    },
    tree() { return model.tree(); },
    /** @param {(ev: { type: string, ids: string[] }) => void} fn */
    on(fn) { return model.on(fn); },
    toJSON() { return model.toJSON(); },
    /** @param {any} data */
    load(data) { cache.clear(); model.load(data); },
    clear() { cache.clear(); model.load({ units: model.units, counters: {}, parts: [] }); },
    /** @param {{ print?: boolean }} [opts] */
    help(opts) { return help('Workshop — el documento: crear, buscar y guardar partes', WORKSHOP_MEMBERS, opts); },
  };
  return workshop;
}

/** @type {Member[]} */
export const WORKSHOP_MEMBERS = [
  ['addPiece({ name?, size, material?, shape?, center?, placement?, axes? })', 'una pieza nueva: size en la unidad del documento sobre sus ejes locales; placement (Transform) la orienta al crearla; axes fuerza cuál eje es el largo, el ancho y el espesor'],
  ['assemble(parts, { name? })', 'un ensamble con esas partes hermanas; se anida, no se aplasta'],
  ['instantiate(part, { name?, parent?, placement? })', 'una instancia: la misma parte colocada otra vez; editar la fuente cambia todas'],
  ['array(part, spec)', "repetir una parte en línea, en área o alrededor de un eje: crea instancias (ver arrayTransforms)"],
  ['part(id)', 'una parte por su id'],
  ['parts', 'todas las partes'],
  ['roots', 'las partes de primer nivel (las que no están en un ensamble)'],
  ['units', "la unidad de todas las medidas del documento: 'mm', 'cm', 'm', 'in' o 'ft'"],
  ['tolerances', 'las tolerancias en uso, en esa unidad: { touch, penetration } (ver config.js)'],
  ['contacts({ tolerance? })', 'todos los contactos entre piezas (Contact)'],
  ['collisions({ tolerance? })', 'todas las piezas que se meten unas en otras (Intersection)'],
  ['tree()', 'el árbol de partes, como texto'],
  ['on(fn)', 'enterarse de cada cambio; devuelve cómo desuscribirse'],
  ['toJSON()', 'todo el documento, para guardar'],
  ['load(data)', 'cargar un documento guardado'],
  ['clear()', 'vaciar el documento'],
  ['model', 'el modelo por dentro (para el visor y las pruebas)'],
  ['Point3d  Vector3d  Line  BoundingBox  Face  Transform  Contact  Intersection', 'las clases de valores, a mano'],
  ['help()', 'esta tabla'],
];
