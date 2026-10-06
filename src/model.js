// El modelo: un árbol de partes.
//
// Una PARTE es lo que se puede mover, girar, duplicar y meter en un ensamble. Hay tres:
//   - la PIEZA es una hoja: tiene lo fabricable (medidas, material, forma), definido en
//     su marco local, que no cambia al moverla ni al girarla.
//   - el ENSAMBLE es un nodo: no tiene nada fabricable propio, compone. Su caja sale de
//     sus hijos. Y como es una parte más, se puede meter en otro ensamble — un mueble es
//     un ensamble de cuerpo, puerta y cajón, que a su vez son ensambles.
//   - la INSTANCIA es la misma pieza o el mismo ensamble colocado otra vez (lo que en Rhino
//     es un Block, no una copia): guarda solo de quién es copia y su marco. Todo lo demás
//     (medidas, forma, lo de adentro) se lee de la fuente cada vez, así que editar la
//     fuente cambia todas sus instancias sin hacer nada más.
//
// Cada parte guarda su marco RESPECTO DE SU PADRE. El marco en el mundo se calcula
// subiendo por el árbol. Girar un ensamble es tocar UN marco: los hijos no se enteran,
// sus definiciones siguen intactas, y en el mundo giran con él.
//
// Toda la geometría se puede pedir en 'local' (el marco de la parte) o en 'world'.
//
// Lo que está adentro de una instancia no se guarda: se resuelve al pedirlo, con un id de
// camino (`I-1/P-2`: la pieza P-2 de la fuente, tal como queda dentro de la instancia I-1).
// Esas piezas "virtuales" se leen como cualquier otra (vértices, contacto), pero no se
// pueden cambiar por separado: se cambia la fuente, o se suelta la instancia (`detach`).
//
// Este módulo no importa nada de three ni del DOM: corre en Node y lo puede usar el
// servidor. Lo prueba test/sdk.test.mjs.
import { frame, compose, invert, apply, rotate, turn, transpose3, isQuarterTurn, axisIndex } from './frame.js';

/** @typedef {import('./frame.js').Vec3} Vec3 */
/** @typedef {import('./frame.js').Mat3} Mat3 */
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
 * @property {object | null} shape  forma (perfil, torneado, corte)
 * @property {string} [source]   solo en lo que sale de una instancia: la parte de la que es copia
 */
/**
 * @typedef {Object} AssemblyDef
 * @property {'assembly'} kind
 * @property {string} id
 * @property {string} name
 * @property {string | null} parent
 * @property {Frame} frame
 * @property {string[]} children
 * @property {string} [source]   solo en lo que sale de una instancia: la parte de la que es copia
 */
/**
 * Lo que se guarda de una instancia: de quién es copia (siempre una pieza o un ensamble
 * de verdad, nunca otra instancia) y dónde está colocada.
 * @typedef {Object} InstanceDef
 * @property {'instance'} kind
 * @property {string} id
 * @property {string} name
 * @property {string | null} parent
 * @property {Frame} frame
 * @property {string} source
 */
/** Lo que se ve de una parte: una pieza o un ensamble (una instancia se ve como lo que copia). @typedef {PieceDef | AssemblyDef} PartDef */
/** Lo que se guarda. @typedef {PieceDef | AssemblyDef | InstanceDef} StoredPart */

/** @typedef {{ min: Vec3, max: Vec3, size: Vec3, center: Vec3 }} Box */
/** @typedef {{ axis: 0 | 1 | 2, side: 1 | -1, normal: Vec3, corners: Vec3[], center: Vec3 }} Face */

/** Ejes por tamaño: el más largo es el largo, el más corto el espesor. @param {Vec3} size @returns {Axes} */
export function axesBySize(size) {
  const o = /** @type {(0 | 1 | 2)[]} */ ([0, 1, 2]).sort((a, b) => size[b] - size[a] || a - b);
  return { length: o[0], width: o[1], thickness: o[2] };
}

const clone = (/** @type {any} */ v) => JSON.parse(JSON.stringify(v));

const PREFIJO = /** @type {const} */ ({ piece: 'P', assembly: 'E', instance: 'I' });

