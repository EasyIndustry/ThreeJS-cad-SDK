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
import { Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection, Mesh, vec3 } from './geometry.js';
import { obbOf, satDepth, intersectBoxes, contactsOf, candidatePairs } from './contact.js';
import { arrayTransforms } from './array.js';
import { UNITS, convertLength } from './units.js';
import { TOLERANCE_PRESETS, GRAB_RATIO, tolerancesFor } from './config.js';
import { closestFeature, rayMesh, rayBox } from './grab.js';
import { snapMove, pushOutMove, dropMove, guides } from './placement.js';
import { solidOf, convexPartsOf, checkKernel, OPERATION_KINDS } from './solid.js';
import { SECTIONS, checkShape, resolveSection } from './sections.js';
import { featuresOf } from './features.js';
import { transformConvex, depth as hondura, contacts as contactosConvexos, intersect as cruce, volume as volumen } from './convex.js';
import { apply, invert, compose, rotate as rotar, transpose3 } from './frame.js';
import { help } from './help.js';

export { Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection, Mesh, OPERATION_KINDS, SECTIONS, arrayTransforms, UNITS, convertLength, TOLERANCE_PRESETS, GRAB_RATIO, tolerancesFor };

/** @typedef {import('./model.js').Space} Space */
/** @typedef {import('./geometry.js').PointLike} PointLike */
/** @typedef {import('./geometry.js').VectorLike} VectorLike */
/** @typedef {import('./geometry.js').AxisLike} AxisLike */
/** @typedef {import('./help.js').Member} Member */
/** @typedef {import('./array.js').ArraySpec} ArraySpec */
/** @typedef {import('./units.js').Unit} Unit */
/** @typedef {import('./config.js').Tolerances} Tolerances */
/** @typedef {import('./solid.js').Kernel} Kernel */
/** @typedef {import('./solid.js').OperationSpec} OperationSpec */
/** @typedef {import('./solid.js').Operation} Operation */
/** @typedef {import('./solid.js').Definition} Definition */
/** @typedef {import('./sections.js').SectionFn} SectionFn */
/** @typedef {import('./features.js').Features} Features */
/** @typedef {import('./convex.js').Convex} Convex */

/** @typedef {{ model: Model, part: (id: string) => Part, forget: (ids: string[]) => void, tolerances: () => Readonly<Tolerances>, checkSection: (shape: unknown, size?: [number, number, number]) => unknown,
 *             solid: (id: string) => Mesh, features: (id: string) => Features, convex: (id: string) => Convex[], sections: Readonly<Record<string, SectionFn>> }} Ctx */
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

/** Una pieza que es una caja lisa: sin forma de bruto y sin operaciones. @param {{ shape?: unknown, operations?: readonly unknown[] }} p */
const esCaja = (p) => !p.shape && !p.operations?.length;

/** Los pedazos convexos de una pieza, en el mundo. @param {Ctx} c @param {string} id */
const convexosEnElMundo = (c, id) => c.convex(id).map((k) => transformConvex(k, c.model.worldFrame(id)));

/** ¿Se cruzan las cajas de dos convexos, agrandadas por tol? @param {Convex} a @param {Convex} b @param {number} tol */
function cajasSeCruzan(a, b, tol) {
  for (let k = 0; k < 3; k++) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of a.vertices) { a0 = Math.min(a0, v[k]); a1 = Math.max(a1, v[k]); }
    for (const v of b.vertices) { b0 = Math.min(b0, v[k]); b1 = Math.max(b1, v[k]); }
    if (a0 > b1 + tol || b0 > a1 + tol) return false;
  }
  return true;
}

/**
 * La cara de la pieza (en su marco) que corresponde a un plano del mundo, si mira hacia uno de
 * sus ejes. @param {Model} m @param {string} id @param {{ n: [number, number, number] } | null} pl
 */
function caraDePlano(m, id, pl) {
  if (!pl) return null;
  const r = m.worldFrame(id).r;
  const n = [r[0] * pl.n[0] + r[3] * pl.n[1] + r[6] * pl.n[2], r[1] * pl.n[0] + r[4] * pl.n[1] + r[7] * pl.n[2], r[2] * pl.n[0] + r[5] * pl.n[1] + r[8] * pl.n[2]];
  const k = n.findIndex((v) => Math.abs(v) > 1 - 1e-9);
  return k < 0 ? null : { localAxis: AX_NAME[k], localSide: /** @type {1 | -1} */ (Math.sign(n[k])) };
}

/**
 * Los contactos entre las piezas de dos grupos (cada par una vez). Un par que se mete uno
 * en otro (más de `pen`) no cuenta como contacto: eso es una intersección. Con `exact`, cada
 * pieza que no es una caja lisa se toma con su forma real (sus convexos).
 * @param {Ctx} c @param {string[]} as @param {string[]} bs @param {number} tol @param {number} pen @param {boolean} [exact]
 */
