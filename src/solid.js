// La forma de una pieza: su bruto y, encima, sus operaciones.
//
// La pieza ES su bruto (hoy, una caja de sus medidas): es lo que se compra y se corta, lo que
// da `dims`, la caja y el contacto. Encima lleva una lista ordenada de operaciones, que son
// datos puros y se guardan con el documento. La forma que resulta es un CÁLCULO: no se
// guarda, se deriva cuando se pide y se cachea mientras la definición no cambie.
//
// Las operaciones sobreviven a estirar la pieza porque sus posiciones van normalizadas (de 0 a
// 1 sobre el bruto); lo que no se estira (el diámetro de un agujero) va en la unidad del
// documento.
//
//   { kind: 'cut', axis, outline }   la pieza se queda con lo que cae adentro del contorno,
//                                    que la atraviesa a lo largo de `axis` (0, 1, 2 = x, y, z
//                                    locales). `outline`: puntos [u, v] de 0 a 1 sobre los
//                                    otros dos ejes, en orden (axis 0 → y, z; 1 → x, z; 2 → x, y).
//   { kind: 'hole', axis, side, at, diameter, depth? }
//                                    un agujero que entra por la cara `side` (1 o -1) de `axis`,
//                                    en `at` = [u, v] de 0 a 1 sobre esa cara; sin `depth`, pasante.
//
// Lo que se resuelve en 2D lo calcula el SDK: sin operaciones, la caja; con un solo corte, la
// extrusión del contorno. Combinar sólidos en 3D (varios cortes, agujeros) es otra cosa: eso lo
// hace un KERNEL que la app inyecta (`createWorkshop({ kernel: { intersect, subtract } })`),
// así three-bvh-csg, manifold o el que sea quedan afuera de `src/`.
//
// Puro: no importa three ni DOM.
import { Mesh } from './geometry.js';

/** @typedef {import('./frame.js').Vec3} Vec3 */
/** @typedef {[number, number]} Vec2 */
/** @typedef {{ kind: 'cut', axis: 0 | 1 | 2, outline: Vec2[] }} CutOperation */
/** @typedef {{ kind: 'hole', axis: 0 | 1 | 2, side: 1 | -1, at: Vec2, diameter: number, depth?: number }} HoleOperation */
/** @typedef {CutOperation | HoleOperation} OperationSpec */
/** Una operación guardada: la de arriba, con su id dentro de la pieza. @typedef {OperationSpec & { id: string }} Operation */
/**
 * Lo que combina sólidos en 3D. Recibe y devuelve mallas en el marco local de la pieza; puede
 * devolver una `Mesh` o cualquier `{ positions, indices }`.
 * @typedef {{ intersect: (a: Mesh, b: Mesh) => { positions: ArrayLike<number>, indices: ArrayLike<number> },
 *             subtract: (a: Mesh, b: Mesh) => { positions: ArrayLike<number>, indices: ArrayLike<number> } }} Kernel
 */

/** Las operaciones que el SDK sabe hacer. */
export const OPERATION_KINDS = Object.freeze(['cut', 'hole']);

/** Cuántos lados tiene el polígono con que se aproxima un círculo (un agujero). */
const LADOS_CIRCULO = 32;
/** Cuánto (en proporción del largo de la pieza) sobresale una herramienta, para que el kernel no tenga caras coplanares. */
const SOBRANTE = 0.01;

/** Los otros dos ejes, en orden: el plano del contorno. @param {0 | 1 | 2} axis @returns {[0 | 1 | 2, 0 | 1 | 2]} */
const plano = (axis) => /** @type {[0 | 1 | 2, 0 | 1 | 2]} */ ([0, 1, 2].filter((k) => k !== axis));

// ---------- validar ----------

/** @param {unknown} n @param {string} que */
const num = (n, que) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError(`${que} inválido: ${String(n)} (va un número)`);
  return n;
};
/** @param {unknown} a */
const eje = (a) => {
  if (a !== 0 && a !== 1 && a !== 2) throw new TypeError(`eje inválido: ${String(a)} (va 0, 1 o 2: x, y o z de la pieza)`);
  return /** @type {0 | 1 | 2} */ (a);
};
/** @param {unknown} p @param {string} que @returns {Vec2} */
const punto01 = (p, que) => {
  if (!Array.isArray(p) || p.length !== 2) throw new TypeError(`${que} inválido: ${JSON.stringify(p)} (va [u, v])`);
  const [u, v] = [num(p[0], que), num(p[1], que)];
  if (u < 0 || u > 1 || v < 0 || v > 1) throw new RangeError(`${que} inválido: ${JSON.stringify(p)} (va normalizado: de 0 a 1 sobre el bruto)`);
  return [u, v];
};