/** @param {Axes} axes @returns {Axes} */
function checkAxes(axes) {
  const vals = [axes.length, axes.width, axes.thickness];
  if (!vals.every((v) => v === 0 || v === 1 || v === 2) || new Set(vals).size !== 3) {
    throw new Error(`ejes inválidos: ${JSON.stringify(axes)} (van length, width, thickness con 0, 1 y 2, sin repetir)`);
  }
  return { length: axes.length, width: axes.width, thickness: axes.thickness };
}

/**
 * Un documento que se carga no puede dejar una instancia sin fuente ni un conjunto que se
 * contenga a sí mismo (recorrerlo no terminaría nunca).
 * @param {Map<string, StoredPart>} parts
 */
function validate(parts) {
  for (const p of parts.values()) {
    if (p.kind !== 'instance') continue;
    const s = parts.get(p.source);
    if (!s || s.kind === 'instance') throw new Error(`documento inválido: ${p.id} es copia de ${p.source}, que no existe o es otra instancia`);
  }
  /** @type {Set<string>} */
  const listo = new Set();
  /** @param {string} id @param {string[]} camino */
  const visitar = (id, camino) => {
    if (camino.includes(id)) throw new Error(`documento inválido: ${[...camino, id].join(' → ')} queda adentro de sí mismo`);
    if (listo.has(id)) return;
    const p = parts.get(id);
    if (!p) return;
    const sig = p.kind === 'assembly' ? p.children : p.kind === 'instance' ? [p.source] : [];
    for (const s of sig) visitar(s, [...camino, id]);
    listo.add(id);
  };
  for (const id of parts.keys()) visitar(id, []);
}

export class Model {
  constructor() {
    /** @type {Map<string, StoredPart>} */
    this.parts = new Map();
    /** @type {Record<string, number>} */
    this.counters = { piece: 0, assembly: 0, instance: 0 };
    /** @type {Set<(ev: { type: string, ids: string[] }) => void>} */
    this.listeners = new Set();
  }

  // ---------- eventos: el visor (y mañana la interfaz) se cuelga de acá ----------

  /** @param {(ev: { type: string, ids: string[] }) => void} fn @returns {() => void} para desuscribirse */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Avisa qué cambió. Si lo que cambió es (o está adentro de) la fuente de una instancia, la
   * instancia cambió también: va en el aviso, con lo que tiene adentro.
   * @param {string} type @param {string[]} ids
   */
  emit(type, ids) {
    const todos = this.#conInstancias(ids);
    for (const fn of this.listeners) fn({ type, ids: todos });
  }