function contactos(c, as, bs, tol, pen, exact = false) {
  const m = c.model;
  /** @type {Contact[]} */
  const out = [];
  for (const [x, y] of candidatePairs(m, as, bs, tol)) {
    if (exact && !(esCaja(m.piece(x)) && esCaja(m.piece(y)))) {
      out.push(...contactosExactos(c, x, y, tol, pen));
      continue;
    }
    const A = obbOf(m, x), B = obbOf(m, y);
    const depth = satDepth(A, B);
    if (depth < -tol || depth > pen) continue;
    for (const k of contactsOf(A, B, tol)) {
      out.push(new Contact({ kind: k.kind, a: x, b: y, points: k.points, area: k.area, normal: k.normal, faceA: caraLocal(k.faceA), faceB: caraLocal(k.faceB) }));
    }
  }
  return Object.freeze(out);
}

/** @param {Ctx} c @param {string} x @param {string} y @param {number} tol @param {number} pen @returns {Contact[]} */
function contactosExactos(c, x, y, tol, pen) {
  const A = convexosEnElMundo(c, x), B = convexosEnElMundo(c, y);
  /** @type {[Convex, Convex][]} */
  const pares = [];
  for (const a of A) for (const b of B) {
    if (!cajasSeCruzan(a, b, tol)) continue;
    const d = hondura(a, b);
    if (d > pen) return []; // se meten: es una intersección, no un contacto
    if (d >= -tol) pares.push([a, b]);
  }
  const todos = pares.flatMap(([a, b]) => contactosConvexos(a, b, tol));
  // un pedazo vecino puede dar, sobre la misma junta, una arista o un punto que ya está en otro contacto
  const caras = todos.filter((k) => k.kind === 'face');
  const cerca = (/** @type {number[]} */ p, /** @type {number[]} */ q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tol;
  /** @type {typeof todos} */
  const unicos = [];
  for (const k of todos) {
    if (k.kind !== 'face' && caras.some((f) => k.points.every((p) => f.points.some((q) => cerca(p, q)) || dentroDeCara(p, f.points, f.normal, tol)))) continue;
    if (unicos.some((u) => u.kind === k.kind && u.points.length === k.points.length && u.points.every((p) => k.points.some((q) => cerca(p, q))))) continue;
    unicos.push(k);
  }
  return unicos.map((k) => new Contact({
    kind: k.kind, a: x, b: y, points: k.points, area: k.area, normal: k.normal,
    faceA: caraDePlano(c.model, x, k.planeA), faceB: caraDePlano(c.model, y, k.planeB),
  }));
}

/** ¿El punto cae sobre el polígono plano (a tol de su plano)? @param {number[]} p @param {number[][]} poly @param {number[]} n @param {number} tol */
function dentroDeCara(p, poly, n, tol) {
  const d = (p[0] - poly[0][0]) * n[0] + (p[1] - poly[0][1]) * n[1] + (p[2] - poly[0][2]) * n[2];
  if (Math.abs(d) > tol) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const cx = [e[1] * w[2] - e[2] * w[1], e[2] * w[0] - e[0] * w[2], e[0] * w[1] - e[1] * w[0]];
    if (cx[0] * n[0] + cx[1] * n[1] + cx[2] * n[2] < -tol * Math.hypot(...e)) return false;
  }
  return true;
}

/**
 * Las intersecciones entre las piezas de dos grupos. Con `exact`, con la forma real.
 * @param {Ctx} c @param {string[]} as @param {string[]} bs @param {number} tol @param {boolean} [exact]
 */
function intersecciones(c, as, bs, tol, exact = false) {
  const m = c.model;
  /** @type {Intersection[]} */
  const out = [];
  for (const [x, y] of candidatePairs(m, as, bs, 0)) {
    if (exact && !(esCaja(m.piece(x)) && esCaja(m.piece(y)))) {
      const A = convexosEnElMundo(c, x), B = convexosEnElMundo(c, y);
      let depth = -Infinity, volume = 0;
      /** @type {number[][]} */ const vertices = [];
      /** @type {number[][][]} */ const faces = [];
      for (const a of A) for (const b of B) {
        if (!cajasSeCruzan(a, b, 0)) continue;
        const d = hondura(a, b);
        if (d <= tol) continue;
        const r = cruce(a, b);
        if (!r) continue;
        depth = Math.max(depth, d);
        volume += volumen(r);
        vertices.push(...r.vertices);
        faces.push(...r.faces.map((f) => f.poly));
      }
      if (volume > 0) out.push(new Intersection({ a: x, b: y, volume, depth, vertices, faces }));
      continue;
    }
    const A = obbOf(m, x), B = obbOf(m, y);
    const depth = satDepth(A, B);
    if (depth <= tol) continue;
    const r = intersectBoxes(A, B);
    if (r) out.push(new Intersection({ a: x, b: y, volume: r.volume, depth, vertices: r.vertices, faces: r.faces }));
  }
  return Object.freeze(out);
}

/**
 * Los rasgos de una pieza, en su marco: los de su caja, o los de su forma real.
 * @param {Ctx} c @param {string} id @returns {import('./grab.js').Rasgos}
 */
function rasgosDe(c, id) {
  const m = c.model, p = m.piece(id);
  if (esCaja(p)) return { vertices: m.cornersLocal(p), edges: m.edges(id, 'local'), faces: m.faces(id, 'local').map((f) => ({ outer: f.corners, holes: [], normal: f.normal })) };
  return c.features(id);
}