/** Área con signo (positiva si va antihorario). @param {Vec2[]} poly */
function areaCon(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** ¿Se cortan los segmentos ab y cd (sin contar las puntas que comparten)? @param {Vec2} a @param {Vec2} b @param {Vec2} c @param {Vec2} d */
function secantes(a, b, c, d) {
  /** @param {Vec2} p @param {Vec2} q @param {Vec2} r */
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * Revisa una operación y la devuelve limpia (solo sus campos). Falla con un mensaje que dice
 * qué está mal.
 * @param {unknown} op @returns {OperationSpec}
 */
export function checkOperation(op) {
  if (!op || typeof op !== 'object') throw new TypeError(`operación inválida: va un objeto con kind (${OPERATION_KINDS.join(', ')})`);
  const o = /** @type {Record<string, unknown>} */ (op);
  if (o.kind === 'cut') {
    const axis = eje(o.axis);
    if (!Array.isArray(o.outline) || o.outline.length < 3) throw new TypeError('contorno inválido: van al menos 3 puntos [u, v]');
    const outline = o.outline.map((p, i) => punto01(p, `punto ${i} del contorno`));
    if (Math.abs(areaCon(outline)) < 1e-9) throw new RangeError('contorno inválido: no encierra área');
    const n = outline.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (secantes(outline[i], outline[(i + 1) % n], outline[j], outline[(j + 1) % n])) throw new RangeError('contorno inválido: se cruza consigo mismo');
    }
    return { kind: 'cut', axis, outline };
  }
  if (o.kind === 'hole') {
    const axis = eje(o.axis);
    if (o.side !== 1 && o.side !== -1) throw new TypeError(`lado inválido: ${String(o.side)} (va 1 o -1: la cara por donde entra)`);
    const at = punto01(o.at, 'at');
    const diameter = num(o.diameter, 'diámetro');
    if (diameter <= 0) throw new RangeError(`diámetro inválido: ${diameter} (va mayor que 0)`);
    /** @type {HoleOperation} */
    const out = { kind: 'hole', axis, side: o.side, at, diameter };
    if (o.depth !== undefined) {
      const depth = num(o.depth, 'profundidad');
      if (depth <= 0) throw new RangeError(`profundidad inválida: ${depth} (va mayor que 0; sin depth, el agujero es pasante)`);
      out.depth = depth;
    }
    return out;
  }
  throw new TypeError(`operación desconocida: ${String(o.kind)} (van ${OPERATION_KINDS.join(', ')})`);
}

/** @param {unknown} k @returns {Kernel} */
export function checkKernel(k) {
  const o = /** @type {Record<string, unknown>} */ (k);
  if (!o || typeof o.intersect !== 'function' || typeof o.subtract !== 'function') {
    throw new TypeError('kernel inválido: va un objeto con intersect(a, b) y subtract(a, b), que reciben y devuelven mallas');
  }
  return /** @type {Kernel} */ (k);
}

// ---------- mallas ----------

/** ¿p está adentro (o en el borde) del triángulo abc? @param {Vec2} p @param {Vec2} a @param {Vec2} b @param {Vec2} c */
function enTriangulo(p, a, b, c) {
  /** @param {Vec2} u @param {Vec2} v @param {Vec2} w */
  const cr = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  return cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0;
}

/**
 * Triangula un polígono simple que va antihorario (recorte de orejas).
 * @param {Vec2[]} poly @returns {[number, number, number][]}
 */
function triangular(poly) {
  const idx = poly.map((_, i) => i);
  /** @type {[number, number, number][]} */
  const out = [];
  while (idx.length > 3) {
    let corte = -1;
    for (let i = 0; i < idx.length && corte < 0; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      const [pa, pb, pc] = [poly[a], poly[b], poly[c]];
      if ((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) <= 0) continue; // cóncavo o alineado
      if (idx.some((j) => j !== a && j !== b && j !== c && enTriangulo(poly[j], pa, pb, pc))) continue;
      corte = i;
      out.push([a, b, c]);
    }
    if (corte < 0) {
      // solo quedan vértices alineados: se saca uno, que no aporta área
      const i = idx.findIndex((b, k) => {
        const pa = poly[idx[(k + idx.length - 1) % idx.length]], pb = poly[b], pc = poly[idx[(k + 1) % idx.length]];
        return Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])) < 1e-12;
      });
      if (i < 0) throw new Error('contorno inválido: no se puede triangular');
      idx.splice(i, 1);
    } else idx.splice(corte, 1);
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/**
 * El prisma de un polígono (en el plano de `axis`) entre `desde` y `hasta` a lo largo de
 * `axis`. Cada cara tiene sus propios vértices, así las normales salen planas.
 * @param {Vec2[]} poly @param {0 | 1 | 2} axis @param {number} desde @param {number} hasta
 */
