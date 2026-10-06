// El modelo: un árbol de partes.
//
// Una PARTE es lo que se puede mover, girar, duplicar y meter en un ensamble. Hay dos:
//   - la PIEZA es una hoja: tiene lo fabricable (medidas, material, forma), definido en
//     su marco local, que no cambia al moverla ni al girarla.
//   - el ENSAMBLE es un nodo: no tiene nada fabricable propio, compone. Su caja sale de
//     sus hijos. Y como es una parte más, se puede meter en otro ensamble — un mueble es
//     un ensamble de cuerpo, puerta y cajón, que a su vez son ensambles.
//
// Cada parte guarda su marco RESPECTO DE SU PADRE. El marco en el mundo se calcula
// subiendo por el árbol. Girar un ensamble es tocar UN marco: los hijos no se enteran,
// sus definiciones siguen intactas, y en el mundo giran con él.
//
// Toda la geometría se puede pedir en 'local' (el marco de la parte) o en 'world'.
//
// Este módulo no importa nada de three ni del DOM: corre en Node y lo puede usar el
// servidor. Lo prueba web/test/sdk.test.mjs.
import { frame, compose, invert, apply, rotate, turn, transpose3, isQuarterTurn, axisIndex } from './frame.js';

/** @typedef {import('./frame.js').Vec3} Vec3 */
/** @typedef {import('./frame.js').Frame} Frame */
/** @typedef {import('./frame.js').Axis} Axis */
/** @typedef {'local' | 'world'} Space */

/**
 * Qué eje LOCAL es el largo, el ancho y el espesor de una pieza. Se decide al crearla
 * (por tamaño) y es parte de su definición: girar no lo cambia, porque los ejes locales
 * giran con la pieza. Solo se cambia a propósito.
 * @typedef {{ length: 0 | 1 | 2, width: 0 | 1 | 2, thickness: 0 | 1 | 2 }} Axes
 */

/**
 * @typedef {Object} PieceDef
 * @property {'piece'} kind
 * @property {string} id
 * @property {string} name
 * @property {string | null} parent
 * @property {Frame} frame       marco respecto del padre (o del mundo si es raíz)
 * @property {Vec3} size         medidas en cm, sobre los ejes locales x, y, z
 * @property {Axes} axes
 * @property {string} material
 * @property {object | null} shape  forma (perfil, torneado, corte): ver core/shapes.js
 */
/**
 * @typedef {Object} AssemblyDef
 * @property {'assembly'} kind
 * @property {string} id
 * @property {string} name
 * @property {string | null} parent
 * @property {Frame} frame
 * @property {string[]} children
 */
/** @typedef {PieceDef | AssemblyDef} PartDef */

/** @typedef {{ min: Vec3, max: Vec3, size: Vec3, center: Vec3 }} Box */
/** @typedef {{ axis: 0 | 1 | 2, side: 1 | -1, normal: Vec3, corners: Vec3[], center: Vec3 }} Face */

/** Ejes por tamaño: el más largo es el largo, el más corto el espesor. @param {Vec3} size @returns {Axes} */
export function axesBySize(size) {
  const o = /** @type {(0 | 1 | 2)[]} */ ([0, 1, 2]).sort((a, b) => size[b] - size[a] || a - b);
  return { length: o[0], width: o[1], thickness: o[2] };
}

const clone = (/** @type {any} */ v) => JSON.parse(JSON.stringify(v));

export class Model {
  constructor() {
    /** @type {Map<string, PartDef>} */
    this.parts = new Map();
    /** @type {Record<string, number>} */
    this.counters = { piece: 0, assembly: 0 };
    /** @type {Set<(ev: { type: string, ids: string[] }) => void>} */
    this.listeners = new Set();
  }

  // ---------- eventos: el visor (y mañana la interfaz) se cuelga de acá ----------

  /** @param {(ev: { type: string, ids: string[] }) => void} fn @returns {() => void} para desuscribirse */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** @param {string} type @param {string[]} ids */
  emit(type, ids) {
    for (const fn of this.listeners) fn({ type, ids });
  }

  // ---------- leer ----------

  /** @param {string} id @returns {PartDef} */
  get(id) {
    const p = this.parts.get(id);
    if (!p) throw new Error(`no existe la parte ${id}`);
    return p;
  }

  /** @param {string} id @returns {PieceDef} */
  piece(id) {
    const p = this.get(id);
    if (p.kind !== 'piece') throw new Error(`${id} es un ensamble, no una pieza`);
    return p;
  }