/**
 * Lo que devuelve `closest`: qué se agarró (un vértice, una arista o una cara de una pieza) y el
 * punto llevado a él. `key` lo identifica: dos resultados con la misma `key` son el mismo rasgo.
 * @typedef {{ kind: 'vertex' | 'edge' | 'face', piece: string, point: Point3d, edge: Line | null, face: Face | null, key: string }} Grab
 */

/**
 * ¿Dos agarres son el mismo rasgo de la misma pieza? Sirve para no redibujar mientras el
 * cursor sigue sobre lo mismo.
 * @param {Grab | null} a @param {Grab | null} b
 */
export function sameFeature(a, b) {
  return !!a && !!b && a.key === b.key;
}

/** Lo que hace de clave cuando una pieza no tiene forma de bruto u operaciones (un WeakMap no acepta null). */
const SIN_FORMA = Object.freeze({});
const SIN_OPERACIONES = /** @type {readonly Operation[]} */ (Object.freeze([]));

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

  // Una pieza que es una caja lisa da los de su caja; una con perfil, torneado u operaciones,
  // los de su forma real (los que salen de su malla): vértices donde se juntan tres caras o más,
  // aristas rectas (las de una superficie curva no se ofrecen) y caras planas, con sus agujeros.

  /** @param {Space} s */
  #vertices(s) {
    const c = ctx(this), m = c.model, ps = m.piecesOf(this.id);
    if (ps.every(esCaja)) return Object.freeze(m.positions(this.id, s).map((v) => new Point3d(...v)));
    return Object.freeze(ps.flatMap((p) => {
      const f = m.toSpace(p.id, s, this.id);
      return (esCaja(p) ? m.cornersLocal(p) : c.features(p.id).vertices).map((v) => new Point3d(...apply(f, v)));
    }));
  }
  /** @param {Space} s */
  #edges(s) {
    const c = ctx(this), m = c.model, ps = m.piecesOf(this.id);
    if (ps.every(esCaja)) return Object.freeze(m.edges(this.id, s).map(([a, b]) => new Line(a, b)));
    return Object.freeze(ps.flatMap((p) => {
      const f = m.toSpace(p.id, s, this.id);
      return (esCaja(p) ? m.edges(p.id, 'local') : c.features(p.id).edges).map(([a, b]) => new Line(apply(f, a), apply(f, b)));
    }));
  }
  /** @param {Space} s */
  #faces(s) {
    const c = ctx(this), m = c.model, ps = m.piecesOf(this.id);
    /** @param {ReturnType<Model['faces']>[number]} f */
    const deCaja = (f) => new Face({ piece: f.piece, localAxis: AXES[f.axis], localSide: f.side, normal: f.normal, center: f.center, vertices: f.corners });
    if (ps.every(esCaja)) return Object.freeze(m.faces(this.id, s).map(deCaja));
    return Object.freeze(ps.flatMap((p) => {
      const t = new Transform(m.toSpace(p.id, s, this.id));
      if (esCaja(p)) return m.faces(p.id, 'local').map(deCaja).map((f) => f.transform(t));
      return c.features(p.id).faces.map((f) => {
        const k = f.normal.findIndex((v) => Math.abs(v) > 1 - 1e-9);
        const n = f.outer.length;
        const center = /** @type {[number, number, number]} */ ([0, 1, 2].map((i) => f.outer.reduce((acc, v) => acc + v[i], 0) / n));
        return new Face({
          piece: p.id, localAxis: k < 0 ? null : AXES[k], localSide: k < 0 ? null : /** @type {1 | -1} */ (Math.sign(f.normal[k])),
          normal: f.normal, center, vertices: f.outer, holes: f.holes,
        }).transform(t);
      });
    }));
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

  // `exact: true`: con la forma real de cada pieza (perfil, torneado, operaciones), no con su caja.

  /** ¿Se toca con la otra (a `tolerance` o menos), sin meterse? @param {Part | string} other @param {{ tolerance?: number, exact?: boolean }} [opts] */
  touches(other, { tolerance, exact } = {}) { return this.contactsWith(other, { tolerance, exact }).length > 0; }
  /** ¿Se mete en la otra más de `tolerance`? @param {Part | string} other @param {{ tolerance?: number, exact?: boolean }} [opts] */
  intersects(other, { tolerance, exact } = {}) { return this.intersectionsWith(other, { tolerance, exact }).length > 0; }
  /** Dónde se toca con la otra. @param {Part | string} other @param {{ tolerance?: number, exact?: boolean }} [opts] */
  contactsWith(other, { tolerance, exact = false } = {}) {
    const c = ctx(this), m = c.model;
    const t = c.tolerances();
    return contactos(c, piezasDe(m, this.id), piezasDe(m, idDe(other)), tolerance ?? t.touch, t.penetration, exact);
  }
  /** Lo que comparte de volumen con la otra. @param {Part | string} other @param {{ tolerance?: number, exact?: boolean }} [opts] */
  intersectionsWith(other, { tolerance, exact = false } = {}) {
    const c = ctx(this), m = c.model;
    return intersecciones(c, piezasDe(m, this.id), piezasDe(m, idDe(other)), tolerance ?? c.tolerances().penetration, exact);
  }

  /**
   * El vértice, la arista o la cara (de sus piezas) más cercana a un punto, con el punto llevado
   * a ella; null si no hay ninguna a la distancia del agarre. Se prefiere un vértice a una arista
   * y una arista a una cara. La franja de cada eje de una pieza es `tolerance` (la del taller si
   * no se dice), pero no más que GRAB_RATIO del largo de ese eje.
   * @param {PointLike} point @param {{ tolerance?: number, space?: Space }} [opts] `space`: en qué marco va el punto y sale el resultado
   * @returns {Grab | null}
   */
  closest(point, { tolerance, space = 'world' } = {}) {
    const c = ctx(this), m = c.model;
    const T = tolerance ?? c.tolerances().grab;
    const propio = m.worldFrame(this.id);
    const pw = space === 'local' ? apply(propio, vec3(point, 'punto')) : vec3(point, 'punto');
    /** @type {{ h: NonNullable<ReturnType<typeof closestFeature>>, id: string, W: import('./frame.js').Frame, rango: number } | null} */
    let mejor = null;
    for (const p of m.piecesOf(this.id)) {
      const W = m.worldFrame(p.id);
      const tol = /** @type {[number, number, number]} */ (p.size.map((x) => Math.min(T, GRAB_RATIO * x)));
      const h = closestFeature(apply(invert(W), pw), rasgosDe(c, p.id), tol);
      if (!h) continue;
      const rango = h.kind === 'vertex' ? 0 : h.kind === 'edge' ? 1 : 2;
      if (!mejor || rango < mejor.rango || (rango === mejor.rango && h.d < mejor.h.d)) mejor = { h, id: p.id, W, rango };
    }
    if (!mejor) return null;
    const { h, id, W } = mejor;
    const F = space === 'local' ? compose(invert(propio), W) : W;
    const r6 = (/** @type {number[]} */ v) => v.map((x) => Math.round(x * 1e6) / 1e6).join(',');
    /** @type {Grab} */
    let out;
    if (h.kind === 'vertex') out = { kind: 'vertex', piece: id, point: new Point3d(...apply(F, h.point)), edge: null, face: null, key: `${id}:v:${r6(h.point)}` };
    else if (h.kind === 'edge') {
      const [a, b] = h.edge;
      const k = [r6(a), r6(b)].sort().join('|');
      out = { kind: 'edge', piece: id, point: new Point3d(...apply(F, h.point)), edge: new Line(apply(F, a), apply(F, b)), face: null, key: `${id}:e:${k}` };
    } else {
      const f = h.face, n = f.normal, k = n.findIndex((v) => Math.abs(v) > 1 - 1e-9);
      const center = /** @type {[number, number, number]} */ ([0, 1, 2].map((i) => f.outer.reduce((acc, v) => acc + v[i], 0) / f.outer.length));
      const face = new Face({
        piece: id, localAxis: k < 0 ? null : AXES[k], localSide: k < 0 ? null : /** @type {1 | -1} */ (Math.sign(n[k])),
        normal: n, center, vertices: f.outer, holes: f.holes,
      }).transform(new Transform(F));
      out = { kind: 'face', piece: id, point: new Point3d(...apply(F, h.point)), edge: null, face, key: `${id}:f:${r6(n)}:${r6(center)}` };
    }
    return Object.freeze(out);
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
    ['vertices', 'sus vértices en el mundo (Point3d), los de su forma real. vertices[0].x se lee, no se escribe'],
    ['edges', 'sus aristas rectas en el mundo (Line); las de una superficie curva no se ofrecen'],
    ['faces', 'sus caras planas en el mundo (Face), con sus agujeros'],
    ['boundingBox', 'la caja que la encierra, alineada al mundo'],
    ['local', 'lo mismo en su propio marco: local.vertices, local.edges, local.faces, local.boundingBox (y local.solid, en una pieza)'],
    ['transform(t)', 'aplicarle un Transform: el verbo del que salen los demás'],
    ['move(v) / move(from, to)', 'trasladar por un vector, o de un punto a otro'],
    ["rotate(degrees, axis?, center?)", "girar en grados; eje 'x' | 'y' | 'z' o un vector; por el centro de su caja"],
    ['duplicate()', 'copia exacta en el mismo lugar, con todo lo de adentro (independiente: no sigue a la original)'],
    ['detach()', 'soltar una instancia: pasa a ser una parte de verdad, que ya no sigue a su fuente'],
    ['rename(name)', 'cambiarle el nombre'],
    ['remove()', 'borrarla, con todo lo que cuelga de ella'],
    ['touches(other, { tolerance?, exact? })', '¿se toca con la otra sin meterse? (a tolerances.touch o menos). exact: con la forma real, no la caja'],
    ['intersects(other, { tolerance?, exact? })', '¿se mete en la otra? (más de tolerances.penetration)'],
    ['contactsWith(other, { tolerance?, exact? })', 'dónde se toca con la otra (Contact). Con ella misma: sus uniones internas'],
    ['intersectionsWith(other, { tolerance?, exact? })', 'lo que comparte de volumen con la otra (Intersection)'],
    ['closest(point, { tolerance?, space? })', "el vértice, la arista o la cara más cercana: { kind, piece, point, edge, face, key }, o null"],
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
  /** La forma de su bruto (perfil, torneado), o null si es una caja. */
  get shape() {
    const s = ctx(this).model.piece(this.id).shape;
    return s ? Object.freeze(JSON.parse(JSON.stringify(s))) : null;
  }
  /** Su bruto: lo que se compra y se corta. Las operaciones no lo cambian. */
  get stock() { return Object.freeze({ size: this.size, shape: this.shape }); }
  /** Lo que se le hace al bruto, en orden (cortes, agujeros), con su id. @returns {readonly Operation[]} */
  get operations() { return /** @type {readonly Operation[]} */ (ctx(this).model.piece(this.id).operations ?? []); }
  /**
   * La forma que resulta, en el mundo: el bruto con sus operaciones. Se calcula, no se guarda.
   * @returns {Mesh}
   */
  get solid() { return this.#solid().transform(this.placement); }
  /**
   * Lo mismo que Part.local, más la forma que resulta (`local.solid`) en el marco de la pieza.
   * @returns {Readonly<{ vertices: readonly Point3d[], edges: readonly Line[], faces: readonly Face[], boundingBox: BoundingBox, solid: Mesh }>}
   */
  get local() {
    const base = super.local, self = this;
    return Object.freeze({
      get vertices() { return base.vertices; },
      get edges() { return base.edges; },
      get faces() { return base.faces; },
      get boundingBox() { return base.boundingBox; },
      /** @returns {Mesh} */
      get solid() { return self.#solid(); },
    });
  }
  /** @returns {Mesh} */
  #solid() { return ctx(this).solid(this.id); }
  /** Cambiar sus medidas, en su marco local. No cambia cuál eje es el largo. Las operaciones se reaplican. @param {PointLike} size */
  resize(size) {
    const c = ctx(this), v = vec3(size, 'medidas');
    c.checkSection(c.model.piece(this.id).shape, v); // que la sección siga entrando
    c.model.resize(this.id, v);
    return this;
  }
  /** @param {string} material */
  setMaterial(material) { ctx(this).model.setMaterial(this.id, material); return this; }
  /**
   * Cambia la forma del bruto: { kind: 'profile', axis, section, params? }, { kind: 'lathe',
   * axis, contour } o null (una caja). Las medidas y las operaciones quedan.
   * @param {unknown} shape
   */
  setShape(shape) { const c = ctx(this); c.model.setShape(this.id, c.checkSection(shape, c.model.piece(this.id).size)); return this; }
  /** Agrega una operación al final (ver OPERATION_KINDS). Su id queda en `operations`. @param {OperationSpec} op */
  addOperation(op) { ctx(this).model.addOperation(this.id, op); return this; }
  /** Reemplaza una operación, en su lugar. @param {string} id @param {OperationSpec} op */
  updateOperation(id, op) { ctx(this).model.updateOperation(this.id, id, op); return this; }
  /** Saca una operación: la forma vuelve a la de antes de ella. @param {string} id */
  removeOperation(id) { ctx(this).model.removeOperation(this.id, id); return this; }

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
    ['shape', "la forma de su bruto: { kind: 'profile', axis, section, params? }, { kind: 'lathe', axis, contour } o null (una caja)"],
    ['stock', 'su bruto, lo que se compra: { size, shape }; las operaciones no lo cambian'],
    ['operations', "lo que se le hace al bruto, en orden: { id, kind: 'cut' | 'hole', … }"],
    ['solid', 'la forma que resulta (Mesh), en el mundo: se calcula, no se guarda'],
    ['resize(size)', 'cambiar sus medidas en su marco local; las operaciones se reaplican'],
    ['setMaterial(m)', 'cambiarle el material'],
    ['setShape(shape)', 'cambiarle la forma del bruto (perfil, torneado; null: una caja)'],
    ['addOperation(op)', "agregar una operación: { kind: 'cut', axis, outline } o { kind: 'hole', axis, side, at, diameter, depth? }"],
    ['updateOperation(id, op)', 'reemplazar una operación, en su lugar'],
    ['removeOperation(id)', 'sacar una operación: la forma vuelve a la de antes'],
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
 * `historyLimit`: cuántos pasos se pueden deshacer (100 si no se dice; 0: sin historial).
 * `kernel`: lo que combina sólidos en 3D ({ intersect, subtract }, sobre mallas), para dibujar
 * piezas con varias operaciones con una malla limpia. Lo pone la app (three-bvh-csg, manifold…);
 * sin él, el SDK la arma de la forma partida en convexos.
 * `sections`: secciones de perfil propias de la app, `{ nombre: (params, ancho, alto) => sección }`,
 * además de las genéricas de SECTIONS.
 * También se puede pasar un `Model` ya armado en lugar de las opciones.
 * @param {Model | { units?: Unit, tolerances?: Partial<Tolerances>, historyLimit?: number, kernel?: Kernel, sections?: Record<string, SectionFn> }} [init]
 */
export function createWorkshop(init = {}) {
  const model = init instanceof Model ? init : new Model({ units: init.units, historyLimit: init.historyLimit });
  const override = init instanceof Model ? {} : init.tolerances ?? {};
  const kernel = init instanceof Model || init.kernel === undefined ? null : checkKernel(init.kernel);
  const propias = init instanceof Model ? {} : init.sections ?? {};
  for (const [k, f] of Object.entries(propias)) if (typeof f !== 'function') throw new TypeError(`sección ${k} inválida: va una función (params, ancho, alto) => { outer, holes? }`);
  /** @type {Readonly<Record<string, SectionFn>>} */
  const sections = Object.freeze({ ...SECTIONS, ...propias });
  /**
   * Lo que se deriva de la forma de cada pieza (su malla, sus rasgos, sus convexos), mientras no
   * cambie lo que la define: sus medidas, la forma de su bruto y sus operaciones. Lo guardado es
   * inmutable y esas partes se comparten entre un registro y el que lo reemplaza, así que mover
   * o renombrar no lo recalcula, y deshacer vuelve a encontrar lo de antes.
   * @type {{ solid: WeakMap<object, any>, features: WeakMap<object, any>, convex: WeakMap<object, any> }}
   */
  const formas = { solid: new WeakMap(), features: new WeakMap(), convex: new WeakMap() };
  /**
   * @template T @param {keyof typeof formas} que @param {Definition} def @param {() => T} calcular @returns {T}
   */
  const porDefinicion = (que, def, calcular) => {
    const claves = [def.size, def.shape ?? SIN_FORMA, def.operations ?? SIN_OPERACIONES];
    /** @type {WeakMap<object, any>} */
    let nivel = formas[que];
    for (const k of claves.slice(0, -1)) {
      if (!nivel.has(k)) nivel.set(k, new WeakMap());
      nivel = nivel.get(k);
    }
    const ultima = claves[claves.length - 1];
    if (!nivel.has(ultima)) nivel.set(ultima, calcular());
    return nivel.get(ultima);
  };
  /**
   * Revisa la forma de un bruto y, si es un perfil, que su sección exista y se pueda armar con
   * esas medidas (una pared más gruesa que la mitad del lado falla acá, no al dibujar).
   * @param {unknown} shape @param {[number, number, number]} [size]
   */
  const checkSection = (shape, size) => {
    const sh = checkShape(shape);
    if (sh?.kind === 'profile' && size) resolveSection(sh, size, sections);
    return sh;
  };
  tolerancesFor(model.units, override); // que un valor inválido falle al crear, no en la primera pregunta
  /** @type {Map<string, Part>} */
  const cache = new Map();
  /** @type {Ctx} */
  const c = {
    model,
    tolerances: () => tolerancesFor(model.units, override),
    sections,
    checkSection,
    solid(id) {
      const def = model.definition(id);
      return porDefinicion('solid', def, () => solidOf(def, { kernel, sections }));
    },
    features(id) {
      const def = model.definition(id);
      return porDefinicion('features', def, () => featuresOf(c.solid(id)));
    },
    convex(id) {
      const def = model.definition(id);
      return porDefinicion('convex', def, () => convexPartsOf(def, sections));
    },
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

  // ---------- colocación: proponer, no aplicar ----------

  /** @param {Part | string | (Part | string)[]} x @returns {string[]} los ids de las piezas que se mueven */
  const piezasQueSeMueven = (x) => [...new Set((Array.isArray(x) ? x : [x]).flatMap((p) => model.piecesOf(idDe(p)).map((q) => q.id)))];
  /** @param {string[]} mueven @param {(Part | string)[] | undefined} contra */
  const lasOtras = (mueven, contra) => {
    const fuera = new Set(mueven);
    const ids = contra ? contra.flatMap((p) => model.piecesOf(idDe(p)).map((q) => q.id)) : model.allPieces().map((p) => p.id);
    return [...new Set(ids)].filter((id) => !fuera.has(id)).map((id) => obbOf(model, id));
  };
  /** @param {AxisLike | undefined} up @returns {[number, number, number]} */
  const arriba = (up = 'y') => {
    const v = typeof up === 'string' ? (/** @type {Record<string, [number, number, number]>} */ ({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }))[up] : vec3(up, 'arriba');
    if (!v) throw new TypeError(`arriba inválido: ${String(up)} (va 'x', 'y', 'z' o un vector)`);
    const m = Math.hypot(...v);
    if (!m) throw new Error('arriba no puede ser nulo');
    return /** @type {[number, number, number]} */ (v.map((x) => x / m));
  };
  const escalaDoc = () => Math.max(1, ...model.allPieces().flatMap((p) => p.size));

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
    Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection, Mesh,
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
        name, size: vec3(size, 'medidas'), material, shape: checkSection(shape, vec3(size, 'medidas')), at: vec3(center, 'centro'),
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
     * Es un solo paso de deshacer.
     * @param {Part | string} part @param {ArraySpec} spec
     * @returns {readonly Part[]} las instancias nuevas
     */
    array(part, spec) {
      const p = c.part(idDe(part));
      const ts = arrayTransforms(spec, { origin: p.boundingBox.center });
      return model.transaction(() => Object.freeze(ts.slice(1).map((t) => instantiate(p, { placement: t }))));
    },
    /**
     * La primera pieza que corta un rayo (contra su forma real) y dónde: { part, point,
     * distance, normal }, o null. Sin three: para pruebas, para el servidor, o para elegir
     * sin escena. `exclude`: partes que no cuentan (la que se está arrastrando).
     * @param {{ origin: PointLike, direction: VectorLike }} ray @param {{ exclude?: (Part | string)[] }} [opts]
     */
    pick(ray, { exclude = [] } = {}) {
      const o = vec3(ray?.origin, 'origen del rayo');
      const d0 = vec3(ray?.direction, 'dirección del rayo');
      const L = Math.hypot(...d0);
      if (!L) throw new Error('la dirección del rayo no puede ser nula');
      const d = /** @type {[number, number, number]} */ (d0.map((v) => v / L));
      const fuera = new Set(exclude.flatMap((x) => model.piecesOf(idDe(x)).map((p) => p.id)));
      /** @type {{ id: string, t: number, n: [number, number, number] } | null} */
      let mejor = null;
      for (const p of model.allPieces()) {
        if (fuera.has(p.id)) continue;
        const W = model.worldFrame(p.id), inv = invert(W);
        const ol = apply(inv, o), dl = rotar(transpose3(W.r), d);
        const entra = rayBox(ol, dl, /** @type {[number, number, number]} */ (p.size.map((x) => x / 2)));
        if (entra === null || (mejor && entra > mejor.t)) continue;
        const h = rayMesh(ol, dl, c.solid(p.id));
        if (h && (!mejor || h.t < mejor.t)) mejor = { id: p.id, t: h.t, n: rotar(W.r, h.normal) };
      }
      if (!mejor) return null;
      const { id, t, n } = mejor;
      return Object.freeze({ part: c.part(id), point: new Point3d(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t), distance: t, normal: new Vector3d(...n) });
    },
    /**
     * Imán: la traslación que pega las caras de lo que se mueve a las de otras piezas que estén
     * a `distance` o menos (enfrentadas: se tocan; del mismo lado: al ras), y qué la causó. No
     * aplica nada. `grid`: en los ejes del mundo que el imán no tocó, la esquina cae en la grilla.
     * @param {Part | string | (Part | string)[]} parts
     * @param {{ against?: (Part | string)[], distance?: number, grid?: number | null }} [opts]
     */
    snap(parts, { against, distance, grid = null } = {}) {
      const mueven = piezasQueSeMueven(parts);
      const r = snapMove(mueven.map((id) => obbOf(model, id)), lasOtras(mueven, against), { distance: distance ?? c.tolerances().snap, grid });
      if (!r) return null;
      return Object.freeze({
        transform: Transform.translation(r.t),
        snaps: Object.freeze(r.snaps.map((x) => Object.freeze({ normal: new Vector3d(...x.normal), delta: x.delta, other: c.part(x.other), kind: x.kind }))),
      });
    },
    /**
     * Si lo que se mueve está metido en otras piezas, la traslación que lo saca por el lado de
     * menor penetración (queda tocando, sin meterse). Con `floor`, nunca por debajo del piso,
     * medido en la dirección `up` ('y' por defecto). null si no está metido en nada.
     * @param {Part | string | (Part | string)[]} parts
     * @param {{ against?: (Part | string)[], floor?: number | null, up?: AxisLike }} [opts]
     */
    pushOut(parts, { against, floor = null, up } = {}) {
      const mueven = piezasQueSeMueven(parts);
      const r = pushOutMove(mueven.map((id) => obbOf(model, id)), lasOtras(mueven, against), { up: arriba(up), floor, scale: escalaDoc() });
      return r && Object.freeze({ transform: Transform.translation(r.t), from: Object.freeze(r.from.map((id) => c.part(id))) });
    },
    /**
     * Apoyar: cuánto baja lo que se mueve (contra `up`) hasta tocar algo de abajo o el piso, y la
     * traslación. `on`: la pieza donde apoya, o null si es el piso. null si no hay nada abajo.
     * @param {Part | string | (Part | string)[]} parts
     * @param {{ against?: (Part | string)[], floor?: number | null, up?: AxisLike }} [opts]
     */
    drop(parts, { against, floor = null, up } = {}) {
      const mueven = piezasQueSeMueven(parts);
      const u = arriba(up);
      const r = dropMove(mueven.map((id) => obbOf(model, id)), lasOtras(mueven, against), { up: u, floor });
      return r && Object.freeze({ transform: Transform.translation(u.map((x) => -x * r.distance)), distance: r.distance, on: r.on ? c.part(r.on) : null });
    },
    /**
     * Los planos de otras piezas con los que lo que se mueve quedó alineado (a `tolerance` o
     * menos), los más cercanos primero y sin repetir: para dibujar las guías.
     * @param {Part | string | (Part | string)[]} parts
     * @param {{ against?: (Part | string)[], tolerance?: number }} [opts]
     */
    alignmentGuides(parts, { against, tolerance } = {}) {
      const mueven = piezasQueSeMueven(parts);
      return Object.freeze(guides(mueven.map((id) => obbOf(model, id)), lasOtras(mueven, against), { tolerance: tolerance ?? c.tolerances().touch })
        .map((g) => Object.freeze({ normal: new Vector3d(...g.normal), offset: g.offset, other: c.part(g.other), kind: g.kind, gap: g.gap })));
    },
    /** @param {string} id */
    part(id) { return c.part(id); },
    get parts() { return Object.freeze([...model.parts.keys()].map((id) => c.part(id))); },
    get roots() { return Object.freeze(model.roots().map((p) => c.part(p.id))); },
    /** La unidad de todas las medidas del documento. */
    get units() { return model.units; },
    /** Las tolerancias en uso, en la unidad del documento: las sugeridas para ella (config.js) y lo que se haya pisado. */
    get tolerances() { return c.tolerances(); },
    /** Todos los contactos entre piezas del documento. @param {{ tolerance?: number, exact?: boolean }} [opts] */
    contacts({ tolerance, exact = false } = {}) {
      const ps = model.allPieces().map((p) => p.id);
      const t = c.tolerances();
      return contactos(c, ps, ps, tolerance ?? t.touch, t.penetration, exact);
    },
    /** Todas las piezas que se meten unas en otras. @param {{ tolerance?: number, exact?: boolean }} [opts] */
    collisions({ tolerance, exact = false } = {}) {
      const ps = model.allPieces().map((p) => p.id);
      return intersecciones(c, ps, ps, tolerance ?? c.tolerances().penetration, exact);
    },
    tree() { return model.tree(); },
    /** @param {(ev: { type: string, ids: string[] }) => void} fn */
    on(fn) { return model.on(fn); },
    /** Vuelve al documento de antes del último paso (marcos, definiciones, ensambles, instancias). false si no había nada. */
    undo() { return model.undo(); },
    /** Vuelve a hacer lo último que se deshizo. false si no había nada. */
    redo() { return model.redo(); },
    get canUndo() { return model.canUndo; },
    get canRedo() { return model.canRedo; },
    /** Abre una transacción: lo que se haga hasta `commit()` es un solo paso de deshacer. Se anidan. */
    begin() { model.begin(); },
    /** Cierra la transacción abierta. */
    commit() { model.commit(); },
    /** Cancela la transacción abierta: el documento vuelve a como estaba en `begin()`. */
    rollback() { model.rollback(); },
    /**
     * Hace `fn` como un solo paso de deshacer. Si tira, el documento vuelve a como estaba.
     * @template T @param {() => T} fn @returns {T}
     */
    transaction(fn) { return model.transaction(fn); },
    /** Olvida lo que se puede deshacer y rehacer; el documento queda como está. */
    clearHistory() { model.clearHistory(); },
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
  ['pick(ray, { exclude? })', 'la primera pieza que corta un rayo { origin, direction }, contra su forma real: { part, point, distance, normal }, o null'],
  ['snap(parts, { against?, distance?, grid? })', 'imán: { transform, snaps } que pega sus caras a las de otras piezas cercanas (no aplica nada)'],
  ['pushOut(parts, { against?, floor?, up? })', 'si está metida en otras, { transform, from } que la saca por el lado de menor penetración'],
  ['drop(parts, { against?, floor?, up? })', 'apoyar: { transform, distance, on } hasta tocar lo de abajo o el piso'],
  ['alignmentGuides(parts, { against?, tolerance? })', 'los planos de otras piezas con los que quedó alineada, los más cercanos primero'],
  ['part(id)', 'una parte por su id'],
  ['parts', 'todas las partes'],
  ['roots', 'las partes de primer nivel (las que no están en un ensamble)'],
  ['units', "la unidad de todas las medidas del documento: 'mm', 'cm', 'm', 'in' o 'ft'"],
  ['tolerances', 'las tolerancias en uso, en esa unidad: { touch, penetration } (ver config.js)'],
  ['contacts({ tolerance?, exact? })', 'todos los contactos entre piezas (Contact); exact: con la forma real'],
  ['collisions({ tolerance?, exact? })', 'todas las piezas que se meten unas en otras (Intersection)'],
  ['tree()', 'el árbol de partes, como texto'],
  ['on(fn)', "enterarse de cada cambio ({ type, ids }); deshacer avisa con 'undo' y 'redo', y cancelar con 'rollback'; devuelve cómo desuscribirse"],
  ['undo()', 'volver al documento de antes del último paso; false si no había nada'],
  ['redo()', 'volver a hacer lo último que se deshizo; false si no había nada'],
  ['canUndo', '¿hay algo para deshacer?'],
  ['canRedo', '¿hay algo para rehacer?'],
  ['begin()', 'abrir una transacción: lo que se haga hasta commit() es un solo paso de deshacer (se anidan)'],
  ['commit()', 'cerrar la transacción abierta'],
  ['rollback()', 'cancelar la transacción abierta: el documento vuelve a como estaba en begin()'],
  ['transaction(fn)', 'hacer fn como un solo paso de deshacer; si tira, todo vuelve a como estaba'],
  ['clearHistory()', 'olvidar lo que se puede deshacer y rehacer'],
  ['toJSON()', 'todo el documento, para guardar'],
  ['load(data)', 'cargar un documento guardado (borra el historial)'],
  ['clear()', 'vaciar el documento (borra el historial; conserva la unidad)'],
  ['model', 'el modelo por dentro (para el visor y las pruebas)'],
  ['Point3d  Vector3d  Line  BoundingBox  Face  Transform  Contact  Intersection  Mesh', 'las clases de valores, a mano'],
  ['help()', 'esta tabla'],
];