export function prism(poly, axis, desde, hasta) {
  const ccw = areaCon(poly) >= 0 ? poly : [...poly].reverse();
  const [u, v] = plano(axis);
  /** @param {Vec2} q @param {number} w @returns {Vec3} */
  const en3 = (q, w) => {
    const p = /** @type {Vec3} */ ([0, 0, 0]);
    p[u] = q[0];
    p[v] = q[1];
    p[axis] = w;
    return p;
  };
  /** @type {number[]} */ const pos = [];
  /** @type {number[]} */ const ix = [];
  /** @param {Vec3[]} vs @param {[number, number, number][]} tris */
  const cara = (vs, tris) => { const b = pos.length / 3; for (const p of vs) pos.push(...p); for (const t of tris) ix.push(b + t[0], b + t[1], b + t[2]); };
  const tris = triangular(ccw);
  cara(ccw.map((q) => en3(q, hasta)), tris);                                        // tapa de arriba
  cara(ccw.map((q) => en3(q, desde)), tris.map(([a, b, c]) => [a, c, b]));          // tapa de abajo, al revés
  for (let i = 0; i < ccw.length; i++) {                                            // los costados
    const p = ccw[i], q = ccw[(i + 1) % ccw.length];
    cara([en3(p, desde), en3(q, desde), en3(q, hasta), en3(p, hasta)], /** @type {[number, number, number][]} */ ([[0, 1, 2], [0, 2, 3]]));
  }
  const m = new Mesh({ positions: pos, indices: ix });
  // con el eje y, (x, z, y) es un sistema izquierdo: todo queda al revés, y se da vuelta
  if (m.volume >= 0) return m;
  /** @type {number[]} */
  const vuelta = [];
  for (let k = 0; k < ix.length; k += 3) vuelta.push(ix[k], ix[k + 2], ix[k + 1]);
  return new Mesh({ positions: pos, indices: vuelta });
}

/** La caja de unas medidas, centrada en el origen. @param {Vec3} size */
export function boxMesh(size) {
  const [hx, hy] = [size[0] / 2, size[1] / 2];
  return prism([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]], 2, -size[2] / 2, size[2] / 2);
}

/** Un punto normalizado [u, v] llevado al plano de `axis` de una pieza de medidas `size`. @param {Vec2} p @param {0 | 1 | 2} axis @param {Vec3} size @returns {Vec2} */
const desnormalizar = (p, axis, size) => {
  const [u, v] = plano(axis);
  return [(p[0] - 0.5) * size[u], (p[1] - 0.5) * size[v]];
};

/**
 * El prisma de un corte, a lo largo de toda la pieza. `sobrante`: cuánto pasa de cada lado (0:
 * justo el largo de la pieza).
 * @param {Vec3} size @param {CutOperation} op @param {number} [sobrante]
 */
export function cutTool(size, op, sobrante = SOBRANTE * size[op.axis]) {
  const h = size[op.axis] / 2;
  return prism(op.outline.map((p) => desnormalizar(p, op.axis, size)), op.axis, -h - sobrante, h + sobrante);
}

/** El cilindro de un agujero: entra por su cara, hasta `depth` o de lado a lado. @param {Vec3} size @param {HoleOperation} op */
export function holeTool(size, op) {
  const h = size[op.axis] / 2, m = SOBRANTE * size[op.axis];
  const [cu, cv] = desnormalizar(op.at, op.axis, size);
  const r = op.diameter / 2;
  /** @type {Vec2[]} */
  const circulo = Array.from({ length: LADOS_CIRCULO }, (_, i) => {
    const a = (2 * Math.PI * i) / LADOS_CIRCULO;
    return [cu + r * Math.cos(a), cv + r * Math.sin(a)];
  });
  const cara = op.side * h;
  const fondo = op.depth === undefined ? -op.side * (h + m) : cara - op.side * op.depth;
  const afuera = cara + op.side * m;
  return prism(circulo, op.axis, Math.min(fondo, afuera), Math.max(fondo, afuera));
}

/**
 * La forma de una pieza, en su marco local: el bruto con sus operaciones.
 * @param {{ id: string, size: Vec3, shape: object | null, operations?: readonly Operation[] }} def
 * @param {Kernel | null} kernel
 * @returns {Mesh}
 */
export function solidOf(def, kernel) {
  if (def.shape) throw new Error(`${def.id}: su bruto tiene una forma (shape) que el SDK todavía no interpreta; la dibuja la app (geometryFor)`);
  const ops = def.operations ?? [];
  if (!ops.length) return boxMesh(def.size);
  if (ops.length === 1 && ops[0].kind === 'cut') return cutTool(def.size, ops[0], 0); // un solo corte: 2D, la extrusión del contorno
  if (!kernel) {
    throw new Error(`${def.id}: sus ${ops.length} operaciones combinan sólidos en 3D, y para eso hace falta un kernel: createWorkshop({ kernel: { intersect, subtract } })`);
  }
  let s = boxMesh(def.size);
  for (const op of ops) s = Mesh.from(op.kind === 'cut' ? kernel.intersect(s, cutTool(def.size, op)) : kernel.subtract(s, holeTool(def.size, op)));
  return s;
}