  /** @param {string[]} ids @returns {string[]} */
  #conInstancias(ids) {
    const insts = [...this.parts.values()].filter((p) => p.kind === 'instance');
    if (!insts.length) return ids;
    const out = new Set(ids);
    const tocadas = new Set(ids.filter((id) => this.parts.has(id)));
    /** @type {Set<string>} */
    const alcanzadas = new Set();
    for (let creció = true; creció;) {
      creció = false;
      // lo que, si es fuente de una instancia, la arrastra: lo tocado, lo que lo contiene,
      // y las instancias ya alcanzadas con lo que las contiene
      /** @type {Set<string>} */
      const alcance = new Set();
      for (const id of [...tocadas, ...alcanzadas]) {
        for (let p = this.parts.get(id); p; p = p.parent ? this.parts.get(p.parent) : undefined) alcance.add(p.id);
      }
      for (const i of insts) {
        if (i.kind === 'instance' && !alcanzadas.has(i.id) && alcance.has(i.source)) { alcanzadas.add(i.id); creció = true; }
      }
    }
    for (const id of alcanzadas) for (const x of this.subtree(id)) out.add(x);
    return [...out];
  }

  // ---------- leer ----------

  /**
   * Lo que se ve de una parte. Una instancia se ve como lo que copia (una pieza o un
   * ensamble) puesta en su lugar, y lo de adentro de una instancia se resuelve por su id de
   * camino. Es para leer: lo guardado, que es lo que se cambia, está en `own`.
   * @param {string} id @returns {PartDef}
   */
  get(id) {
    const rec = this.parts.get(id);
    if (rec) return rec.kind === 'instance' ? this.#view(rec, id, rec.parent) : rec;
    const i = id.lastIndexOf('/');
    if (i < 0) throw new Error(`no existe la parte ${id}`);
    const parentId = id.slice(0, i);
    const parent = this.get(parentId);
    const src = this.parts.get(id.slice(i + 1));
    if (!src || parent.kind !== 'assembly' || !parent.children.includes(id)) throw new Error(`no existe la parte ${id}`);
    return this.#view(src, id, parentId);
  }

  /**
   * @param {StoredPart} rec lo guardado de lo que se copia
   * @param {string} id el id con que se ve (el de `rec`, o el de camino si es de adentro de una instancia)
   * @param {string | null} parent
   * @returns {PartDef}
   */
  #view(rec, id, parent) {
    const base = rec.kind === 'instance' ? this.#sourceOf(rec) : rec;
    const source = id !== rec.id ? rec.id : rec.kind === 'instance' ? rec.source : undefined;
    if (base.kind === 'piece') {
      return { kind: 'piece', id, name: rec.name, parent, frame: rec.frame, size: base.size, axes: base.axes, material: base.material, shape: base.shape, source };
    }
    const children = rec.kind === 'assembly' && id === rec.id ? rec.children : base.children.map((c) => `${id}/${c}`);
    return { kind: 'assembly', id, name: rec.name, parent, frame: rec.frame, children, source };
  }

  /** @param {InstanceDef} inst @returns {PieceDef | AssemblyDef} */
  #sourceOf(inst) {
    const s = this.parts.get(inst.source);
    if (!s || s.kind === 'instance') throw new Error(`${inst.id} es copia de ${inst.source}, que ya no existe`);
    return s;
  }

  /**
   * La parte tal como está guardada, que es lo que se cambia. Lo de adentro de una
   * instancia no se guarda, así que no hay nada que cambiar ahí.
   * @param {string} id @returns {StoredPart}
   */
  own(id) {
    const p = this.parts.get(id);
    if (p) return p;
    const raiz = id.split('/')[0];
    if (id.includes('/') && this.parts.has(raiz)) {
      throw new Error(`${id} es parte de la instancia ${raiz}: se cambia en su fuente, o se suelta la instancia con detach()`);
    }
    throw new Error(`no existe la parte ${id}`);
  }

  /** Una pieza guardada, para cambiarla. @param {string} id @returns {PieceDef} */
  ownPiece(id) {
    const p = this.own(id);
    if (p.kind === 'instance') throw new Error(`${id} es una instancia de ${p.source}: se cambia en su fuente, o se suelta con detach()`);
    if (p.kind !== 'piece') throw new Error(`${id} es un ensamble, no una pieza`);
    return p;
  }

  /** Un ensamble guardado, para cambiarlo. @param {string} id @returns {AssemblyDef} */
  ownAssembly(id) {
    const p = this.own(id);
    if (p.kind === 'instance') throw new Error(`${id} es una instancia: no puede contener partes (sueltala con detach())`);
    if (p.kind !== 'assembly') throw new Error(`${id} no es un ensamble`);
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

  /**
   * Todas las piezas del documento, con las de adentro de cada instancia (en el mundo, son
   * piezas como cualquier otra). En el orden en que se crearon.
   * @returns {PieceDef[]}
   */
  allPieces() {
    /** @type {PieceDef[]} */
    const out = [];
    for (const p of this.parts.values()) {
      if (p.kind === 'piece') out.push(p);
      else if (p.kind === 'instance') out.push(...this.piecesOf(p.id));
    }
    return out;
  }

  /** @param {string} id @returns {string[]} los ids del subárbol, la parte primero (con lo de adentro de las instancias) */
  subtree(id) {
    const p = this.get(id);
    return p.kind === 'piece' ? [id] : [id, ...p.children.flatMap((c) => this.subtree(c))];
  }

  /** @param {string} id @returns {string[]} los ids guardados del subárbol: sin lo que sale de resolver instancias */
  realSubtree(id) {
    const p = this.own(id);
    return p.kind === 'assembly' ? [id, ...p.children.flatMap((c) => this.realSubtree(c))] : [id];
  }

  /** Los ids de las instancias de una parte (las guardadas, no las de adentro de otra instancia). @param {string} id @returns {string[]} */
  instancesOf(id) {
    return [...this.parts.values()].filter((p) => p.kind === 'instance' && p.source === id).map((p) => p.id);
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

  /** @param {'piece' | 'assembly' | 'instance'} kind */
  nextId(kind) {
    this.counters[kind] = (this.counters[kind] ?? 0) + 1;
    return `${PREFIJO[kind]}-${this.counters[kind]}`;
  }

  /**
   * @param {{ name?: string, size: Vec3, material?: string, shape?: object | null,
   *           at?: Vec3, r?: Mat3, axes?: Axes, parent?: string | null }} spec
   *   `at`: dónde queda su centro, en el espacio del padre (el mundo si no tiene).
   *   `r`: su rotación inicial en ese mismo espacio (identidad si no se da), para crearla ya
   *   orientada en vez de crearla derecha y rotarla después.
   * @returns {string} el id
   */
  addPiece({ name, size, material = 'default', shape = null, at = [0, 0, 0], r, axes, parent = null }) {
    if (!Array.isArray(size) || size.length !== 3 || size.some((s) => !(s > 0))) {
      throw new Error(`medidas inválidas: ${JSON.stringify(size)} (van tres números > 0, en cm)`);
    }
    const id = this.nextId('piece');
    /** @type {PieceDef} */
    const p = {
      kind: 'piece', id, name: name || `Pieza ${this.counters.piece}`, parent: null,
      frame: frame(at, r), size: [...size], axes: axes ? checkAxes(axes) : axesBySize(size),
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
    const parts = ids.map((id) => this.own(id));
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
      const pa = this.ownAssembly(parent);
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
    const pa = this.ownAssembly(parentId);
    const inv = invert(this.worldFrame(parentId));
    for (const id of ids) {
      const p = this.own(id);
      if (this.#alcance(id).has(parentId)) throw new Error(`${id} no puede quedar adentro de sí mismo`);
      const w = this.worldFrame(id);
      p.frame = keepWorld ? compose(inv, w) : p.frame;
      p.parent = parentId;
      if (!pa.children.includes(id)) pa.children.push(id);
    }
  }

  /**
   * Todo lo guardado que forma parte de `id`: ella, lo que tiene adentro y, por cada
   * instancia, su fuente (con todo lo de la fuente). Si un contenedor está en el alcance de
   * una parte, ponerla ahí adentro la haría contenerse a sí misma.
   * @param {string} id @param {Set<string>} [visto] @returns {Set<string>}
   */
  #alcance(id, visto = new Set()) {
    if (visto.has(id)) return visto;
    visto.add(id);
    const p = this.parts.get(id);
    if (p?.kind === 'assembly') for (const c of p.children) this.#alcance(c, visto);
    else if (p?.kind === 'instance') this.#alcance(p.source, visto);
    return visto;
  }

  /**
   * No se puede dejar sin fuente a una instancia: quitar partes que son la fuente de
   * instancias que quedan afuera es un error, con el nombre de quién las usa.
   * @param {string[]} quitadas
   */
  #sinDependientes(quitadas) {
    const q = new Set(quitadas);
    const deps = [...this.parts.values()].filter((p) => p.kind === 'instance' && !q.has(p.id) && q.has(p.source));
    if (deps.length) {
      const fuentes = [...new Set(deps.map((d) => /** @type {InstanceDef} */ (d).source))];
      throw new Error(`${fuentes.join(', ')} es la fuente de ${deps.map((d) => d.id).join(', ')}: se sueltan (detach) o se borran las instancias antes`);
    }
  }

  /** Deshace un ensamble: sus hijos pasan al padre, en el mismo lugar. @param {string} id */
  disassemble(id) {
    const a = this.own(id);
    if (a.kind === 'instance') throw new Error(`${id} es una instancia: se suelta con detach() y después se deshace`);
    if (a.kind !== 'assembly') throw new Error(`${id} no es un ensamble`);
    this.#sinDependientes([id]);
    const kids = [...a.children];
    for (const k of kids) {
      const p = this.own(k);
      p.frame = compose(a.frame, p.frame);
      p.parent = a.parent;
    }
    if (a.parent) {
      const pa = this.ownAssembly(a.parent);
      pa.children = pa.children.flatMap((c) => (c === id ? kids : [c]));
    }
    this.parts.delete(id);
    this.emit('disassemble', [id, ...kids]);
    return kids;
  }

  /** Borra una parte y todo lo que cuelga de ella. @param {string} id */
  remove(id) {
    const p = this.own(id);
    const guardadas = this.realSubtree(id);
    this.#sinDependientes(guardadas);
    const ids = this.subtree(id);
    if (p.parent) {
      const pa = this.ownAssembly(p.parent);
      pa.children = pa.children.filter((c) => c !== id);
    }
    for (const k of guardadas) this.parts.delete(k);
    this.emit('remove', ids);
  }

  // ---------- instancias ----------

  /**
   * Una instancia de una pieza o de un ensamble: la misma parte colocada otra vez. Editar la
   * fuente se ve en todas sus instancias; la instancia solo tiene su lugar. Nace encima de
   * la fuente (en su mismo ensamble, si lo tiene), salvo que se diga otra cosa.
   * Instanciar una instancia da otra instancia de la misma fuente.
   * @param {string} srcId
   * @param {{ name?: string, parent?: string | null, placement?: Frame }} [opts]
   *   `parent`: el ensamble donde queda (el de la fuente si no se dice; null: suelta).
   *   `placement`: una transformación rígida, en el mundo, que se le aplica a la colocación
   *   de la fuente (la instancia queda movida y girada por ella).
   * @returns {string} el id de la instancia
   */
  instantiate(srcId, { name, parent, placement } = {}) {
    const src = this.own(srcId);
    const base = src.kind === 'instance' ? this.#sourceOf(src) : src;
    const dest = parent === undefined ? src.parent : parent;
    if (dest !== null) {
      this.ownAssembly(dest);
      if (this.#alcance(base.id).has(dest)) throw new Error(`no se puede instanciar ${base.id} adentro de ${dest}: quedaría adentro de sí misma`);
    }
    const mundo = this.worldFrame(srcId);
    const id = this.nextId('instance');
    /** @type {InstanceDef} */
    const inst = {
      kind: 'instance', id, name: name || src.name, parent: dest,
      frame: compose(invert(this.parentWorld(dest)), placement ? compose(placement, mundo) : mundo),
      source: base.id,
    };
    this.parts.set(id, inst);
    if (dest) this.ownAssembly(dest).children.push(id);
    this.emit('add', [id]);
    return id;
  }

  /**
   * Suelta una instancia: pasa a ser una pieza o un ensamble de verdad, copia de lo que era
   * su fuente, que ya no la sigue. Conserva su id (la app guarda ids) y su lugar. Lo de
   * adentro, si es un ensamble, son partes nuevas.
   * @param {string} id
   */
  detach(id) {
    const inst = this.own(id);
    if (inst.kind !== 'instance') throw new Error(`${id} no es una instancia`);
    const src = this.#sourceOf(inst);
    const antes = this.subtree(id);
    if (src.kind === 'piece') {
      /** @type {PieceDef} */
      const real = {
        kind: 'piece', id, name: inst.name, parent: inst.parent, frame: clone(inst.frame),
        size: [...src.size], axes: { ...src.axes }, material: src.material, shape: src.shape ? clone(src.shape) : null,
      };
      this.parts.set(id, real);
    } else {
      /** @type {AssemblyDef} */
      const real = { kind: 'assembly', id, name: inst.name, parent: inst.parent, frame: clone(inst.frame), children: [] };
      this.parts.set(id, real);
      /** @type {Map<string, string>} */
      const copias = new Map();
      real.children = src.children.map((c) => this.#copiar(c, id, copias));
      this.#remapear(copias);
    }
    this.emit('detach', [...new Set([...antes, ...this.subtree(id)])]);
  }

  // ---------- colocar: solo tocan marcos, nunca una definición ----------

  /** Corre la parte `delta` cm, medido en el mundo. @param {string} id @param {Vec3} delta */
  move(id, delta) {
    const p = this.own(id);
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
    const p = this.own(id);
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
    const p = this.own(id);
    p.frame = compose(invert(this.parentWorld(p.parent)), compose(T, this.worldFrame(id)));
    this.emit('transform', this.subtree(id));
  }

  /** @param {string} id @param {string} name */
  rename(id, name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('el nombre no puede estar vacío');
    this.own(id).name = name.trim();
    this.emit('rename', [id]);
  }

  /** @param {string} id @param {string} material */
  setMaterial(id, material) {
    this.ownPiece(id).material = material;
    this.emit('material', [id]);
  }

  /**
   * Cambia las medidas de una pieza (en su marco local: x, y, z). No toca cuál eje es el
   * largo: un ancho que pasa al largo no da vuelta la pieza sola.
   * @param {string} id @param {Vec3} size
   */
  resize(id, size) {
    const p = this.ownPiece(id);
    if (size.length !== 3 || size.some((s) => !(s > 0))) throw new Error(`medidas inválidas: ${JSON.stringify(size)}`);
    p.size = [...size];
    this.emit('resize', [id]);
  }

  /**
   * Copia real de lo guardado en `srcId` y de todo lo que cuelga de ello, bajo `parent`.
   * @param {string} srcId @param {string | null} parent @param {Map<string, string>} copias viejo → nuevo
   * @returns {string}
   */
  #copiar(srcId, parent, copias) {
    const src = this.own(srcId);
    const nid = this.nextId(src.kind);
    /** @type {any} */
    const n = clone(src);
    n.id = nid;
    n.parent = parent;
    if (n.kind === 'assembly') n.children = [];
    this.parts.set(nid, n);
    copias.set(srcId, nid);
    if (src.kind === 'assembly') n.children = src.children.map((c) => this.#copiar(c, nid, copias));
    return nid;
  }

  /** Una instancia copiada cuya fuente también se copió mira a la copia: lo copiado se basta a sí mismo. @param {Map<string, string>} copias */
  #remapear(copias) {
    for (const nid of copias.values()) {
      const n = this.parts.get(nid);
      if (n?.kind === 'instance' && copias.has(n.source)) n.source = /** @type {string} */ (copias.get(n.source));
    }
  }

  /**
   * Copia la parte con todo lo que cuelga de ella —marcos, giros, ensambles adentro— en
   * el mismo lugar y bajo el mismo padre. Como el giro vive en el marco y no en las
   * medidas, la copia sale exactamente igual: no hay nada que reconstruir. La copia es
   * independiente de la original (para que sigan a la original, se instancia). Copiar una
   * instancia da otra instancia de la misma fuente.
   * @param {string} id @returns {string} el id de la copia
   */
  duplicate(id) {
    const src = this.own(id);
    /** @type {Map<string, string>} */
    const copias = new Map();
    const nid = this.#copiar(id, src.parent, copias);
    this.#remapear(copias);
    if (src.parent) this.ownAssembly(src.parent).children.push(nid);
    this.emit('add', this.subtree(nid));
    return nid;
  }

  // ---------- guardar ----------

  toJSON() {
    return { version: 2, counters: { ...this.counters }, parts: [...this.parts.values()].map(clone) };
  }

  /** @param {{ counters: Record<string, number>, parts: StoredPart[] }} data */
  load(data) {
    const parts = new Map(data.parts.map((p) => [p.id, /** @type {StoredPart} */ (clone(p))]));
    validate(parts);
    const ids = [...this.parts.keys()];
    this.parts = parts;
    this.counters = { piece: 0, assembly: 0, instance: 0, ...data.counters };
    this.emit('load', [...ids, ...this.parts.keys()]);
  }

  /** El árbol como texto, para la consola. @param {string | null} [id] @param {number} [depth] @returns {string} */
  tree(id = null, depth = 0) {
    const pad = '  '.repeat(depth);
    if (id === null) return this.roots().map((p) => this.tree(p.id, 0)).join('\n');
    const p = this.get(id);
    const f = this.worldFrame(id);
    const giro = isQuarterTurn(f.r) ? (f.r.join() === '1,0,0,0,1,0,0,0,1' ? '' : ' ⟳90°') : ' ⟳';
    const copia = this.parts.get(id)?.kind === 'instance' ? ` ⧉ ${p.source}` : '';
    if (p.kind === 'piece') {
      const d = this.dims(id);
      return `${pad}▭ ${p.id} ${p.name}  ${d.length} × ${d.width} × ${d.thickness} ${p.material}${giro}${copia}`;
    }
    // lo de adentro de una instancia es el de su fuente: no se repite
    const hijos = copia ? [] : p.children.map((c) => this.tree(c, depth + 1));
    return [`${pad}▣ ${p.id} ${p.name}${giro}${copia}`, ...hijos].join('\n');
  }
}