  /** Las partes de primer nivel (sin padre), en orden de creación. */
  roots() {
    return [...this.parts.values()].filter((p) => p.parent === null);
  }

  /** @param {string} id @returns {PieceDef[]} todas las piezas que cuelgan de esta parte (ella misma si es pieza) */
  piecesOf(id) {
    const p = this.get(id);
    return p.kind === 'piece' ? [p] : p.children.flatMap((c) => this.piecesOf(c));
  }

  /** @param {string} id @returns {string[]} los ids del subárbol, la parte primero */
  subtree(id) {
    const p = this.get(id);
    return p.kind === 'piece' ? [id] : [id, ...p.children.flatMap((c) => this.subtree(c))];
  }

  /** @param {string} id @returns {Frame} el marco de la parte en el mundo */
  worldFrame(id) {
    const p = this.get(id);
    return p.parent === null ? p.frame : compose(this.worldFrame(p.parent), p.frame);
  }

  /** @param {string | null} id @returns {Frame} el marco del mundo para los hijos de `id` */
  parentWorld(id) {
    return id === null ? frame() : this.worldFrame(id);
  }

  // ---------- geometría ----------
  // Todo en 'local' (el marco de la parte) o en 'world'. Por ahora una pieza es su caja:
  // la forma (perfil, torneado, corte) viaja en la definición y el visor la dibuja, pero
  // los vértices que se consultan acá son los de la caja. Los de la forma real van después.

  /** @param {PieceDef} p @returns {Vec3[]} las 8 esquinas, en su marco local */
  cornersLocal(p) {
    const [a, b, c] = p.size.map((s) => s / 2);
    /** @type {Vec3[]} */
    const out = [];
    for (const x of [-a, a]) for (const y of [-b, b]) for (const z of [-c, c]) out.push([x, y, z]);
    return out;
  }

  /**
   * El marco que lleva del espacio de la pieza `pieceId` al espacio pedido: el mundo, o el
   * marco local de `relTo` (que puede ser un ensamble que la contiene).
   * @param {string} pieceId @param {Space} space @param {string} relTo
   */
  toSpace(pieceId, space, relTo) {
    const w = this.worldFrame(pieceId);
    return space === 'world' ? w : compose(invert(this.worldFrame(relTo)), w);
  }

  /** @param {string} id @param {Space} [space] @returns {Vec3[]} */
  positions(id, space = 'world') {
    return this.piecesOf(id).flatMap((p) => {
      const f = this.toSpace(p.id, space, id);
      return this.cornersLocal(p).map((v) => apply(f, v));
    });
  }

