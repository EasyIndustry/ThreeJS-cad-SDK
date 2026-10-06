// Pruebas del SDK, sin navegador.
//
//   node --test
//
// Las primeras reproducen, tal cual se contaron, los dos bugs que motivaron el SDK:
//   1. girar con el gizmo un ensamble de largueros les reescribía la forma y las medidas
//      (en el modelo viejo girar 90° permutaba size/dims/shape en vez de guardar un giro);
//   2. un ensamble armado y girado no se podía repetir: se reconstruía de cero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkshop, Part, Piece, Assembly, Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection, WORKSHOP_MEMBERS,
} from '../src/index.js';
import { Model } from '../src/model.js';
import { memberNames } from '../src/help.js';
import * as F from '../src/frame.js';
// La convención de giro de referencia: Euler XYZ aplicado como Rx · Ry · Rz (primero Z,
// después Y, al final X), que es la de THREE.Euler 'XYZ' y la que usan las apps que guardan
// `rot` como Euler. Está acá escrita a mano, aparte del SDK, para que la prueba compare
// contra algo que no salió del mismo código.
function rotatePoint([x, y, z], [rx, ry, rz]) {
  let c = Math.cos(rz), s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rx); s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}

const cerca = (a, b, tol = 1e-9, msg = '') => {
  assert.equal(a.length, b.length, msg);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${msg} [${i}]: ${v} contra ${b[i]}`));
};
const pts = (list) => list.map((p) => p.toArray().map((v) => Math.round(v * 1e6) / 1e6).join(',')).sort();
const larguero = (t, center = [0, 0, 0]) => t.addPiece({ name: 'Larguero', size: [200, 4, 10], center });

// ---------- los dos bugs ----------

test('bug 1: girar un ensamble de largueros NO reescribe sus formas ni sus medidas', () => {
  const t = createWorkshop();
  const perfil = { kind: 'profile', profile: 'tubo-cuadrado', axis: 0, t: 0.16, rot: 0 };
  const a = t.addPiece({ name: 'Caño', size: [200, 4, 4], shape: perfil, center: [0, 2, 0] });
  const b = t.addPiece({ name: 'Caño', size: [200, 4, 4], shape: perfil, center: [0, 2, 40] });
  const definicion = (p) => JSON.stringify([p.size, p.shape, p.dims, p.material]);
  const antes = [definicion(a), definicion(b)];
  const e = t.assemble([a, b]);
  for (const [g, eje] of [[45, 'y'], [90, 'x'], [30, 'z'], [90, 'y'], [-17, 'x']]) {
    e.rotate(g, eje);
    assert.deepEqual([definicion(a), definicion(b)], antes, `después de girar ${g}° en ${eje}`);
  }
  assert.deepEqual(a.dims, { length: 200, width: 4, thickness: 4 });
});

test('bug 2: un ensamble armado y girado se duplica tal cual, sin reconstruir nada', () => {
  const t = createWorkshop();
  const a = larguero(t, [0, 5, 0]);
  const b = larguero(t, [0, 5, 50]);
  a.rotate(45, 'z');                      // un larguero a 45°, como en el caso real
  const e = t.assemble([a, b]);
  e.rotate(30, 'y');
  const copia = e.duplicate();
  assert.ok(copia instanceof Assembly);
  assert.notEqual(copia.id, e.id);
  assert.equal(copia.children.length, 2);
  assert.deepEqual(pts(copia.vertices), pts(e.vertices), 'la copia nace exactamente encima, con los mismos giros');
  const antes = pts(e.vertices);
  copia.move([300, 0, 0]);
  assert.deepEqual(pts(e.vertices), antes, 'y es independiente: mover la copia no mueve el original');
  cerca([copia.boundingBox.center.x - e.boundingBox.center.x], [300]);
});

// ---------- la API como la pensamos: propiedades, valores de solo lectura ----------

test('cubo.vertices, cubo.faces, vertices[0].x: propiedades que devuelven valores', () => {
  const t = createWorkshop();
  const cubo = t.addPiece({ size: [10, 20, 30], center: [100, 0, 0] });
  assert.equal(cubo.vertices.length, 8);
  assert.ok(cubo.vertices[0] instanceof Point3d);
  assert.equal(cubo.vertices[0].x, 95);
  assert.equal(cubo.edges.length, 12);
  assert.ok(cubo.edges[0] instanceof Line);
  assert.equal(cubo.faces.length, 6);
  assert.ok(cubo.faces[0] instanceof Face);
  assert.ok(cubo.boundingBox instanceof BoundingBox);
  assert.deepEqual(cubo.boundingBox.diagonal.toArray(), [10, 20, 30]);
  // y en local, su propio marco: centrada en el origen
  assert.deepEqual(cubo.local.boundingBox.center.toArray(), [0, 0, 0]);
});

test('lo consultado es de solo lectura: no se puede editar una pieza por la espalda', () => {
  const t = createWorkshop();
  const cubo = t.addPiece({ size: [10, 20, 30] });
  const v = cubo.vertices;
  assert.throws(() => { v[0].x = 99; }, TypeError);
  assert.throws(() => { v.push(new Point3d()); }, TypeError);
  assert.throws(() => { cubo.size.x = 99; }, TypeError);
  assert.throws(() => { cubo.dims.length = 99; }, TypeError);
  assert.throws(() => { cubo.faces[0].normal.x = 5; }, TypeError);
  assert.deepEqual(cubo.size, { x: 10, y: 20, z: 30 }, 'nada cambió');
});

test('mover de un punto a otro, como en Rhino: cubo.move(A, B)', () => {
  const t = createWorkshop();
  const cubo = t.addPiece({ size: [10, 10, 10] });
  const A = cubo.vertices[0];                  // una esquina
  const B = new Point3d(50, 0, 50);
  cubo.move(A, B);
  assert.ok(cubo.vertices.some((v) => v.equals(B)), 'la esquina A quedó en B');
  cubo.move(new Vector3d(0, 10, 0));           // y por un vector
  assert.equal(cubo.boundingBox.min.y, 10);
});

test('Transform es el verbo común: el mismo Transform sirve para puntos, vectores, piezas y ensambles', () => {
  const t = createWorkshop();
  const giro = Transform.rotation(90, 'z');
  assert.deepEqual(new Point3d(1, 0, 0).transform(giro).toArray(), [0, 1, 0]);
  assert.deepEqual(new Vector3d(1, 0, 0).transform(Transform.translation([5, 5, 5])).toArray(), [1, 0, 0], 'un vector no se traslada');
  const cubo = t.addPiece({ size: [10, 2, 2], center: [5, 0, 0] });
  cubo.transform(giro);
  assert.deepEqual(cubo.boundingBox.diagonal.toArray(), [2, 10, 2]);
  assert.deepEqual(cubo.boundingBox.center.toArray(), [0, 5, 0], 'giró alrededor del origen, no de su centro');
});

test('Transform.apply sobre un array: lo de adentro de un ensamble no se mueve dos veces', () => {
  const t = createWorkshop();
  const a = larguero(t, [0, 0, 0]);
  const b = larguero(t, [0, 0, 40]);
  const suelta = larguero(t, [0, 0, 80]);
  const e = t.assemble([a, b]);
  const c0 = a.boundingBox.center;
  const res = Transform.apply(Transform.translation([10, 0, 0]), [e, a, suelta, new Point3d(1, 1, 1)]);
  assert.equal(a.boundingBox.center.x - c0.x, 10, 'a se movió una vez, con su ensamble');
  assert.equal(suelta.boundingBox.center.x, 10);
  assert.deepEqual(res[3].toArray(), [11, 1, 1], 'los valores vuelven transformados');
  assert.equal(res[0], e, 'las partes vuelven tal cual (son las mismas)');
});

test('componer transformaciones: multiply aplica primero el de la derecha', () => {
  const mover = Transform.translation([10, 0, 0]);
  const girar = Transform.rotation(90, 'z');
  const p = new Point3d(0, 0, 0);
  assert.deepEqual(p.transform(girar.multiply(mover)).toArray(), [0, 10, 0], 'primero mover, después girar');
  assert.deepEqual(p.transform(mover.multiply(girar)).toArray(), [10, 0, 0], 'primero girar, después mover');
  const ida = Transform.rotation(37, [1, 2, 3], [5, 5, 5]).multiply(Transform.translation([3, -4, 7]));
  assert.ok(ida.multiply(ida.inverse()).isIdentity, 'con su inversa da la identidad');
  assert.ok(Transform.rotation(90, 'x').isQuarterTurn);
  assert.ok(!Transform.rotation(45, 'x').isQuarterTurn);
});

test('girar sobre una dirección propia de la pieza: rotate(90, p.directions.length)', () => {
  const t = createWorkshop();
  const a = larguero(t);
  a.rotate(90, 'z');                                   // el largo corre ahora sobre y del mundo
  assert.deepEqual(a.directions.length.toArray(), [0, 1, 0]);
  a.rotate(90, a.directions.length);                   // girar sobre su propio largo
  assert.deepEqual(a.boundingBox.diagonal.toArray(), [10, 200, 4]);
  assert.deepEqual(a.boundingBox.center.toArray(), [0, 0, 0], 'gira sobre su centro, no se corre');
  assert.deepEqual(a.dims, { length: 200, width: 10, thickness: 4 });
});

// ---------- local y mundo ----------

test('la geometría local de una pieza es su definición, exacta, gire como gire', () => {
  const t = createWorkshop();
  const a = larguero(t, [10, 20, 30]);
  a.rotate(37, 'z').rotate(113, 'x').move([5, -3, 2]);
  assert.deepEqual(a.local.boundingBox.diagonal.toArray(), [200, 4, 10]);
  assert.deepEqual(a.local.boundingBox.center.toArray(), [0, 0, 0]);
  assert.deepEqual(a.dims, { length: 200, width: 10, thickness: 4 });
  assert.notDeepEqual(a.boundingBox.diagonal.toArray(), [200, 4, 10], 'y en el mundo sí está girada');
});

test('un cuarto de vuelta da medidas exactas en el mundo, sin ruido', () => {
  const t = createWorkshop();
  const a = larguero(t);
  a.rotate(90, 'z');
  assert.deepEqual(a.boundingBox.diagonal.toArray(), [4, 200, 10]);
  assert.ok(a.placement.isQuarterTurn);
  a.rotate(90, 'x');
  assert.deepEqual(a.boundingBox.diagonal.toArray(), [4, 10, 200]);
  a.rotate(45, 'x');
  assert.ok(!a.placement.isQuarterTurn);
  assert.deepEqual(a.dims, { length: 200, width: 10, thickness: 4 }, 'el largo sigue siendo el largo');
});

test('las caras se identifican en la pieza y la normal sale en el mundo', () => {
  const t = createWorkshop();
  const a = larguero(t);
  a.rotate(90, 'z');
  const masX = a.faces.find((f) => f.localAxis === 'x' && f.localSide === 1);
  assert.deepEqual(masX.normal.toArray(), [0, 1, 0], 'la cara +x local mira a +y después de girar 90° en z');
  assert.deepEqual(masX.center.toArray(), [0, 100, 0]);
  assert.equal(masX.area, 4 * 10);
  assert.equal(masX.edges.length, 4);
});

// ---------- ensambles: un conjunto de partes con colocación propia ----------

test('ensamblar ensambles los ANIDA: no se aplastan en uno', () => {
  const t = createWorkshop();
  const cuerpo = t.assemble([larguero(t, [0, 0, 0]), larguero(t, [0, 0, 40])], { name: 'Cuerpo' });
  const puerta = t.assemble([larguero(t, [0, 50, 0]), larguero(t, [0, 50, 40])], { name: 'Puerta' });
  const mueble = t.assemble([cuerpo, puerta], { name: 'Mueble' });
  assert.deepEqual(mueble.children.map((c) => c.id), [cuerpo.id, puerta.id]);
  assert.equal(cuerpo.parent, mueble);
  assert.equal(mueble.pieces.length, 4);
  assert.equal(t.roots.length, 1);
  assert.equal(mueble.vertices.length, 4 * 8, 'su geometría es la de sus partes');
});

test('girar un ensamble no toca sus partes por dentro', () => {
  const t = createWorkshop();
  const a = larguero(t, [0, 0, 0]);
  const b = larguero(t, [0, 0, 40]).rotate(20, 'y');
  const e = t.assemble([a, b]);
  const marcos = () => [a, b].map((p) => JSON.stringify(t.model.get(p.id).frame));
  const antes = marcos();
  const localAntes = pts(e.local.vertices);
  e.rotate(33, 'x').rotate(90, 'y').move([7, 7, 7]);
  assert.deepEqual(marcos(), antes);
  assert.deepEqual(pts(e.local.vertices), localAntes, 'adentro del ensamble nada se movió');
});

test('ensamblar y deshacer (explode) no mueve nada en el mundo', () => {
  const t = createWorkshop();
  const a = larguero(t, [3, 4, 5]).rotate(30, 'z');
  const b = larguero(t, [-20, 8, 60]).rotate(90, 'x');
  const mundo = () => pts([...a.vertices, ...b.vertices]);
  const antes = mundo();
  const e = t.assemble([a, b]);
  assert.deepEqual(mundo(), antes);
  const sueltas = e.explode();
  assert.deepEqual(sueltas.map((p) => p.id), [a.id, b.id]);
  assert.deepEqual(mundo(), antes);
  assert.equal(a.parent, null);
});

test('mover una pieza dentro de un ensamble girado se mide en el mundo, y sigue adentro', () => {
  const t = createWorkshop();
  const a = larguero(t, [0, 0, 0]);
  const e = t.assemble([a, larguero(t, [0, 0, 40])]);
  e.rotate(90, 'y');
  const c0 = a.boundingBox.center;
  a.move([10, 0, 0]);
  cerca(a.boundingBox.center.toArray(), [c0.x + 10, c0.y, c0.z]);
  assert.equal(a.parent, e);
});

test('errores claros: no hermanas, medidas inválidas, Transform equivocado', () => {
  const t = createWorkshop();
  const a = larguero(t), b = larguero(t), c = larguero(t);
  t.assemble([a, b]);
  assert.throws(() => t.assemble([a, c]), /hermanas/);
  assert.throws(() => t.addPiece({ size: [1, 2] }), /medidas inválido/);
  assert.throws(() => t.addPiece({ size: [10, 0, 5] }), /medidas inválidas/);
  assert.throws(() => c.transform({ frame: {} }), /va un Transform/);
  assert.throws(() => c.rotate('90', 'z'), /ángulo inválido/);
  assert.throws(() => t.part('P-99'), /no existe/);
});

test('borrar una parte: el handle queda inválido, con un mensaje claro', () => {
  const t = createWorkshop();
  const a = larguero(t);
  a.remove();
  assert.throws(() => a.vertices, /no existe/);
  assert.equal(t.parts.length, 0);
});

// ---------- help(): la ayuda no puede mentir ----------

// Los miembros públicos de verdad: lo que está en el prototipo (y en la clase, si es
// static). Los privados (#) no aparecen. `id` y `x/y/z` son campos de la instancia.
const publicos = (cls, { instanceFields = [] } = {}) => {
  const inst = new Set(instanceFields);
  for (let p = cls.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) if (k !== 'constructor') inst.add(k);
  }
  const est = new Set(Object.getOwnPropertyNames(cls).filter((k) => !['length', 'name', 'prototype', 'members'].includes(k)));
  return { inst, est };
};
const documentados = (members) => {
  const inst = new Set(), est = new Set();
  for (const [sig] of members) for (const { name, isStatic } of memberNames(sig)) (isStatic ? est : inst).add(name);
  return { inst, est };
};

for (const [cls, members, campos] of [
  [Point3d, Point3d.members, ['x', 'y', 'z']],
  [Vector3d, Vector3d.members, ['x', 'y', 'z']],
  [Line, Line.members, ['from', 'to']],
  [BoundingBox, BoundingBox.members, ['min', 'max']],
  [Face, Face.members, ['piece', 'localAxis', 'localSide', 'normal', 'center', 'vertices']],
  [Transform, Transform.members, ['frame']],
  [Contact, Contact.members, ['kind', 'a', 'b', 'points', 'area', 'normal', 'faceA', 'faceB']],
  [Intersection, Intersection.members, ['a', 'b', 'volume', 'depth', 'vertices', 'faces']],
  [Piece, [...Piece.members, ...Part.members], ['id']],
  [Assembly, [...Assembly.members, ...Part.members], ['id']],
]) {
  test(`help() de ${cls.name} está completa y no inventa nada`, () => {
    const real = publicos(cls, { instanceFields: campos });
    const doc = documentados(members);
    for (const k of real.inst) assert.ok(doc.inst.has(k), `${cls.name}.prototype.${k} no está en su help()`);
    for (const k of real.est) assert.ok(doc.est.has(k), `${cls.name}.${k} (static) no está en su help()`);
    for (const k of doc.inst) assert.ok(real.inst.has(k), `help() de ${cls.name} documenta "${k}", que no existe`);
    for (const k of doc.est) assert.ok(real.est.has(k), `help() de ${cls.name} documenta "static ${k}", que no existe`);
    const filas = cls.help({ print: false });
    assert.equal(filas.length, members.length);
  });
}

test('help() del taller está completa y no inventa nada', () => {
  const t = createWorkshop();
  const real = new Set(Object.keys(t));
  const doc = new Set(WORKSHOP_MEMBERS.flatMap(([sig]) => memberNames(sig).map((m) => m.name)));
  for (const k of real) assert.ok(doc.has(k), `taller.${k} no está en su help()`);
  for (const k of doc) assert.ok(real.has(k), `help() del taller documenta "${k}", que no existe`);
});

// ---------- marcos ----------

test('marcos: un cuarto de vuelta es exacto, y cuatro vuelven al principio', () => {
  assert.deepEqual(F.rotation('z', 90), [0, -1, 0, 1, 0, 0, 0, 0, 1]);
  let r = F.identity3();
  for (let i = 0; i < 4; i++) r = F.mul3(F.rotation('x', 90), r);
  assert.deepEqual(r, F.identity3());
});

test('marcos: 360 giros de 1° no se deforman (se asientan y vuelven a la identidad)', () => {
  let f = F.frame([10, 0, 0]);
  for (let i = 0; i < 360; i++) f = F.turn(f, 'y', 1, [0, 0, 0]);
  assert.deepEqual(f.r, F.identity3());
  cerca(f.t, [10, 0, 0], 1e-9);
});

test('el puente con Euler XYZ: fromEuler gira igual que la convención de THREE.Euler', () => {
  for (const e of [[0.3, -1.1, 2.2], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0.4], [-2.9, 0.01, 1.57]]) {
    const r = F.fromEuler(e);
    for (const p of [[1, 0, 0], [0, 1, 0], [3, -7, 11]]) cerca(F.rotate(r, p), rotatePoint(p, e), 1e-12, `euler ${e}`);
    cerca(F.fromEuler(F.toEuler(r)), r, 1e-9, `ida y vuelta de ${e}`);
  }
});

// ---------- crear piezas ya orientadas (para importar diseños existentes) ----------

test('Transform.fromEuler + addPiece({ placement }): la pieza nace con las mismas esquinas que rotatePoint', () => {
  const t = createWorkshop();
  const e = [0.3, -0.6, 1.1]; // radianes
  const size = [20, 8, 4];
  const center = [10, -5, 3];
  const p = t.addPiece({ size, center, placement: Transform.fromEuler(e) });
  const half = size.map((s) => s / 2);
  /** @type {number[][]} */
  const esquinas = [];
  for (const x of [-half[0], half[0]]) for (const y of [-half[1], half[1]]) for (const z of [-half[2], half[2]]) esquinas.push([x, y, z]);
  const esperadas = esquinas.map((c) => {
    const [x, y, z] = rotatePoint(c, e);
    return [x + center[0], y + center[1], z + center[2]];
  });
  const comoStr = (v) => v.map((n) => Math.round(n * 1e6) / 1e6).join(',');
  assert.deepEqual(pts(p.vertices), esperadas.map(comoStr).sort());
});

test('addPiece({ axes }) se respeta, aunque contradiga el orden por tamaño', () => {
  const t = createWorkshop();
  // por tamaño: el eje 1 (100) sería el largo. Se lo pedimos al revés: el 2 (10, el más chico).
  const p = t.addPiece({ size: [50, 100, 10], axes: { length: 2, width: 0, thickness: 1 } });
  assert.deepEqual(p.dims, { length: 10, width: 50, thickness: 100 });
});

test('addPiece({ axes }) inválidos: error claro', () => {
  const t = createWorkshop();
  assert.throws(() => t.addPiece({ size: [10, 10, 10], axes: { length: 0, width: 0, thickness: 1 } }), /ejes inválidos/);
});

test('Transform.fromEuler en el polo (ry = 90°) no rompe nada', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [10, 4, 6], placement: Transform.fromEuler([0, Math.PI / 2, 0.4]) });
  assert.equal(p.vertices.length, 8);
  assert.ok(p.vertices.every((v) => [v.x, v.y, v.z].every(Number.isFinite)));
});

// ---------- guardar, eventos, demo ----------

test('guardar y cargar devuelve el mismo documento', () => {
  const t = createWorkshop();
  const e = t.assemble([larguero(t, [0, 0, 0]).rotate(45, 'z'), larguero(t, [0, 0, 40])]);
  e.rotate(90, 'y');
  const t2 = createWorkshop();
  t2.load(JSON.parse(JSON.stringify(t.toJSON())));
  assert.equal(t2.tree(), t.tree());
  assert.deepEqual(pts(t2.part(e.id).vertices), pts(e.vertices));
  assert.equal(t2.addPiece({ size: [1, 1, 1] }).id, 'P-3', 'los ids nuevos siguen después de los cargados');
});

test('los eventos avisan qué partes cambiaron (de acá se cuelga el visor)', () => {
  const m = new Model();
  const ev = [];
  m.on((e) => ev.push(e));
  const a = m.addPiece({ size: [10, 10, 10] });
  const b = m.addPiece({ size: [10, 10, 10] });
  const e = m.assemble([a, b]);
  m.transform(e, F.frame([1, 0, 0]));
  assert.deepEqual(ev.map((x) => x.type), ['add', 'add', 'assemble', 'transform']);
  assert.deepEqual(ev.at(-1).ids, [e, a, b], 'transformar un ensamble avisa también por sus piezas');
});

test('la demo (examples/demo.js): el bastidor repetido es idéntico al original, corrido', async () => {
  const { demo } = await import('../examples/demo.js');
  const t = createWorkshop();
  const { bastidor, copia } = demo(t);
  assert.equal(t.roots.length, 2);
  assert.equal(copia.children.length, 5);
  const diag = bastidor.children.find((c) => c.name === 'Diagonal');
  assert.deepEqual(diag.dims, { length: 80, width: 4.5, thickness: 4.5 }, 'la diagonal girada conserva su medida');
  assert.deepEqual(pts(copia.vertices), pts(bastidor.vertices.map((v) => v.add([0, 0, -80]))));
  for (const r of t.roots) assert.ok(Math.abs(r.boundingBox.min.y) < 1e-9, `${r.name} no está apoyado en el piso`);
});


// ---------- contacto e intersección entre piezas ----------
// Una tapa de 60 × 2 × 40 apoyada en el piso (y de 0 a 2), y otra pieza encima.
const tapa = (t) => t.addPiece({ name: 'Tapa', size: [60, 2, 40], center: [0, 1, 0] });

test('dos tablas apoyadas: se tocan por una cara, y el contacto es el rectángulo donde se solapan', () => {
  const t = createWorkshop();
  const a = tapa(t);
  const b = t.addPiece({ size: [40, 2, 30], center: [10, 3, 5] });   // y de 2 a 4
  assert.ok(a.touches(b));
  assert.ok(!a.intersects(b));
  const [c] = a.contactsWith(b);
  assert.ok(c instanceof Contact);
  assert.equal(c.kind, 'face');
  assert.equal(c.area, 40 * 30, 'en x se solapan de -10 a 30, en z de -10 a 20');
  assert.deepEqual(c.normal.toArray(), [0, 1, 0], 'de a hacia b');
  assert.deepEqual(c.faceA, { localAxis: 'y', localSide: 1 });
  assert.deepEqual(c.faceB, { localAxis: 'y', localSide: -1 });
  assert.ok(c.points.every((p) => p.y === 2), 'el polígono está en el plano donde se tocan');
  assert.deepEqual(c.center.toArray(), [10, 2, 5]);
});

test('separadas no se tocan; a menos de la tolerancia sí, y la tolerancia se puede pedir', () => {
  const t = createWorkshop();
  const a = tapa(t);
  const lejos = t.addPiece({ size: [40, 2, 30], center: [0, 4, 0] });     // 1 cm de aire
  assert.ok(!a.touches(lejos));
  assert.equal(a.contactsWith(lejos).length, 0);
  const casi = t.addPiece({ size: [40, 2, 30], center: [0, 3.1, 0] });    // 1 mm de aire
  assert.ok(a.touches(casi), 'a 0,1 cm cuenta como contacto (la tolerancia es 0,2, como en el taller)');
  assert.ok(!a.touches(casi, { tolerance: 0.05 }));
});

test('si se meten una en otra es una intersección, no un contacto: con su volumen y su profundidad', () => {
  const t = createWorkshop();
  const a = tapa(t);
  const b = t.addPiece({ size: [40, 2, 30], center: [10, 2, 5] });        // y de 1 a 3: se mete 1 cm
  assert.ok(a.intersects(b));
  assert.ok(!a.touches(b));
  const [i] = a.intersectionsWith(b);
  assert.ok(i instanceof Intersection);
  cerca([i.volume, i.depth], [40 * 30 * 1, 1], 1e-9);
  cerca(i.boundingBox.min.toArray(), [-10, 1, -10]);
  cerca(i.boundingBox.max.toArray(), [30, 2, 20]);
});

test('un listón girado 45° apoyado sobre su arista: el contacto es esa arista', () => {
  const t = createWorkshop();
  const a = tapa(t);
  const liston = t.addPiece({ size: [40, 4, 4], center: [0, 2 + 2 * Math.SQRT2, 0] });
  liston.rotate(45, 'x');                                   // el cuadrado de 4 × 4 queda en rombo
  assert.ok(a.touches(liston));
  const [c] = a.contactsWith(liston);
  assert.equal(c.kind, 'edge');
  assert.ok(Math.abs(c.line.length - 40) < 1, `la arista mide lo que el listón: ${c.line.length}`);
  assert.ok(Math.abs(c.line.direction.unitize().x) > 0.999, 'y corre a lo largo del listón');
  assert.ok(Math.abs(c.center.y - 2) < 0.3, 'sobre la tapa');
});

test('un cubo apoyado sobre un vértice: el contacto es un punto', () => {
  const t = createWorkshop();
  const a = tapa(t);
  const cubo = t.addPiece({ size: [10, 10, 10], center: [5, 2 + 5 * Math.sqrt(3), -3] });
  cubo.rotate(45, 'z').rotate((Math.atan(1 / Math.SQRT2) * 180) / Math.PI, 'x');  // la diagonal, vertical
  const [c] = a.contactsWith(cubo);
  assert.equal(c.kind, 'point');
  assert.ok(c.center.distanceTo([5, 2, -3]) < 0.3, `el punto está bajo el centro del cubo: ${c.center}`);
});

test('el contacto no depende de cómo esté puesto el conjunto: girarlo entero no cambia el área', () => {
  const t = createWorkshop();
  const a = tapa(t);
  const b = t.addPiece({ size: [40, 2, 30], center: [10, 3, 5] });
  const e = t.assemble([a, b]);
  e.rotate(30, 'y').rotate(20, 'x').rotate(-75, [1, 1, 0]);
  const [c] = a.contactsWith(b);
  assert.equal(c.kind, 'face');
  assert.ok(Math.abs(c.area - 1200) < 1e-6, `área ${c.area}`);
  assert.ok(c.normal.equals(Vector3d.yAxis.transform(e.placement)), 'la normal giró con el conjunto');
});

test('la demo: las uniones del bastidor se tocan, y la diagonal choca con los largueros', async () => {
  const { demo } = await import('../examples/demo.js');
  const t = createWorkshop();
  const { bastidor } = demo(t);
  // cada travesaño apoya su testa en la cara interior de cada larguero: 4 uniones por bastidor
  const contactos = t.contacts();
  assert.equal(contactos.length, 8);
  for (const c of contactos) {
    assert.equal(c.kind, 'face');
    assert.ok(Math.abs(c.area - 4.5 * 4.5) < 1e-6, `una testa de 45 × 45 mm: ${c.area}`);
  }
  // la diagonal de 80 cm a 45° no entra entre los largueros (55,5 cm de luz): se mete
  // 40·sen 45° + 2,25·cos 45° − 27,75 ≈ 2,125 cm en cada uno. Un error de carpintería que el
  // SDK tiene que ver: en el taller eso se recorta.
  const choques = t.collisions();
  assert.equal(choques.length, 4);
  const esperado = 40 * Math.SQRT1_2 + 2.25 * Math.SQRT1_2 - 27.75;
  for (const i of choques) assert.ok(Math.abs(i.depth - esperado) < 1e-6, `profundidad ${i.depth}, esperada ${esperado}`);
  // y adentro de un ensamble: sus propias uniones
  assert.equal(bastidor.contactsWith(bastidor).length, 4);
});

test('dos cubos girados, arista contra arista: solo los separa un eje de aristas', () => {
  // A girado 45° en z y B girado 45° en y: sus aristas se cruzan en ángulo recto. Mirados
  // desde las caras parecen solaparse; lo que los separa es el eje x, el producto de las
  // dos aristas. Sin esos 9 ejes el cálculo cree que chocan.
  const t = createWorkshop();
  const sep = (gap) => {
    t.clear();
    const a = t.addPiece({ size: [10, 10, 10], center: [0, 0, 0] }).rotate(45, 'z');
    const b = t.addPiece({ size: [10, 10, 10], center: [10 * Math.SQRT2 + gap, 0, 0] }).rotate(45, 'y');
    return [a, b];
  };
  let [a, b] = sep(1);
  assert.ok(!a.intersects(b), 'a 1 cm no chocan');
  assert.ok(!a.touches(b), 'ni se tocan');
  [a, b] = sep(0);
  assert.ok(!a.intersects(b));
  const [c] = a.contactsWith(b);
  assert.equal(c.kind, 'point', 'dos aristas cruzadas se tocan en un punto');
  assert.ok(c.center.distanceTo([5 * Math.SQRT2, 0, 0]) < 0.3, `${c.center}`);
});

test('dos tablas a tope, solapadas 1 mm: un solo contacto, la junta', () => {
  // dentro de la tolerancia no es un choque: es la junta. Y las caras de abajo (o de arriba)
  // de las dos, que están en el mismo plano mirando para el mismo lado, NO son un contacto.
  const t = createWorkshop();
  const a = t.addPiece({ size: [10, 2, 30], center: [5, 1, 0] });           // x de 0 a 10
  const b = t.addPiece({ size: [10, 2, 30], center: [14.9, 1, 0] });        // x de 9,9 a 19,9
  assert.ok(!a.intersects(b));
  const cs = a.contactsWith(b);
  assert.equal(cs.length, 1, cs.map(String).join(' | '));
  assert.equal(cs[0].kind, 'face');
  assert.deepEqual(cs[0].faceA, { localAxis: 'x', localSide: 1 });
  assert.ok(Math.abs(cs[0].area - 2 * 30) < 1e-9);
});

test('contactos: errores claros', () => {
  const t = createWorkshop();
  const a = tapa(t);
  assert.throws(() => a.touches(42), /va otra parte/);
  assert.throws(() => a.touches('P-99'), /no existe/);
  assert.ok(!a.touches(a), 'una pieza consigo misma no es un contacto');
});

// ---------- que el SDK siga siendo puro ----------

test('el SDK no depende de ningún paquete externo ni del navegador (lo puede usar el servidor)', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['src/frame.js', 'src/model.js', 'src/contact.js', 'src/geometry.js', 'src/help.js', 'src/index.js', 'examples/demo.js']) {
    const src = await readFile(new URL(`../${f}`, import.meta.url), 'utf8');
    const sin = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const ext = [...sin.matchAll(/^\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/gm)]
      .map((m) => m[1]).filter((s) => !s.startsWith('.'));
    assert.deepEqual(ext, [], `${f} importa ${ext.join(', ')}`);
    assert.doesNotMatch(sin, /\b(document|window|THREE)\./, `${f} usa el navegador o three`);
    if (f.startsWith('src/')) assert.doesNotMatch(sin, /from\s*['"]\.\.\//, `${f} importa algo de afuera de src/: el núcleo no conoce al adaptador`);
  }
});