  /**
   * Caja alineada a los ejes del espacio pedido. En 'local' de una pieza es exacta: sus
   * medidas. En 'world' también es exacta (es la caja de las esquinas giradas), y con un
   * cuarto de vuelta da números limpios, sin ruido.
   * @param {string} id @param {Space} [space] @returns {Box}
   */
  box(id, space = 'world') {
    const pts = this.positions(id, space);
    if (!pts.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
    const min = /** @type {Vec3} */ ([0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))));
    const max = /** @type {Vec3} */ ([0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))));
    return {
      min, max,
      size: /** @type {Vec3} */ ([0, 1, 2].map((k) => max[k] - min[k])),
      center: /** @type {Vec3} */ ([0, 1, 2].map((k) => (min[k] + max[k]) / 2)),
    };
  }

  /** @param {string} id @param {Space} [space] @returns {[Vec3, Vec3][]} las 12 aristas de cada pieza */
  edges(id, space = 'world') {
    return this.piecesOf(id).flatMap((p) => {
      const f = this.toSpace(p.id, space, id);
      const h = p.size.map((s) => s / 2);
      /** @type {[Vec3, Vec3][]} */
      const out = [];
      for (let ax = 0; ax < 3; ax++) {
        const [u, v] = [0, 1, 2].filter((i) => i !== ax);
        for (const su of [-1, 1]) for (const sv of [-1, 1]) {
          /** @type {Vec3} */ const a = [0, 0, 0];
          /** @type {Vec3} */ const b = [0, 0, 0];
          a[u] = b[u] = su * h[u];
          a[v] = b[v] = sv * h[v];
          a[ax] = -h[ax];
          b[ax] = h[ax];
          out.push([apply(f, a), apply(f, b)]);
        }
      }
      return out;
    });
  }

  /**
   * Las 6 caras de cada pieza, con su normal. `axis`/`side` dicen qué cara es EN EL MARCO
   * DE LA PIEZA (la de +x local sigue siendo la de +x aunque la pieza esté girada); la
   * normal y las esquinas vienen en el espacio pedido.
   * @param {string} id @param {Space} [space] @returns {(Face & { piece: string })[]}
   */
  faces(id, space = 'world') {
    return this.piecesOf(id).flatMap((p) => {
      const f = this.toSpace(p.id, space, id);
      const h = p.size.map((s) => s / 2);
      /** @type {(Face & { piece: string })[]} */
      const out = [];
      for (let ax = 0; ax < 3; ax++) {
        const [u, v] = [0, 1, 2].filter((i) => i !== ax);
        for (const side of /** @type {(1 | -1)[]} */ ([1, -1])) {
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
            /** @type {Vec3} */ const q = [0, 0, 0];
            q[ax] = side * h[ax];
            q[u] = a * h[u];
            q[v] = b * h[v];
            return apply(f, q);
          });
          /** @type {Vec3} */ const n = [0, 0, 0];
          n[ax] = side;
          /** @type {Vec3} */ const c = [0, 0, 0];
          c[ax] = side * h[ax];
          out.push({ piece: p.id, axis: /** @type {0 | 1 | 2} */ (ax), side, normal: rotate(f.r, n), corners, center: apply(f, c) });
        }
      }
      return out;
    });
  }

  /**
   * Largo, ancho y espesor de una pieza. Salen de su definición, así que girarla no los
   * cambia nunca: un larguero sigue teniendo el largo que tenía, esté como esté.
   * @param {string} id
   */
  dims(id) {
    const p = this.piece(id);
    return { length: p.size[p.axes.length], width: p.size[p.axes.width], thickness: p.size[p.axes.thickness] };
  }

  /** ¿Todos los marcos, hasta el mundo, son cuartos de vuelta? Entonces la caja en el mundo es la pieza exacta. @param {string} id */
  isAxisAligned(id) {
    return isQuarterTurn(this.worldFrame(id).r);
  }

  // ---------- crear ----------

  /** @param {'piece' | 'assembly'} kind */
  nextId(kind) {
    this.counters[kind]++;
    return `${kind === 'piece' ? 'P' : 'E'}-${this.counters[kind]}`;
  }

  /**
   * @param {{ name?: string, size: Vec3, material?: string, shape?: object | null,
   *           at?: Vec3, axes?: Axes, parent?: string | null }} spec
   *   `at`: dónde queda su centro, en el espacio del padre (el mundo si no tiene).
   * @returns {string} el id
   */
  addPiece({ name, size, material = 'pino', shape = null, at = [0, 0, 0], axes, parent = null }) {
    if (!Array.isArray(size) || size.length !== 3 || size.some((s) => !(s > 0))) {
      throw new Error(`medidas inválidas: ${JSON.stringify(size)} (van tres números > 0, en cm)`);
    }
    const id = this.nextId('piece');
    /** @type {PieceDef} */
    const p = {
      kind: 'piece', id, name: name || `Pieza ${this.counters.piece}`, parent: null,
      frame: frame(at), size: [...size], axes: axes ? { ...axes } : axesBySize(size),
      material, shape: shape ? clone(shape) : null,
    };
    this.parts.set(id, p);
    if (parent) this.adopt(parent, [id], { keepWorld: false });
    this.emit('add', [id]);
    return id;
  }

  /**
   * Junta partes hermanas en un ensamble nuevo. Si alguna ya es un ensamble, queda
   * ADENTRO del nuevo: se anida, no se aplasta. El origen del ensamble queda en el centro
   * de lo que junta, así girarlo gira alrededor de su centro. Nada cambia de lugar.
   * @param {string[]} ids @param {{ name?: string }} [opts] @returns {string}
   */
  assemble(ids, { name } = {}) {
    if (!ids.length) throw new Error('no hay nada para ensamblar');
    const parts = ids.map((id) => this.get(id));
    const parent = parts[0].parent;
    if (parts.some((p) => p.parent !== parent)) {
      throw new Error('solo se ensamblan partes hermanas (que estén en el mismo ensamble, o sueltas)');
    }
    // el centro de lo que se junta, en el espacio del padre
    const pw = this.parentWorld(parent);
    const pts = ids.flatMap((id) => this.positions(id, 'world')).map((q) => apply(invert(pw), q));
    const center = /** @type {Vec3} */ ([0, 1, 2].map((k) => (Math.min(...pts.map((q) => q[k])) + Math.max(...pts.map((q) => q[k]))) / 2));
    const id = this.nextId('assembly');
    /** @type {AssemblyDef} */
    const a = { kind: 'assembly', id, name: name || `Ensamble ${this.counters.assembly}`, parent, frame: frame(center), children: [] };
    this.parts.set(id, a);
    if (parent) {
      const pa = /** @type {AssemblyDef} */ (this.get(parent));
      pa.children = pa.children.filter((c) => !ids.includes(c));
      pa.children.push(id);
    }
    this.adopt(id, ids, { keepWorld: true });
    this.emit('assemble', [id, ...ids]);
    return id;
  }

  /**
   * Mueve partes adentro de un ensamble. Con keepWorld no se mueven en el mundo: su marco
   * se re-expresa respecto del nuevo padre.
   * @param {string} parentId @param {string[]} ids @param {{ keepWorld: boolean }} opts
   */
  adopt(parentId, ids, { keepWorld }) {
    const pa = this.get(parentId);
    if (pa.kind !== 'assembly') throw new Error(`${parentId} no es un ensamble`);
    const inv = invert(this.worldFrame(parentId));
    for (const id of ids) {
      if (this.subtree(id).includes(parentId)) throw new Error(`${id} no puede quedar adentro de sí mismo`);
      const p = this.get(id);
      const w = this.worldFrame(id);
      p.frame = keepWorld ? compose(inv, w) : p.frame;
      p.parent = parentId;
      if (!pa.children.includes(id)) pa.children.push(id);
    }
  }

  /** Deshace un ensamble: sus hijos pasan al padre, en el mismo lugar. @param {string} id */
  disassemble(id) {
    const a = this.get(id);
    if (a.kind !== 'assembly') throw new Error(`${id} no es un ensamble`);
    const kids = [...a.children];
    for (const k of kids) {
      const p = this.get(k);
      p.frame = compose(a.frame, p.frame);
      p.parent = a.parent;
    }
    if (a.parent) {
      const pa = /** @type {AssemblyDef} */ (this.get(a.parent));
      pa.children = pa.children.flatMap((c) => (c === id ? kids : [c]));
    }
    this.parts.delete(id);
    this.emit('disassemble', [id, ...kids]);
    return kids;
  }

  /** Borra una parte y todo lo que cuelga de ella. @param {string} id */
  remove(id) {
    const p = this.get(id);
    const ids = this.subtree(id);
    if (p.parent) {
      const pa = /** @type {AssemblyDef} */ (this.get(p.parent));
      pa.children = pa.children.filter((c) => c !== id);
    }
    for (const k of ids) this.parts.delete(k);
    this.emit('remove', ids);
  }

  // ---------- colocar: solo tocan marcos, nunca una definición ----------

  /** Corre la parte `delta` cm, medido en el mundo. @param {string} id @param {Vec3} delta */
  move(id, delta) {
    const p = this.get(id);
    const d = rotate(transpose3(this.parentWorld(p.parent).r), delta); // al espacio del padre
    p.frame = { r: p.frame.r, t: [p.frame.t[0] + d[0], p.frame.t[1] + d[1], p.frame.t[2] + d[2]] };
    this.emit('move', this.subtree(id));
  }

  /** Lleva el centro de la caja de la parte a `point`, en el mundo. @param {string} id @param {Vec3} point */
  moveTo(id, point) {
    const c = this.box(id, 'world').center;
    this.move(id, [point[0] - c[0], point[1] - c[1], point[2] - c[2]]);
  }

  /**
   * Gira la parte `deg` grados.
   *   axis: 'x' | 'y' | 'z' del mundo, o un vector del mundo.
   *   local: true → el eje es uno de los de la PIEZA (girar sobre su propio largo, p. ej.).
   *   pivot: 'center' (el centro de su caja, por defecto), 'origin' (su origen) o un punto
   *          del mundo.
   * @param {string} id @param {Axis | Vec3} axis @param {number} deg
   * @param {{ pivot?: 'center' | 'origin' | Vec3, local?: boolean }} [opts]
   */
  rotate(id, axis, deg, { pivot = 'center', local = false } = {}) {
    const p = this.get(id);
    const w = this.worldFrame(id);
    /** @type {Axis | Vec3} */
    let ax = axis;
    if (local) {
      if (Array.isArray(axis)) throw new Error('con local: true el eje va como x, y o z de la pieza');
      const k = axisIndex(axis);
      ax = [w.r[k], w.r[3 + k], w.r[6 + k]]; // la columna k: el eje local, visto desde el mundo
    }
    const pv = pivot === 'center' ? this.box(id, 'world').center : pivot === 'origin' ? w.t : pivot;
    const w2 = turn(w, ax, deg, pv);
    p.frame = compose(invert(this.parentWorld(p.parent)), w2);
    this.emit('rotate', this.subtree(id));
  }

  /**
   * Aplica una transformación rígida, expresada en el MUNDO, a una parte. Es el verbo del
   * que salen todos los demás: mover y girar son transformaciones. Solo cambia el marco.
   * @param {string} id @param {Frame} T
   */
  transform(id, T) {
    const p = this.get(id);
    p.frame = compose(invert(this.parentWorld(p.parent)), compose(T, this.worldFrame(id)));
    this.emit('transform', this.subtree(id));
  }

  /** @param {string} id @param {string} name */
  rename(id, name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('el nombre no puede estar vacío');
    this.get(id).name = name.trim();
    this.emit('rename', [id]);
  }

  /** @param {string} id @param {string} material */
  setMaterial(id, material) {
    this.piece(id).material = material;
    this.emit('material', [id]);
  }

  /**
   * Cambia las medidas de una pieza (en su marco local: x, y, z). No toca cuál eje es el
   * largo: un ancho que pasa al largo no da vuelta la pieza sola.
   * @param {string} id @param {Vec3} size
   */
  resize(id, size) {
    const p = this.piece(id);
    if (size.length !== 3 || size.some((s) => !(s > 0))) throw new Error(`medidas inválidas: ${JSON.stringify(size)}`);
    p.size = [...size];
    this.emit('resize', [id]);
  }

  /**
   * Copia la parte con todo lo que cuelga de ella —marcos, giros, ensambles adentro— en
   * el mismo lugar y bajo el mismo padre. Como el giro vive en el marco y no en las
   * medidas, la copia sale exactamente igual: no hay nada que reconstruir.
   * @param {string} id @returns {string} el id de la copia
   */
  duplicate(id) {
    /** @type {(srcId: string, parent: string | null) => string} */
    const copy = (srcId, parent) => {
      const src = this.get(srcId);
      const nid = this.nextId(src.kind);
      const n = clone(src);
      n.id = nid;
      n.parent = parent;
      if (n.kind === 'assembly') n.children = [];
      this.parts.set(nid, n);
      if (src.kind === 'assembly') n.children = src.children.map((c) => copy(c, nid));
      return nid;
    };
    const src = this.get(id);
    const nid = copy(id, src.parent);
    if (src.parent) /** @type {AssemblyDef} */ (this.get(src.parent)).children.push(nid);
    this.emit('add', this.subtree(nid));
    return nid;
  }

  // ---------- guardar ----------

  toJSON() {
    return { version: 1, counters: { ...this.counters }, parts: [...this.parts.values()].map(clone) };
  }

  /** @param {{ counters: Record<string, number>, parts: PartDef[] }} data */
  load(data) {
    const ids = [...this.parts.keys()];
    this.parts = new Map(data.parts.map((p) => [p.id, clone(p)]));
    this.counters = { ...data.counters };
    this.emit('load', [...ids, ...this.parts.keys()]);
  }

  /** El árbol como texto, para la consola. @param {string | null} [id] @param {number} [depth] @returns {string} */
  tree(id = null, depth = 0) {
    const pad = '  '.repeat(depth);
    if (id === null) return this.roots().map((p) => this.tree(p.id, 0)).join('\n');
    const p = this.get(id);
    const f = this.worldFrame(id);
    const giro = isQuarterTurn(f.r) ? (f.r.join() === '1,0,0,0,1,0,0,0,1' ? '' : ' ⟳90°') : ' ⟳';
    if (p.kind === 'piece') {
      const d = this.dims(id);
      return `${pad}▭ ${p.id} ${p.name}  ${d.length} × ${d.width} × ${d.thickness} ${p.material}${giro}`;
    }
    return [`${pad}▣ ${p.id} ${p.name}${giro}`, ...p.children.map((c) => this.tree(c, depth + 1))].join('\n');
  }
}
