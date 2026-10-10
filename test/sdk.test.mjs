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
  Relation, Joint, Fixing, Link, RELATION_KINDS, JOINT_TYPES,
  arrayTransforms, UNITS, convertLength, TOLERANCE_PRESETS, tolerancesFor, Mesh, OPERATION_KINDS, SECTIONS,
} from '../src/index.js';
import * as sdk from '../src/index.js';
import { sameFeature, GRAB_RATIO } from '../src/index.js';
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
  const perfil = { kind: 'profile', axis: 0, section: 'rect-tube', params: { wall: 0.16 } };
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
  [Face, Face.members, ['piece', 'localAxis', 'localSide', 'normal', 'center', 'vertices', 'holes']],
  [Transform, Transform.members, ['frame']],
  [Contact, Contact.members, ['kind', 'a', 'b', 'points', 'area', 'normal', 'faceA', 'faceB']],
  [Intersection, Intersection.members, ['a', 'b', 'volume', 'depth', 'vertices', 'faces']],
  [Mesh, Mesh.members, ['positions', 'indices', 'surfaces', 'smooth']],
  [Piece, [...Piece.members, ...Part.members], ['id']],
  [Assembly, [...Assembly.members, ...Part.members], ['id']],
  [Relation, Relation.members, ['id']],
  [Joint, [...Joint.members, ...Relation.members], ['id']],
  [Fixing, [...Fixing.members, ...Relation.members], ['id']],
  [Link, [...Link.members, ...Relation.members], ['id']],
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

test('lo que exporta el módulo está en su tabla (MODULE_MEMBERS), y la tabla no inventa nada', () => {
  const real = new Set(Object.keys(sdk));
  const doc = new Set(sdk.MODULE_MEMBERS.flatMap(([sig]) => memberNames(sig).map((m) => m.name)));
  for (const k of real) assert.ok(doc.has(k), `el módulo exporta ${k}, que no está en MODULE_MEMBERS`);
  for (const k of doc) assert.ok(real.has(k), `MODULE_MEMBERS documenta "${k}", que el módulo no exporta`);
});

test('lo que devuelve el adaptador de three está en su tabla (VIEW_MEMBERS), y la tabla no inventa nada', async () => {
  // el adaptador importa three, que no está en Node: se lee lo que devuelve de su código
  const { readFile } = await import('node:fs/promises');
  const { VIEW_MEMBERS } = await import('../adapters/three/members.js');
  const src = await readFile(new URL('../adapters/three/viewer.js', import.meta.url), 'utf8');
  const bloque = /\n  return \{\n([\s\S]*?)\n  \};\n\}/.exec(src);
  assert.ok(bloque, 'no encontré el return de createThreeView');
  const real = new Set([...bloque[1].matchAll(/^    ([A-Za-z_$][\w$]*)\s*(?:[:(,]|$)/gm)].map((m) => m[1]));
  const doc = new Set(VIEW_MEMBERS.flatMap(([sig]) => memberNames(sig).map((m) => m.name)).filter((n) => n !== 'createThreeView'));
  assert.ok(real.size >= 5);
  assert.deepEqual([...real].sort(), [...doc].sort());
  assert.match(src, /export function createThreeView\(/);
});

test('la referencia de la API (docs/) está al día: si falla, npm run docs', async () => {
  const { readFile } = await import('node:fs/promises');
  const { buildMarkdown, buildHtml } = await import('../scripts/docs.mjs');
  const leer = (f) => readFile(new URL(`../docs/${f}`, import.meta.url), 'utf8');
  assert.equal(await leer('API.md'), buildMarkdown(), 'docs/API.md quedó atrás del código: npm run docs');
  assert.equal(await leer('index.html'), buildHtml(), 'docs/index.html quedó atrás del código: npm run docs');
  const md = buildMarkdown();
  for (const c of ['createWorkshop', 'addPiece', 'cutList', 'Joint', 'thicknessAt', 'createThreeView', 'TOLERANCE_PRESETS']) assert.ok(md.includes(c), `falta ${c}`);
});

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

// ---------- instancias y matrices ----------
// Una instancia es la misma parte colocada otra vez (un Block de Rhino, no un Group): editar
// la fuente la cambia a ella también. `count` de una matriz cuenta a la original.

test('una instancia nace sobre su fuente y la sigue: editar la fuente cambia las dos', () => {
  const t = createWorkshop();
  const a = t.addPiece({ name: 'Tabla', size: [40, 2, 20], material: 'roble', center: [0, 1, 0] });
  const i = t.instantiate(a, { placement: Transform.translation([100, 0, 0]) });
  assert.equal(i.source.id, a.id);
  assert.equal(a.source, null);
  assert.deepEqual(a.instances.map((x) => x.id), [i.id]);
  assert.equal(i.kind, 'piece');
  assert.equal(i.name, 'Tabla');
  assert.deepEqual(pts(i.vertices), pts(a.vertices.map((v) => v.add([100, 0, 0]))));
  a.resize([60, 2, 20]);
  a.setMaterial('nogal');
  assert.deepEqual(i.size, { x: 60, y: 2, z: 20 });
  assert.equal(i.material, 'nogal');
  assert.deepEqual(i.dims, a.dims);
  assert.deepEqual(pts(i.vertices), pts(a.vertices.map((v) => v.add([100, 0, 0]))), 'sigue en su lugar, con las medidas nuevas');
  assert.match(t.tree(), /⧉ P-1/);
});

test('una instancia solo tiene su lugar: no se le cambian medidas ni material, sí se la mueve y se la gira', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const i = t.instantiate(a);
  assert.throws(() => i.resize([1, 1, 1]), /instancia de P-1/);
  assert.throws(() => i.setMaterial('x'), /instancia de P-1/);
  i.rotate(90, 'y').move([0, 0, 300]);
  assert.deepEqual(i.dims, a.dims, 'girarla no cambia su largo');
  assert.deepEqual(pts(a.vertices), pts(larguero(createWorkshop()).vertices), 'la fuente no se movió');
  assert.equal(i.rename('Otra').name, 'Otra');
  assert.equal(a.name, 'Larguero');
});

test('instanciar una instancia es instanciar su fuente, y se puede elegir el ensamble donde queda', () => {
  const t = createWorkshop();
  const a = larguero(t, [0, 5, 0]);
  const b = larguero(t, [0, 5, 50]);
  const e = t.assemble([b], { name: 'Marco' });
  e.rotate(30, 'y');
  const i = t.instantiate(a, { placement: Transform.translation([0, 0, 200]) });
  const j = t.instantiate(i, { parent: e });
  assert.equal(j.source.id, a.id);
  assert.equal(j.parent.id, e.id);
  assert.deepEqual(pts(j.vertices), pts(i.vertices), 'queda donde estaba en el mundo, aunque cambie de ensamble');
  assert.equal(t.instantiate(j, { parent: null }).parent, null);
});

test('una matriz de un ensamble armado y girado: cada copia conserva el giro de adentro (el bug 2, con N copias)', () => {
  const t = createWorkshop();
  const a = larguero(t, [0, 5, 0]).rotate(45, 'z');
  const b = larguero(t, [0, 5, 50]);
  const e = t.assemble([a, b], { name: 'Marco' });
  e.rotate(30, 'y');
  const copias = t.array(e, { type: 'linear', count: 4, direction: [1, 0, 0], distance: 900 });
  assert.equal(copias.length, 3, 'count cuenta a la original');
  copias.forEach((c, k) => {
    assert.ok(c instanceof Assembly);
    assert.equal(c.source.id, e.id);
    assert.equal(c.children.length, 2);
    assert.deepEqual(pts(c.vertices), pts(e.vertices.map((v) => v.add([300 * (k + 1), 0, 0]))));
    assert.deepEqual(pts(c.children[0].vertices), pts(a.vertices.map((v) => v.add([300 * (k + 1), 0, 0]))), 'el larguero a 45° sigue a 45°');
    assert.deepEqual(c.children[0].dims, a.dims);
  });
  a.resize([220, 4, 10]);
  for (const c of copias) assert.equal(c.pieces[0].dims.length, 220, 'cambiar la fuente cambia las N copias');
});

test('las piezas de adentro de una instancia se leen, pero no se cambian por separado', () => {
  const t = createWorkshop();
  const e = t.assemble([larguero(t, [0, 5, 0]), larguero(t, [0, 5, 50])]);
  const [i] = t.array(e, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 200 });
  const interna = i.children[0];
  assert.match(interna.id, new RegExp(`^${i.id}/P-1$`));
  assert.equal(t.part(interna.id).id, interna.id, 'se encuentra por su id (p. ej. el de una cara o un contacto)');
  assert.equal(interna.source.id, 'P-1');
  assert.equal(interna.parent.id, i.id);
  for (const op of [() => interna.move([1, 0, 0]), () => interna.rename('x'), () => interna.remove(), () => interna.duplicate(), () => interna.resize([1, 1, 1])]) {
    assert.throws(op, /es parte de la instancia/);
  }
  assert.throws(() => i.explode(), /es una instancia/);
});

test('las instancias son piezas de verdad para el contacto: tocan, y taller.contacts() las ve', () => {
  const t = createWorkshop();
  const b = t.addPiece({ size: [10, 2, 30], center: [5, 1, 0] });                       // x de 0 a 10
  t.array(b, { type: 'linear', count: 4, direction: [1, 0, 0], distance: 10, fit: 'step' });
  assert.equal(t.parts.length, 4);
  const cs = t.contacts();
  assert.equal(cs.length, 3, 'cada tabla toca a la que sigue');
  for (const c of cs) assert.equal(Math.round(c.area), 60);
  const [p, i1, , i3] = t.parts;
  assert.ok(p.touches(i1));
  assert.ok(!p.touches(i3));
  assert.equal(t.collisions().length, 0);
});

test('un ensamble repetido tiene las mismas uniones adentro que el original', () => {
  const t = createWorkshop();
  const e = t.assemble([t.addPiece({ size: [10, 2, 30], center: [5, 1, 0] }), t.addPiece({ size: [10, 2, 30], center: [15, 1, 0] })]);
  const [c] = t.array(e, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 100 });
  assert.equal(e.contactsWith(e).length, 1);
  assert.equal(c.contactsWith(c).length, 1);
  assert.equal(c.touches(e), false);
  const ids = t.contacts().flatMap((x) => [x.a, x.b]);
  assert.ok(ids.every((id) => !id.includes('/') || id.startsWith(`${c.id}/`)), 'los contactos de adentro de la copia dicen sus ids de camino');
  assert.ok(ids.some((id) => id.startsWith(`${c.id}/`)));
});

test('soltar una instancia: conserva el id y el lugar, y ya no sigue a la fuente', () => {
  const t = createWorkshop();
  const a = larguero(t, [0, 5, 0]).rotate(45, 'z');
  const e = t.assemble([a, larguero(t, [0, 5, 50])]);
  e.rotate(30, 'y');
  const [i] = t.array(e, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 200 });
  const id = i.id, antes = pts(i.vertices);
  assert.equal(i.detach(), i);
  assert.equal(i.id, id);
  assert.equal(i.source, null);
  assert.deepEqual(pts(i.vertices), antes, 'no se movió');
  assert.equal(i.children.length, 2);
  assert.ok(i.children.every((c) => !c.id.includes('/')), 'lo de adentro son partes de verdad, con id propio');
  assert.deepEqual(e.instances, []);
  assert.throws(() => i.detach(), /no es una instancia/);
  a.resize([100, 4, 10]);
  assert.equal(i.pieces[0].dims.length, 200, 'la suelta ya no sigue a la fuente');
  i.pieces[0].resize([150, 4, 10]);
  assert.equal(a.dims.length, 100, 'y la fuente no la sigue a ella');
  assert.ok(!t.toJSON().parts.some((p) => p.kind === 'instance'));
});

test('soltar la instancia de una pieza: pasa a ser una pieza con su id y sus medidas', () => {
  const t = createWorkshop();
  const a = t.addPiece({ size: [40, 2, 20], material: 'roble' });
  const i = t.instantiate(a, { placement: Transform.translation([0, 0, 50]) });
  i.detach();
  i.resize([10, 2, 20]).setMaterial('pino');
  assert.deepEqual(a.size, { x: 40, y: 2, z: 20 });
  assert.equal(a.material, 'roble');
  assert.equal(i.kind, 'piece');
});

test('no se borra la fuente de una instancia ni se la deshace: primero se suelta o se borra la instancia', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const e = t.assemble([larguero(t, [0, 0, 50]), larguero(t, [0, 0, 100])]);
  const [ia] = t.array(a, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 10 });
  const [ie] = t.array(e, { type: 'linear', count: 2, direction: [0, 1, 0], distance: 10 });
  assert.throws(() => a.remove(), /P-1 es la fuente de I-1/);
  assert.throws(() => e.remove(), /es la fuente de I-2/);
  assert.throws(() => e.explode(), /es la fuente de I-2/);
  ia.remove();
  a.remove();
  ie.detach();
  e.explode();
  assert.deepEqual(t.parts.map((p) => p.id).filter((id) => id.startsWith('E')), []);
});

test('borrar una instancia la saca a ella y a lo de adentro, y la fuente queda', () => {
  const t = createWorkshop();
  const e = t.assemble([larguero(t), larguero(t, [0, 0, 50])]);
  const [i] = t.array(e, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 200 });
  const interna = i.children[0];
  i.remove();
  assert.throws(() => i.vertices, /no existe/);
  assert.throws(() => interna.vertices, /no existe/);
  assert.equal(e.children.length, 2);
  assert.deepEqual(e.instances, []);
});

test('duplicar un mueble con su cajón y las instancias del cajón: las copias siguen al cajón copiado', () => {
  const t = createWorkshop();
  const cajon = t.assemble([larguero(t, [0, 5, 0]), larguero(t, [0, 5, 50])], { name: 'Cajón' });
  const reps = t.array(cajon, { type: 'linear', count: 3, direction: [0, 1, 0], distance: 40 });
  const mueble = t.assemble([cajon, ...reps], { name: 'Mueble' });
  const copia = mueble.duplicate();
  const inst = copia.children.filter((h) => h.source);
  const fuente = copia.children.find((h) => !h.source);
  assert.equal(copia.children.length, 3);
  assert.equal(inst.length, 2);
  for (const i of inst) assert.equal(i.source.id, fuente.id, 'siguen al cajón de la copia, no al de afuera');
  assert.equal(cajon.instances.length, 2, 'las del original, intactas');
  fuente.pieces[0].resize([250, 4, 10]);
  assert.equal(inst[0].pieces[0].dims.length, 250);
  assert.equal(reps[0].pieces[0].dims.length, 200, 'el original no se enteró');
});

test('duplicar una instancia da otra instancia de la misma fuente', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const i = t.instantiate(a);
  const c = i.duplicate();
  assert.notEqual(c.id, i.id);
  assert.equal(c.source.id, a.id);
  assert.deepEqual(a.instances.map((x) => x.id), [i.id, c.id]);
});

test('una instancia dentro de la fuente de otra instancia se resuelve anidada, y sigue a su propia fuente', () => {
  const t = createWorkshop();
  const pata = t.addPiece({ size: [4, 40, 4], center: [0, 20, 0] });
  const [pata2] = t.array(pata, { type: 'linear', count: 2, direction: [1, 0, 0], distance: 30 });
  const par = t.assemble([pata, pata2], { name: 'Patas' });
  const [par2] = t.array(par, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 50 });
  assert.equal(par2.pieces.length, 2);
  assert.ok(par2.pieces.every((p) => p.id.startsWith(`${par2.id}/`)));
  assert.deepEqual(pts(par2.vertices), pts(par.vertices.map((v) => v.add([0, 0, 50]))));
  pata.resize([4, 60, 4]);
  assert.deepEqual(par2.pieces.map((p) => p.size.y), [60, 60], 'el cambio llega por las dos instancias');
  assert.equal(par2.pieces.at(-1).source.id, pata2.id);
});

test('las instancias se guardan y se cargan: toJSON → load → toJSON da lo mismo', () => {
  const t = createWorkshop();
  const e = t.assemble([larguero(t, [0, 5, 0]).rotate(45, 'z'), larguero(t, [0, 5, 50])]);
  e.rotate(30, 'y');
  const [i] = t.array(e, { type: 'linear', count: 3, direction: [0, 0, 1], distance: 200 });
  const json = JSON.stringify(t.toJSON());
  const u = createWorkshop();
  u.load(JSON.parse(json));
  assert.equal(JSON.stringify(u.toJSON()), json);
  assert.deepEqual(pts(u.part(i.id).vertices), pts(i.vertices));
  assert.equal(u.part(i.id).source.id, e.id);
  assert.equal(u.instantiate(e).id, 'I-3', 'el contador de ids sigue donde estaba');
});

test('un documento guardado antes de las instancias se carga, y después se instancia', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const viejo = JSON.parse(JSON.stringify(t.toJSON()));
  viejo.version = 1;
  delete viejo.counters.instance;
  const u = createWorkshop();
  u.load(viejo);
  assert.equal(u.instantiate(u.part(a.id)).id, 'I-1');
});

test('editar la fuente avisa por sus instancias y por lo de adentro; mover una instancia no avisa por la fuente', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const e = t.assemble([a, larguero(t, [0, 0, 50])]);
  const [i] = t.array(e, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 100 });
  const ev = [];
  t.on((x) => ev.push(x));
  a.resize([210, 4, 10]);
  const ids = ev.at(-1).ids;
  for (const esperado of [a.id, i.id, i.children[0].id]) assert.ok(ids.includes(esperado), `falta ${esperado}`);
  i.move([1, 0, 0]);
  assert.ok(!ev.at(-1).ids.includes(e.id));
  assert.ok(!ev.at(-1).ids.includes(a.id));
});

test('una parte no puede quedar adentro de su propia instancia, ni un documento cargado contenerse a sí mismo', () => {
  const t = createWorkshop();
  const e = t.assemble([larguero(t), larguero(t, [0, 0, 50])]);
  assert.throws(() => t.instantiate(e, { parent: e }), /adentro de sí misma/);
  const [i] = t.array(e, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 100 });
  const f = t.assemble([i], { name: 'F' });
  assert.throws(() => t.instantiate(f, { parent: e }), /adentro de sí misma/, 'también por un camino indirecto');
  assert.throws(() => t.instantiate(e, { parent: i }), /es una instancia/);

  const marco = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  const antes = t.parts.length;
  assert.throws(() => t.load({ counters: {}, parts: [
    { kind: 'assembly', id: 'E-1', name: 'a', parent: null, frame: marco, children: ['I-1'] },
    { kind: 'instance', id: 'I-1', name: 'i', parent: 'E-1', frame: marco, source: 'E-1' },
  ] }), /queda adentro de sí mismo/);
  assert.throws(() => t.load({ counters: {}, parts: [{ kind: 'instance', id: 'I-1', name: 'i', parent: null, frame: marco, source: 'P-9' }] }), /no existe o es otra instancia/);
  assert.equal(t.parts.length, antes, 'un documento inválido no deja nada a medias');
});

test('arrayTransforms lineal: fit "span" reparte el largo total; fit "step" manda la separación', () => {
  const xs = (spec) => arrayTransforms(spec).map((t) => t.translationVector.x);
  assert.deepEqual(xs({ type: 'linear', count: 4, direction: [1, 0, 0], distance: 90 }), [0, 30, 60, 90]);
  assert.deepEqual(xs({ type: 'linear', count: 4, direction: [2, 0, 0], distance: 25, fit: 'step' }), [0, 25, 50, 75], 'la dirección se normaliza');
  assert.deepEqual(xs({ type: 'linear', count: 1, direction: [1, 0, 0], distance: 90 }), [0]);
  assert.ok(arrayTransforms({ type: 'linear', count: 3, direction: [0, 0, 1], distance: 10 })[0].isIdentity);
});

test('arrayTransforms en área: count × count2, en las dos direcciones', () => {
  const ts = arrayTransforms({ type: 'area', count: 2, count2: 3, direction: [1, 0, 0], direction2: [0, 0, 1], distance: 10, distance2: 40 });
  assert.deepEqual(ts.map((t) => t.translationVector.toArray()), [[0, 0, 0], [0, 0, 20], [0, 0, 40], [10, 0, 0], [10, 0, 20], [10, 0, 40]]);
});

test('arrayTransforms polar: 360° no repite la primera copia; menos de 360° incluye las dos puntas', () => {
  const dePunto = (spec, opts) => arrayTransforms(spec, opts).map((t) => new Point3d(10, 0, 0).transform(t).toArray());
  assert.deepEqual(dePunto({ type: 'polar', count: 4 }), [[10, 0, 0], [0, 10, 0], [-10, 0, 0], [0, -10, 0]], '4 copias = cada 90°, no cada 120°');
  assert.deepEqual(dePunto({ type: 'polar', count: 3, angle: 180 }), [[10, 0, 0], [0, 10, 0], [-10, 0, 0]]);
  assert.deepEqual(dePunto({ type: 'polar', count: 3, angle: 90, fit: 'step' }), [[10, 0, 0], [0, 10, 0], [-10, 0, 0]], 'con fit step, angle es lo que gira cada paso');
  const alrededorDeY = arrayTransforms({ type: 'polar', count: 2, axis: 'y', center: [5, 0, 0] });
  assert.deepEqual(new Point3d(10, 0, 0).transform(alrededorDeY[1]).toArray(), [0, 0, 0], 'gira por el centro dado');
});

test('arrayTransforms polar sin orient: cada copia queda paralela a la original, solo cambia de lugar', () => {
  const ts = arrayTransforms({ type: 'polar', count: 4, orient: false }, { origin: [10, 0, 0] });
  assert.ok(ts.every((t) => t.frame.r.join() === '1,0,0,0,1,0,0,0,1'), 'sin giro');
  assert.deepEqual(ts.map((t) => new Point3d(10, 0, 0).transform(t).toArray()), [[10, 0, 0], [0, 10, 0], [-10, 0, 0], [0, -10, 0]]);
  assert.throws(() => arrayTransforms({ type: 'polar', count: 4, orient: false }), /necesita origin/);
});

test('array polar de una pieza: con orient gira con el barrido; sin orient queda paralela', () => {
  const caja = (t, orient) => {
    const a = t.addPiece({ size: [6, 2, 2], center: [10, 0, 0] });
    return t.array(a, { type: 'polar', count: 4, orient }).map((c) => c.boundingBox);
  };
  const girando = caja(createWorkshop(), true);
  assert.deepEqual(girando[0].diagonal.toArray(), [2, 6, 2], 'a 90° el largo mira a y');
  assert.deepEqual(girando[1].diagonal.toArray(), [6, 2, 2], 'a 180° vuelve a x');
  const paralelas = caja(createWorkshop(), false);
  for (const b of paralelas) assert.deepEqual(b.diagonal.toArray(), [6, 2, 2]);
  assert.deepEqual(paralelas.map((b) => b.center.toArray()), [[0, 10, 0], [-10, 0, 0], [0, -10, 0]]);
});

test('arrayTransforms: errores claros', () => {
  const lin = { type: 'linear', count: 3, direction: [1, 0, 0], distance: 10 };
  assert.throws(() => arrayTransforms({ ...lin, count: 0 }), /count inválido/);
  assert.throws(() => arrayTransforms({ ...lin, count: 2.5 }), /count inválido/);
  assert.throws(() => arrayTransforms({ ...lin, direction: [0, 0, 0] }), /direction no puede ser nula/);
  assert.throws(() => arrayTransforms({ ...lin, distance: 'x' }), /distance inválido/);
  assert.throws(() => arrayTransforms({ ...lin, fit: 'paso' }), /fit inválido/);
  assert.throws(() => arrayTransforms({ type: 'espiral', count: 3 }), /tipo de matriz inválido/);
  assert.throws(() => arrayTransforms(null), /la matriz va como/);
});

// ---------- unidades y tolerancias ----------
// Las medidas son números en la unidad del documento, y las tolerancias salen de config.js
// (sugeridas por sistema, en su unidad natural) llevadas a esa unidad.

const POR_CM = { mm: 10, cm: 1, m: 0.01, in: 1 / 2.54, ft: 1 / 30.48 }; // cuánto vale 1 cm en cada unidad

test('las tolerancias sugeridas salen de config.js y se llevan a la unidad del documento', () => {
  assert.equal(createWorkshop().units, 'cm', 'sin decir nada, cm');
  assert.deepEqual({ ...createWorkshop().tolerances }, { touch: 0.2, penetration: 0.15, grab: 1, snap: 2.5, minLength: 1 }, 'y lo de siempre');
  const de = (units) => Object.values(createWorkshop({ units }).tolerances);
  cerca(de('mm'), [2, 1.5, 10, 25, 10], 1e-12);
  cerca(de('m'), [0.002, 0.0015, 0.01, 0.025, 0.01], 1e-12);
  cerca(de('in'), [1 / 16, 3 / 64, 3 / 8, 1, 3 / 8], 1e-12, 'imperial: en fracciones de pulgada, no en un 0,0787 que nadie dice');
  cerca(de('ft'), [1 / 192, 3 / 768, 1 / 32, 1 / 12, 1 / 32], 1e-12);
  assert.deepEqual(TOLERANCE_PRESETS.metric.unit, 'mm');
  assert.deepEqual(TOLERANCE_PRESETS.imperial.unit, 'in');
});

test('la misma escena física da las mismas respuestas en cualquier unidad', () => {
  // dos tablas de 40 × 2 × 30 cm; la de arriba separada `hueco` cm de la de abajo (negativo: metida)
  const escena = (units, hueco) => {
    const k = POR_CM[units];
    const t = createWorkshop({ units });
    const a = t.addPiece({ size: [40 * k, 2 * k, 30 * k], center: [0, 1 * k, 0] });
    const b = t.addPiece({ size: [40 * k, 2 * k, 30 * k], center: [0, (3 + hueco) * k, 0] });
    return { toca: a.touches(b), choca: a.intersects(b), contactos: t.contacts().length, choques: t.collisions().length };
  };
  const esperado = {
    0.1: { toca: true, choca: false, contactos: 1, choques: 0 },    // a 1 mm: se tocan
    0.3: { toca: false, choca: false, contactos: 0, choques: 0 },   // a 3 mm: no
    [-0.1]: { toca: true, choca: false, contactos: 1, choques: 0 }, // metida 1 mm: todavía un contacto
    [-0.2]: { toca: false, choca: true, contactos: 0, choques: 1 }, // metida 2 mm: choque
  };
  for (const units of Object.keys(UNITS)) {
    for (const [hueco, r] of Object.entries(esperado)) assert.deepEqual(escena(units, Number(hueco)), r, `${units}, hueco ${hueco} cm`);
  }
});

test('las tolerancias se pisan al crear el taller, y una tolerancia puntual gana', () => {
  const t = createWorkshop({ units: 'mm', tolerances: { touch: 5 } });
  assert.deepEqual({ ...t.tolerances }, { touch: 5, penetration: 1.5, grab: 10, snap: 25, minLength: 10 }, 'lo no pisado sigue siendo lo sugerido');
  const a = t.addPiece({ size: [400, 20, 300], center: [0, 10, 0] });
  const b = t.addPiece({ size: [400, 20, 300], center: [0, 34, 0] });          // a 4 mm
  assert.ok(a.touches(b), 'con touch 5, a 4 mm se tocan');
  assert.ok(!a.touches(b, { tolerance: 3 }), 'una tolerancia puntual va en la unidad del documento y gana');
  assert.equal(t.contacts({ tolerance: 3 }).length, 0);
  assert.equal(t.contacts().length, 1);
});

test('unidades y tolerancias inválidas fallan al crear, con un mensaje claro', () => {
  assert.throws(() => createWorkshop({ units: 'furlong' }), /unidad inválida: furlong/);
  assert.throws(() => createWorkshop({ tolerances: { touch: -1 } }), /tolerancia touch inválida/);
  assert.throws(() => createWorkshop({ tolerances: { penetration: 'poco' } }), /tolerancia penetration inválida/);
  assert.throws(() => convertLength(1, 'cm', 'milla'), /unidad inválida/);
  assert.throws(() => convertLength('1', 'cm', 'mm'), /longitud inválida/);
});

test('la unidad viaja con el documento: se guarda, se carga, y un documento viejo es de cm', () => {
  const t = createWorkshop({ units: 'mm' });
  t.addPiece({ size: [400, 20, 300] });
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  assert.equal(json.units, 'mm');
  const u = createWorkshop();                      // se crea en cm...
  u.load(json);                                    // ...y el documento manda
  assert.equal(u.units, 'mm');
  assert.equal(u.tolerances.touch, 2, 'las tolerancias siguen a la unidad cargada');
  assert.equal(JSON.stringify(u.toJSON()), JSON.stringify(json));
  u.clear();
  assert.equal(u.units, 'mm', 'vaciar el documento no le cambia la unidad');
  const viejo = { version: 2, counters: { piece: 0, assembly: 0, instance: 0 }, parts: [] };
  u.load(viejo);
  assert.equal(u.units, 'cm', 'antes de guardar la unidad, todo era cm');
  assert.throws(() => u.load({ units: 'milla', counters: {}, parts: [] }), /unidad inválida/);
  assert.equal(u.units, 'cm', 'un documento inválido no deja nada a medias');
});

test('config.js: tolerancesFor lleva lo sugerido a la unidad pedida, y convertLength convierte', () => {
  cerca([convertLength(25.4, 'mm', 'in'), convertLength(1, 'ft', 'in'), convertLength(1, 'm', 'cm')], [1, 12, 100], 1e-12);
  assert.deepEqual({ ...tolerancesFor('cm', { penetration: 0.5 }) }, { touch: 0.2, penetration: 0.5, grab: 1, snap: 2.5, minLength: 1 });
  assert.ok(Object.isFrozen(tolerancesFor('mm')) && Object.isFrozen(TOLERANCE_PRESETS) && Object.isFrozen(UNITS));
});

test('las tolerancias viven solo en config.js: el resto del SDK no las escribe a mano', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  for (const f of (await readdir(new URL('../src/', import.meta.url))).filter((n) => n.endsWith('.js') && n !== 'config.js')) {
    const src = await readFile(new URL(`../src/${f}`, import.meta.url), 'utf8');
    const sin = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(sin, /\b(TOUCH|PEN)\b|(?<![\w.])0\.(15|2)\b/, `src/${f} escribe una tolerancia a mano: va en config.js`);
  }
  assert.ok(!('TOUCH' in sdk) && !('PEN' in sdk), 'ya no se exportan constantes de tolerancia en cm');
});

// ---------- deshacer y rehacer ----------
// Cada operación es un paso; begin/commit (o transaction) agrupan varios en uno. Lo guardado
// es inmutable, así que deshacer es volver a una foto del documento.

const doc = (t) => JSON.stringify(t.toJSON());

test('hacer N cosas y deshacer N veces deja el documento como al principio; rehacer N, como al final', () => {
  const t = createWorkshop();
  const inicio = doc(t);
  const pasos = [
    () => larguero(t, [0, 5, 0]),
    () => larguero(t, [0, 5, 50]),
    () => t.part('P-1').rotate(45, 'z'),
    () => t.assemble(['P-1', 'P-2'], { name: 'Marco' }),
    () => t.part('E-1').rotate(30, 'y'),
    () => t.array('E-1', { type: 'linear', count: 3, direction: [1, 0, 0], distance: 400 }),
    () => t.part('P-2').resize([180, 4, 10]),
    () => t.part('I-1').detach(),
    () => t.part('I-2').rename('Copia'),
    () => t.part('E-1').duplicate(),
    () => t.part('I-2').remove(),
    () => t.part('P-1').setMaterial('otro'),
  ];
  const estados = [inicio];
  for (const f of pasos) { f(); estados.push(doc(t)); }
  for (let k = pasos.length; k > 0; k--) {
    assert.equal(t.undo(), true);
    assert.equal(doc(t), estados[k - 1], `después de deshacer el paso ${k}`);
  }
  assert.equal(t.undo(), false, 'no hay nada más para deshacer');
  assert.equal(doc(t), inicio);
  for (let k = 1; k <= pasos.length; k++) {
    assert.equal(t.redo(), true);
    assert.equal(doc(t), estados[k], `después de rehacer el paso ${k}`);
  }
  assert.equal(t.redo(), false);
});

test('una transacción con cien move() se deshace con un solo undo()', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const antes = doc(t);
  t.transaction(() => { for (let i = 0; i < 100; i++) a.move([0.5, 0, 0]); });
  cerca([a.boundingBox.center.x], [50]);
  t.undo();
  assert.equal(doc(t), antes);
  assert.equal(t.canUndo, true, 'queda el paso de crear la pieza');
  t.undo();
  assert.equal(t.canUndo, false);
});

test('begin() … commit() agrupa aunque el gesto cruce varios eventos, y se anida', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const antes = doc(t);
  t.begin();                   // pointerdown
  a.move([10, 0, 0]);          // pointermove
  t.begin();                   // algo de adentro que también agrupa
  a.rotate(90, 'y');
  t.commit();
  a.move([10, 0, 0]);          // pointermove
  t.commit();                  // pointerup
  assert.notEqual(doc(t), antes);
  t.undo();
  assert.equal(doc(t), antes, 'todo el gesto es un solo paso');
  assert.throws(() => t.commit(), /no hay una transacción abierta/);
});

test('rollback() cancela el gesto entero, y transaction(fn) vuelve atrás si fn tira', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const antes = doc(t);
  const ev = [];
  t.on((x) => ev.push(x));
  t.begin();
  a.move([10, 0, 0]);
  larguero(t, [0, 0, 50]);
  t.rollback();                // Esc durante el arrastre
  assert.equal(doc(t), antes);
  assert.equal(ev.at(-1).type, 'rollback');
  assert.deepEqual(ev.at(-1).ids.sort(), ['P-1', 'P-2']);
  assert.throws(() => t.transaction(() => { a.move([5, 0, 0]); throw new Error('algo falló'); }), /algo falló/);
  assert.equal(doc(t), antes);
  assert.equal(t.transaction(() => 42), 42, 'devuelve lo que devuelve fn');
  t.undo();
  assert.equal(doc(t), '{"version":5,"units":"cm","counters":{"piece":0,"assembly":0,"instance":0,"relation":0},"parts":[],"relations":[]}', 'ni el rollback ni la transacción vacía dejaron pasos');
});

test('una operación que falla a mitad de camino no deja nada hecho', () => {
  const t = createWorkshop();
  larguero(t);
  const antes = doc(t);
  // crea la pieza y recién después falla al meterla en un ensamble que no existe
  assert.throws(() => t.model.addPiece({ size: [1, 1, 1], parent: 'E-9' }), /no existe la parte E-9/);
  assert.equal(doc(t), antes, 'ni la pieza ni el contador de ids');
  // dentro de una transacción, lo que falla vuelve atrás solo, y lo anterior queda
  t.begin();
  t.part('P-1').move([1, 0, 0]);
  const movida = doc(t);
  assert.throws(() => t.model.addPiece({ size: [1, 1, 1], parent: 'E-9' }));
  assert.equal(doc(t), movida);
  t.commit();
  t.undo();
  assert.equal(doc(t), antes);
});

test('deshacer avisa con los ids que cambiaron, y el visor se entera solo', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const b = larguero(t, [0, 0, 50]);
  const e = t.assemble([a, b]);
  const ev = [];
  t.on((x) => ev.push(x));
  e.rotate(90, 'y');
  t.undo();
  assert.equal(ev.at(-1).type, 'undo');
  assert.deepEqual(ev.at(-1).ids, [e.id], 'girar un ensamble cambia un solo marco');
  t.redo();
  assert.equal(ev.at(-1).type, 'redo');
  assert.deepEqual(ev.at(-1).ids, [e.id]);
});

test('una parte borrada y recuperada vuelve con el mismo id, y su handle viejo sirve', () => {
  const t = createWorkshop();
  const e = t.assemble([larguero(t), larguero(t, [0, 0, 50])]);
  const hijo = e.children[0];
  const antes = pts(e.vertices);
  e.remove();
  assert.throws(() => e.vertices, /no existe/);
  t.undo();
  assert.deepEqual(pts(e.vertices), antes, 'el mismo objeto vuelve a funcionar');
  assert.equal(t.part(hijo.id).parent.id, e.id);
  assert.equal(t.parts.length, 3);
});

test('deshacer un cambio en la fuente devuelve también a sus instancias', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const [i] = t.array(a, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 50 });
  a.resize([300, 4, 10]);
  assert.equal(i.dims.length, 300);
  t.undo();
  assert.equal(i.dims.length, 200);
  t.undo();                                   // la matriz
  assert.throws(() => i.vertices, /no existe/);
  assert.deepEqual(a.instances, []);
});

test('hacer algo nuevo después de deshacer descarta lo que se podía rehacer', () => {
  const t = createWorkshop();
  const a = larguero(t);
  a.move([10, 0, 0]);
  t.undo();
  assert.equal(t.canRedo, true);
  a.rotate(90, 'y');
  assert.equal(t.canRedo, false);
  assert.equal(t.redo(), false);
});

test('el historial tiene un límite, y cargar, vaciar u olvidar lo borra', () => {
  const t = createWorkshop({ historyLimit: 3 });
  const a = larguero(t);
  for (let i = 0; i < 5; i++) a.move([1, 0, 0]);
  let n = 0;
  while (t.undo()) n++;
  assert.equal(n, 3);
  cerca([a.boundingBox.center.x], [2], 1e-9, 'solo se deshacen los últimos 3 pasos');

  a.move([1, 0, 0]);
  t.clearHistory();
  assert.equal(t.canUndo, false);
  a.move([1, 0, 0]);
  t.load(t.toJSON());
  assert.equal(t.canUndo, false, 'un documento cargado no tiene pasado');
  a.move([1, 0, 0]);
  t.clear();
  assert.equal(t.canUndo, false);

  const sin = createWorkshop({ historyLimit: 0 });
  larguero(sin);
  assert.equal(sin.canUndo, false);
  assert.throws(() => createWorkshop({ historyLimit: -1 }), /historyLimit inválido/);
});

test('no se deshace, ni se carga, con una transacción abierta', () => {
  const t = createWorkshop();
  larguero(t);
  t.begin();
  assert.throws(() => t.undo(), /transacción abierta/);
  assert.throws(() => t.redo(), /transacción abierta/);
  assert.throws(() => t.load({ counters: {}, parts: [] }), /transacción abierta/);
  t.commit();
  assert.equal(t.undo(), true);
});

test('lo guardado es inmutable: nadie lo cambia por la espalda', () => {
  const t = createWorkshop();
  const a = larguero(t);
  const rec = t.model.get(a.id);
  assert.ok(Object.isFrozen(rec) && Object.isFrozen(rec.frame) && Object.isFrozen(rec.size));
  assert.throws(() => { rec.size[0] = 1; }, TypeError);
  assert.equal(a.dims.length, 200);
});

// ---------- pieza = bruto + operaciones; la forma es un cálculo ----------

const TRAPECIO = [[0, 0], [1, 0], [1, 0.5], [0, 1]]; // área 0,75 del cuadrado unitario

/** Un kernel de mentira: anota qué le piden y devuelve lo que recibió, así se ve la cadena. */
const kernelDePrueba = () => {
  const llamadas = [];
  const anota = (que) => (a, b) => { llamadas.push({ que, tool: b }); return { positions: a.positions, indices: a.indices }; };
  return { llamadas, kernel: { intersect: anota('intersect'), subtract: anota('subtract') } };
};

test('las operaciones no cambian el bruto: ni las medidas, ni dims, ni la caja; los vértices sí son los de la forma real', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [60, 4.5, 4.5], center: [0, 2.25, 0] });
  const antes = { dims: p.dims, caja: p.boundingBox.toString(), stock: JSON.stringify(p.stock) };
  p.addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO });
  assert.deepEqual(p.dims, antes.dims);
  assert.equal(p.boundingBox.toString(), antes.caja);
  assert.equal(JSON.stringify(p.stock), antes.stock);
  assert.equal(p.vertices.length, 8, 'el trapecio extruido tiene 8 vértices');
  assert.ok(p.vertices.some((v) => Math.abs(v.y - 2.25) < 1e-9 && Math.abs(v.x - 30) < 1e-9), 'uno a media altura, donde el contorno baja');
  assert.deepEqual(p.operations.map((o) => [o.id, o.kind]), [['O-1', 'cut']]);
  assert.ok(Object.isFrozen(p.operations) && Object.isFrozen(p.operations[0]));
  assert.deepEqual(OPERATION_KINDS, ['cut', 'hole', 'trim']);
});

test('sin operaciones la forma es la caja; con un corte, la extrusión del contorno (sin kernel)', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [60, 4, 5] });
  cerca([p.local.solid.volume], [60 * 4 * 5], 1e-9);
  assert.equal(p.local.solid.triangleCount, 12);
  p.addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO });
  cerca([p.local.solid.volume], [0.75 * 60 * 4 * 5], 1e-9, 'el trapecio ocupa 3/4 de la cara');
  const b = p.local.solid.boundingBox;
  cerca([...b.min.toArray(), ...b.max.toArray()], [-30, -2, -2.5, 30, 2, 2.5], 1e-12, 'no se sale del bruto');
});

test('un corte por cualquiera de los tres ejes da un sólido bien orientado (volumen positivo)', () => {
  for (const axis of [0, 1, 2]) {
    const t = createWorkshop();
    const p = t.addPiece({ size: [6, 8, 10] }).addOperation({ kind: 'cut', axis, outline: TRAPECIO });
    cerca([p.local.solid.volume], [0.75 * 6 * 8 * 10], 1e-9, `eje ${axis}`);
  }
});

test('un contorno cóncavo se triangula bien', () => {
  const t = createWorkshop();
  const ele = [[0, 0], [1, 0], [1, 0.25], [0.25, 0.25], [0.25, 1], [0, 1]]; // una L: área 0,4375
  const p = t.addPiece({ size: [40, 40, 2] }).addOperation({ kind: 'cut', axis: 2, outline: ele });
  cerca([p.local.solid.volume], [0.4375 * 40 * 40 * 2], 1e-9);
});

test('estirar la pieza reaplica las operaciones: el contorno normalizado se estira con ella', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [60, 4, 5] }).addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO });
  p.resize([120, 4, 5]);
  cerca([p.local.solid.volume], [0.75 * 120 * 4 * 5], 1e-9);
  cerca([p.local.solid.boundingBox.max.x], [60]);
});

test('sacar una operación devuelve exactamente la forma de antes', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [60, 4, 5] });
  const antes = p.local.solid;
  p.addOperation({ kind: 'cut', axis: 1, outline: TRAPECIO });
  assert.notDeepEqual(p.local.solid.positions, antes.positions);
  p.removeOperation('O-1');
  assert.deepEqual(p.local.solid.positions, antes.positions);
  assert.deepEqual(p.local.solid.indices, antes.indices);
});

test('cambiar una operación la reemplaza en su lugar y con su id', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [60, 4, 5] })
    .addOperation({ kind: 'hole', axis: 2, side: 1, at: [0.5, 0.5], diameter: 1 })
    .addOperation({ kind: 'hole', axis: 2, side: 1, at: [0.2, 0.5], diameter: 1 });
  p.updateOperation('O-1', { kind: 'hole', axis: 2, side: -1, at: [0.1, 0.1], diameter: 2, depth: 1 });
  assert.deepEqual(p.operations.map((o) => [o.id, o.side, o.diameter]), [['O-1', -1, 2], ['O-2', 1, 1]]);
  assert.throws(() => p.removeOperation('O-9'), /no tiene la operación O-9/);
});

test('la forma en el mundo es la local, colocada: con la pieza girada, igual que su caja', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [60, 4, 5], center: [10, 20, 30] }).rotate(90, 'y');
  const b = p.solid.boundingBox, c = p.boundingBox;
  cerca([...b.min.toArray(), ...b.max.toArray()], [...c.min.toArray(), ...c.max.toArray()], 1e-9);
});

test('varios cortes o agujeros, sin kernel: el SDK combina los sólidos solo (partidos en convexos)', () => {
  const t = createWorkshop();
  const MITAD = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]];
  const p = t.addPiece({ size: [10, 10, 4] })
    .addOperation({ kind: 'cut', axis: 2, outline: MITAD })
    .addOperation({ kind: 'cut', axis: 0, outline: MITAD });
  cerca([p.local.solid.volume], [100], 1e-9, 'la mitad de la mitad');
  const q = t.addPiece({ size: [10, 10, 4] }).addOperation({ kind: 'hole', axis: 2, side: 1, at: [0.5, 0.5], diameter: 1 });
  const poligono = 16 * 0.25 * Math.sin((2 * Math.PI) / 32);   // el círculo es un polígono de 32 lados
  cerca([q.local.solid.volume], [400 - 4 * poligono], 1e-9);
  assert.equal(q.faces.filter((f) => f.holes.length).length, 2, 'las dos caras por donde pasa tienen su agujero');
  assert.throws(() => createWorkshop({ kernel: {} }), /kernel inválido/);
});

test('con kernel, las operaciones se aplican en orden sobre el bruto, con sus herramientas', () => {
  const { llamadas, kernel } = kernelDePrueba();
  const t = createWorkshop({ kernel });
  const p = t.addPiece({ size: [10, 10, 4] })
    .addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO })
    .addOperation({ kind: 'hole', axis: 2, side: 1, at: [0.5, 0.5], diameter: 1, depth: 2 });
  p.local.solid;
  assert.deepEqual(llamadas.map((l) => l.que), ['intersect', 'subtract']);
  const corte = llamadas[0].tool.boundingBox, agujero = llamadas[1].tool.boundingBox;
  assert.ok(corte.min.z < -2 && corte.max.z > 2, 'el prisma del corte pasa de lado a lado (sobresale, sin caras coplanares)');
  cerca([agujero.min.x, agujero.max.x, agujero.min.y, agujero.max.y], [-0.5, 0.5, -0.5, 0.5], 1e-9, 'el agujero tiene su diámetro, en su lugar');
  cerca([agujero.min.z], [0], 1e-12, 'entra 2 por la cara de +z (que está en z = 2)');
  assert.ok(agujero.max.z > 2, 'y sobresale por afuera');
});

test('la forma se cachea mientras la definición no cambie, y las instancias comparten la de su fuente', () => {
  const { llamadas, kernel } = kernelDePrueba();
  const t = createWorkshop({ kernel });
  const p = t.addPiece({ size: [10, 10, 4] })
    .addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO })
    .addOperation({ kind: 'cut', axis: 0, outline: TRAPECIO });
  const [i] = t.array(p, { type: 'linear', count: 2, direction: [1, 0, 0], distance: 50 });
  p.local.solid;
  const n = llamadas.length;
  p.local.solid; p.solid; i.local.solid; i.solid;
  p.move([5, 0, 0]);
  p.rename('Otra');
  p.local.solid;
  assert.equal(llamadas.length, n, 'ni otra pieza que es la misma, ni moverla o renombrarla, la recalculan');
  t.undo(); t.undo();
  p.local.solid;
  assert.equal(llamadas.length, n, 'deshacer vuelve a encontrar la que había');
  p.resize([20, 10, 4]);
  i.local.solid;
  assert.equal(llamadas.length, 2 * n, 'cambiar la definición sí');
});

test('las operaciones se guardan con el documento, la forma no; y deshacer las devuelve', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [60, 4, 5] }).addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO });
  const json = JSON.stringify(t.toJSON());
  assert.equal(JSON.parse(json).version, 5);
  assert.ok(json.includes('"operations":[{"id":"O-1","kind":"cut"'));
  assert.ok(!json.includes('positions'), 'la forma que resulta no se guarda');
  const u = createWorkshop();
  u.load(JSON.parse(json));
  assert.equal(JSON.stringify(u.toJSON()), json);
  cerca([u.part(p.id).local.solid.volume], [p.local.solid.volume]);
  t.undo();
  assert.deepEqual(p.operations, []);
  t.redo();
  assert.equal(p.operations.length, 1);
});

test('un documento de una versión más nueva del formato no se carga a medias', () => {
  const t = createWorkshop();
  larguero(t);
  assert.throws(() => t.load({ version: 99, counters: {}, parts: [] }), /versión 99 del formato, más nueva/);
  assert.equal(t.parts.length, 1);
});

test('operaciones inválidas: errores claros, y a una instancia no se le hacen', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [10, 10, 10] });
  const malas = [
    [{ kind: 'pulir' }, /operación desconocida: pulir/],
    [{ kind: 'cut', axis: 3, outline: TRAPECIO }, /eje inválido/],
    [{ kind: 'cut', axis: 2, outline: [[0, 0], [1, 1]] }, /al menos 3 puntos/],
    [{ kind: 'cut', axis: 2, outline: [[0, 0], [1.5, 0], [1, 1]] }, /normalizado/],
    [{ kind: 'cut', axis: 2, outline: [[0, 0], [0.5, 0.5], [1, 1]] }, /no encierra área/],
    [{ kind: 'cut', axis: 2, outline: [[0, 0], [1, 0], [0, 1], [0.8, 0.9]] }, /se cruza consigo mismo/],
    [{ kind: 'hole', axis: 2, side: 0, at: [0.5, 0.5], diameter: 1 }, /lado inválido/],
    [{ kind: 'hole', axis: 2, side: 1, at: [0.5, 0.5], diameter: 0 }, /diámetro inválido/],
    [{ kind: 'hole', axis: 2, side: 1, at: [0.5, 0.5], diameter: 1, depth: -1 }, /profundidad inválida/],
  ];
  for (const [op, err] of malas) assert.throws(() => p.addOperation(op), err, JSON.stringify(op));
  assert.deepEqual(p.operations, [], 'ninguna quedó a medias');
  const i = t.instantiate(p);
  assert.throws(() => i.addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO }), /instancia de P-1/);
});

test('Mesh: un valor, con su volumen, su caja y transform', () => {
  const m = new Mesh({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] });
  cerca([m.volume], [1 / 6]);
  assert.equal(m.triangleCount, 4);
  const corrida = m.transform(Transform.translation([10, 0, 0]));
  assert.equal(corrida.boundingBox.min.x, 10);
  assert.equal(m.boundingBox.min.x, 0, 'la original no cambia');
  assert.throws(() => new Mesh({ positions: [0, 0], indices: [] }), /de a tres números/);
  assert.throws(() => new Mesh({ positions: [0, 0, 0], indices: [0, 0, 1] }), /entre 0 y 0/);
});

// ---------- formas reales: perfiles y torneados ----------

const CANO = { kind: 'profile', axis: 0, section: 'rect-tube', params: { wall: 0.16 } };
const BARRA = (axis) => ({ kind: 'profile', axis, section: 'round-bar' });
const LADOS = 32;
const poligono = (r) => (LADOS / 2) * r * r * Math.sin((2 * Math.PI) / LADOS); // el círculo es un polígono

test('un caño cuadrado de 4 × 4 con pared 0,16 tiene 16 vértices: 8 por tapa, 4 por fuera y 4 por dentro', () => {
  const t = createWorkshop();
  const c = t.addPiece({ size: [100, 4, 4], shape: CANO });
  assert.equal(c.vertices.length, 16);
  assert.equal(c.edges.length, 24, '8 por tapa y 8 a lo largo');
  const tapas = c.local.faces.filter((f) => f.localAxis === 'x');
  assert.equal(tapas.length, 2);
  for (const f of tapas) {
    assert.equal(f.holes.length, 1, 'la tapa tiene el agujero del caño');
    cerca([f.area], [16 - 3.68 * 3.68], 1e-9);
  }
  cerca([c.local.solid.volume], [100 * (16 - 3.68 * 3.68)], 1e-9);
  assert.deepEqual(c.dims, { length: 100, width: 4, thickness: 4 }, 'el bruto manda');
});

test('una barra redonda no ofrece aristas ni vértices en su superficie curva', () => {
  const t = createWorkshop();
  const b = t.addPiece({ size: [50, 4, 4], shape: BARRA(0) });
  assert.equal(b.vertices.length, 0);
  assert.equal(b.edges.length, 0);
  assert.equal(b.faces.length, 2, 'solo las dos tapas son caras planas');
  cerca([b.local.solid.volume], [50 * poligono(2)], 1e-9);
});

test('una barra redonda apoyada sobre una tabla toca en una línea, no en una cara', () => {
  const t = createWorkshop();
  const tabla = t.addPiece({ size: [60, 2, 40], center: [0, 1, 0] });
  const barra = t.addPiece({ size: [50, 4, 4], shape: BARRA(0), center: [0, 4, 0] });
  const [caja] = barra.contactsWith(tabla);
  assert.equal(caja.kind, 'face', 'con su caja, apoya una cara');
  const exactos = barra.contactsWith(tabla, { exact: true });
  assert.equal(exactos.length, 1);
  assert.equal(exactos[0].kind, 'edge', 'con su forma real, una línea');
  cerca([exactos[0].line.length], [50], 1e-9, 'a todo lo largo de la barra');
  barra.rotate(360 / 64, 'x'); // medio lado del polígono: ahora apoya un lado plano del polígono, y sigue siendo una línea
  barra.move([0, -barra.boundingBox.min.y + 2, 0]);
  const girada = barra.contactsWith(tabla, { exact: true });
  assert.deepEqual(girada.map((c) => c.kind), ['edge']);
  assert.ok(barra.touches(tabla, { exact: true }));
});

test('dos barras redondas en L: las cajas se encima en la esquina, los cilindros no; con la forma real no chocan', () => {
  const t = createWorkshop();
  const a = t.addPiece({ size: [10, 2, 2], shape: BARRA(0) });                       // a lo largo de x
  const b = t.addPiece({ size: [2, 2, 10], shape: BARRA(2), center: [4.5, 1.5, 5.9] }); // a lo largo de z, más arriba
  assert.ok(a.intersects(b, { tolerance: 0 }), 'las cajas se meten una en otra');
  assert.ok(!a.intersects(b, { exact: true, tolerance: 0 }), 'los cilindros, no');
  assert.equal(t.collisions({ exact: true, tolerance: 0 }).length, 0);
});

test('con la forma real, el choque es el volumen de verdad que comparten', () => {
  const t = createWorkshop();
  const tabla = t.addPiece({ size: [60, 2, 40], center: [0, 1, 0] });
  const barra = t.addPiece({ size: [4, 4, 30], shape: BARRA(2), center: [0, 2, 0] }); // hundida hasta su eje en la tabla
  const [i] = barra.intersectionsWith(tabla, { exact: true });
  cerca([i.volume], [30 * poligono(2) / 2], 1e-6, 'media barra (por debajo de su eje) está adentro de la tabla');
  cerca([i.depth], [2], 1e-6);
});

test('un caño apoyado sobre una tabla: el contacto es la cara de abajo del caño, entera', () => {
  const t = createWorkshop();
  const tabla = t.addPiece({ size: [200, 2, 40], center: [0, 1, 0] });
  const cano = t.addPiece({ size: [100, 4, 4], shape: CANO, center: [0, 4, 0] });
  const cs = cano.contactsWith(tabla, { exact: true });
  assert.deepEqual(cs.map((c) => c.kind), ['face']);
  cerca([cs[0].area], [100 * 4], 1e-9);
  const delCano = cs[0].a === cano.id ? cs[0].faceA : cs[0].faceB;
  assert.deepEqual(delCano, { localAxis: 'y', localSide: -1 }, 'la cara -y del caño');
});

test('rotar el ensamble que contiene un perfil no cambia su geometría local', () => {
  const t = createWorkshop();
  const c = t.addPiece({ size: [100, 4, 4], shape: CANO });
  const otro = t.addPiece({ size: [10, 10, 10], center: [0, 20, 0] });
  const local = () => [pts(c.local.vertices), JSON.stringify(c.local.solid.positions)];
  const antes = local();
  const e = t.assemble([c, otro]);
  e.rotate(37, 'y').rotate(90, 'x');
  assert.deepEqual(local(), antes);
});

test('un torneado: el contorno gira alrededor de su eje y se estira con la pieza', () => {
  const t = createWorkshop();
  const pata = t.addPiece({ size: [4, 40, 4], shape: { kind: 'lathe', axis: 1, contour: [[1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1]] } });
  cerca([pata.local.solid.volume], [20 * poligono(2) + 20 * poligono(1)], 1e-9, 'un cilindro de radio 2 y uno de radio 1');
  assert.equal(pata.faces.length, 3, 'abajo, el escalón (un anillo) y arriba');
  const escalon = pata.local.faces.find((f) => f.holes.length === 1);
  cerca([escalon.area], [poligono(2) - poligono(1)], 1e-9);
  assert.equal(pata.vertices.length, 0);
  pata.resize([4, 80, 4]);
  cerca([pata.local.solid.volume], [40 * poligono(2) + 40 * poligono(1)], 1e-9);
});

test('secciones: girar una sección, la de la app y los errores claros', () => {
  const t = createWorkshop({ sections: { 'mi-perfil': (_p, w, h) => ({ outer: { points: [[-w / 2, -h / 2], [w / 2, -h / 2], [0, h / 2]] } }) } });
  const ang = t.addPiece({ size: [20, 4, 4], shape: { kind: 'profile', axis: 0, section: 'angle', params: { wall: 0.5 } } });
  cerca([ang.local.solid.volume], [20 * (4 * 0.5 + 3.5 * 0.5)], 1e-9);
  const girado = t.addPiece({ size: [20, 4, 4], shape: { kind: 'profile', axis: 0, section: 'angle', params: { wall: 0.5, turn: 180 } } });
  assert.ok(girado.local.solid.boundingBox.max.y > 1.9 && girado.local.vertices.some((v) => v.y === 2 && v.z === 2), 'girado 180°: las alas quedan arriba y a la derecha');
  const prisma = t.addPiece({ size: [10, 6, 4], shape: { kind: 'profile', axis: 2, section: 'mi-perfil' } });
  cerca([prisma.local.solid.volume], [0.5 * 10 * 6 * 4], 1e-9, 'la sección de la app: un triángulo');
  assert.deepEqual(Object.keys(SECTIONS), ['rect-tube', 'round-tube', 'round-bar', 'angle', 'channel', 'tee']);
  assert.throws(() => t.addPiece({ size: [10, 4, 4], shape: { kind: 'profile', axis: 0, section: 'caño-40x40' } }), /sección desconocida: caño-40x40/);
  assert.throws(() => t.addPiece({ size: [10, 4, 4], shape: { kind: 'profile', axis: 0, section: 'rect-tube', params: { wall: 3 } } }), /pared inválida/);
  assert.throws(() => t.addPiece({ size: [10, 4, 4], shape: { kind: 'sphere' } }), /forma desconocida/);
  assert.throws(() => t.addPiece({ size: [10, 4, 4], shape: { kind: 'lathe', axis: 0, contour: [[1, 1], [1, 0]] } }), /y no puede decrecer/);
  const c = t.addPiece({ size: [100, 4, 4], shape: CANO });
  assert.throws(() => c.resize([100, 0.3, 4]), /pared inválida/, 'achicarla hasta que la pared no entra');
  assert.throws(() => createWorkshop({ sections: { mala: 42 } }), /sección mala inválida/);
});

test('cambiar la forma del bruto: setShape, y se deshace', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [100, 4, 4] });
  p.setShape(CANO);
  assert.equal(p.vertices.length, 16);
  t.undo();
  assert.equal(p.shape, null);
  assert.equal(p.vertices.length, 8);
  t.redo();
  assert.deepEqual(p.shape, CANO);
});

test('la malla de una forma sabe sus superficies, y las curvas están marcadas', () => {
  const t = createWorkshop();
  const b = t.addPiece({ size: [4, 4, 50], shape: BARRA(2) });
  const m = b.local.solid;
  assert.ok(m.surfaces && m.smooth);
  assert.equal(m.smooth.filter(Boolean).length, 1, 'el costado de la barra es una sola superficie curva');
});

// ---------- agarre: el vértice, la arista o la cara más cercana ----------

test('larguero girado 45°: un punto cerca de su esquina da el vértice, exacto', () => {
  const t = createWorkshop();
  const l = larguero(t, [10, 5, 0]).rotate(45, 'z');
  const esquina = l.vertices[0];
  const g = l.closest(esquina.add([0.3, -0.2, 0.1]));
  assert.equal(g.kind, 'vertex');
  assert.ok(g.point.equals(esquina, 1e-9));
  assert.equal(g.piece, l.id);
});

test('closest con kinds: sin vértices pedidos, una esquina da su arista; sin aristas, su cara', () => {
  const t = createWorkshop();
  const tabla = t.addPiece({ size: [90, 1.8, 50], center: [0, 0.9, 0] });
  const esquina = [44.9, 1.9, 24.9];   // cerca de la esquina, un pelo adentro
  assert.equal(tabla.closest(esquina).kind, 'vertex');
  assert.equal(tabla.closest(esquina, { kinds: ['vertex', 'edge', 'face'] }).kind, 'vertex', 'el mismo orden de siempre');
  assert.equal(tabla.closest(esquina, { kinds: ['edge', 'face'] }).kind, 'edge');
  assert.equal(tabla.closest(esquina, { kinds: ['face'] }).kind, 'face');
  assert.equal(tabla.closest(esquina, { kinds: ['vertex'] }).kind, 'vertex');
  assert.equal(tabla.closest([0, 1.8, 22], { kinds: ['vertex', 'edge'] }), null, 'en el medio de una cara, sin caras: nada');
  assert.throws(() => tabla.closest(esquina, { kinds: [] }), /kinds inválido/);
  assert.throws(() => tabla.closest(esquina, { kinds: ['punto'] }), /kinds inválido/);
});

test('tabla de 1,8: a 0,5 del canto largo es arista; a 3, cara; en el medio del canto, cara', () => {
  const t = createWorkshop();
  const tabla = t.addPiece({ size: [90, 1.8, 50], center: [0, 0.9, 0] }); // arriba en y = 1,8; canto largo en z = 25
  const arista = tabla.closest([0, 1.8, 24.5]);
  assert.equal(arista.kind, 'edge');
  assert.ok(arista.point.equals([0, 1.8, 25], 1e-9), 'llevado a la arista');
  cerca([arista.edge.length], [90]);
  const cara = tabla.closest([0, 1.8, 22]);
  assert.equal(cara.kind, 'face');
  assert.deepEqual([cara.face.localAxis, cara.face.localSide], ['y', 1]);
  const canto = tabla.closest([0, 0.9, 25]);
  assert.equal(canto.kind, 'face', `la franja del canto es ${GRAB_RATIO * 1.8}, no 1: no se come el espesor`);
  assert.equal(tabla.closest([0, 30, 0]), null, 'lejos de todo: nada');
});

test('un rayo que atraviesa dos piezas devuelve la más cercana al origen, y se puede excluir', () => {
  const t = createWorkshop();
  const a = t.addPiece({ size: [10, 10, 10], center: [0, 0, 0] });
  const b = t.addPiece({ size: [10, 10, 10], center: [30, 0, 0] });
  const h = t.pick({ origin: [-50, 1, 2], direction: [1, 0, 0] });
  assert.equal(h.part.id, a.id);
  assert.ok(h.point.equals([-5, 1, 2], 1e-9));
  cerca([h.distance], [45]);
  assert.ok(h.normal.equals([-1, 0, 0], 1e-9));
  assert.equal(t.pick({ origin: [-50, 1, 2], direction: [1, 0, 0] }, { exclude: [a] }).part.id, b.id);
  assert.equal(t.pick({ origin: [-50, 50, 2], direction: [1, 0, 0] }), null);
});

test('dentro de un ensamble girado, una pieza da lo mismo que suelta con el mismo marco', () => {
  const t = createWorkshop();
  const a = larguero(t, [0, 5, 0]);
  const e = t.assemble([a, larguero(t, [0, 5, 50])]);
  e.rotate(30, 'y').rotate(15, 'x');
  const u = createWorkshop();
  const suelta = u.addPiece({ size: [200, 4, 10], placement: a.placement, center: [0, 0, 0] });
  suelta.transform(Transform.translation(a.placement.translationVector));
  const q = a.vertices[3].add([0.2, 0.2, -0.1]);
  const [g1, g2] = [e.closest(q), suelta.closest(q)];
  assert.equal(g1.kind, g2.kind);
  assert.ok(g1.point.equals(g2.point, 1e-9));
  const r = { origin: a.boundingBox.center.add([0, 50, 0]), direction: [0, -1, 0.05] };
  const [p1, p2] = [t.pick(r), u.pick(r)];
  assert.ok(p1 && p2 && p1.point.equals(p2.point, 1e-9));
});

test('con formas reales: el caño ofrece sus vértices; la barra redonda, ni vértices ni aristas en lo curvo', () => {
  const t = createWorkshop();
  const cano = t.addPiece({ size: [100, 4, 4], shape: CANO });
  assert.equal(cano.closest([50, 2, 2.1]).kind, 'vertex');
  const barra = t.addPiece({ size: [4, 4, 50], shape: BARRA(2), center: [20, 0, 100] });
  assert.equal(barra.closest([22, 0, 100]), null, 'sobre la superficie curva no hay nada que agarrar');
  const tapa = barra.closest([21.9, 0, 124.9]);
  assert.equal(tapa.kind, 'face', 'cerca del borde circular de la tapa: la tapa, no una arista curva');
  const h = t.pick({ origin: [30, 1.95, 100], direction: [-1, 0, 0] });
  assert.ok(h && Math.abs(h.point.x - (20 + Math.sqrt(4 - 1.95 ** 2))) < 0.05, 'el rayo corta el cilindro, no su caja');
  assert.equal(t.pick({ origin: [21.9, 1.9, 200], direction: [0, 0, -1] }, { exclude: [cano] }), null, 'a lo largo, por la esquina de la caja (afuera del cilindro), no corta');
  assert.equal(t.pick({ origin: [21.3, 1.3, 200], direction: [0, 0, -1] }, { exclude: [cano] }).part.id, barra.id, 'un poco más adentro, sí');
});

test('sameFeature: mientras el cursor sigue sobre el mismo rasgo, es el mismo', () => {
  const t = createWorkshop();
  const tabla = t.addPiece({ size: [90, 1.8, 50], center: [0, 0.9, 0] });
  assert.ok(sameFeature(tabla.closest([0, 1.8, 0]), tabla.closest([10, 1.8, -5])));
  assert.ok(!sameFeature(tabla.closest([0, 1.8, 0]), tabla.closest([0, 1.8, 24.6])));
  assert.ok(sameFeature(tabla.closest([0, 1.8, 24.6]), tabla.closest([20, 1.8, 24.8])), 'la misma arista');
  assert.ok(!sameFeature(null, null));
});

test('closest en el marco de la parte (space: local)', () => {
  const t = createWorkshop();
  const l = larguero(t, [100, 0, 0]).rotate(90, 'y');
  const g = l.closest([99.8, 1.9, 4.9], { space: 'local' });
  assert.equal(g.kind, 'vertex');
  assert.ok(g.point.equals([100, 2, 5], 1e-9));
});

// ---------- colocación: imán, sacar del choque, apoyar, guías, orient ----------
// Proponen una traslación (y qué la causó); no aplican nada.

test('una pieza arrastrada a 2 cm del canto de otra queda al ras (el imán propone, no aplica)', () => {
  const t = createWorkshop();
  const base = t.addPiece({ size: [60, 2, 40], center: [30, 1, 0] });         // x de 0 a 60
  const p = t.addPiece({ size: [10, 2, 10], center: [67, 1.7, 3] });         // su cara -x a 2 cm del canto +x de la base
  const antes = p.boundingBox.toString();
  const s = t.snap(p);
  assert.equal(p.boundingBox.toString(), antes, 'no movió nada');
  // delta: cuánto moverse a lo largo de la normal de la cara que se pega (la -x de la pieza: 2 hacia -x)
  assert.ok(s.snaps.some((x) => x.kind === 'face' && x.other.id === base.id && x.normal.equals([-1, 0, 0]) && Math.abs(x.delta - 2) < 1e-9));
  p.transform(s.transform);
  cerca([p.boundingBox.min.x, p.boundingBox.min.y], [60, 0], 1e-9, 'pegada al canto, y abajo al ras con la base');
  assert.ok(p.touches(base) && !p.intersects(base));
  assert.equal(t.snap(p, { distance: 0.5 }).snaps.length, 2, 'ya está pegada: las mismas caras, a 0');
  assert.equal(t.snap(t.addPiece({ size: [1, 1, 1], center: [500, 500, 500] })), null, 'lejos de todo: nada');
});

test('snap con axis: solo corre a lo largo de ese eje, y no corrige las otras direcciones', () => {
  const t = createWorkshop();
  const base = t.addPiece({ size: [60, 2, 40], center: [30, 1, 0] });
  const p = t.addPiece({ size: [10, 2, 10], center: [67, 1.7, 3.3] });   // a 2 de la base en x, 0,7 más arriba en y
  const libre = t.snap(p);
  assert.ok(libre.transform.translationVector.y !== 0 || libre.snaps.length > 1, 'sin axis también corrige y');
  const x = t.snap(p, { axis: 'x' });
  assert.equal(x.snaps.length, 1);
  assert.equal(x.snaps[0].other.id, base.id);
  cerca(x.transform.translationVector.toArray(), [-2, 0, 0], 1e-9, 'solo x');
  cerca(t.snap(p, { axis: [-1, 0, 0] }).transform.translationVector.toArray(), [-2, 0, 0], 1e-9, 'el sentido del eje no importa');
  assert.equal(t.snap(p, { axis: 'z' }), null, 'por z no hay nada cerca: nada');
  cerca(t.snap(p, { axis: 'z', grid: 1 }).transform.translationVector.toArray(), [0, 0, -0.3], 1e-9, 'la grilla, solo sobre el eje');
  assert.throws(() => t.snap(p, { axis: 'w' }), /inválido/);
});

test('el imán con grilla: en los ejes que no pegó a nada, la esquina cae sobre la grilla', () => {
  const t = createWorkshop();
  t.addPiece({ size: [60, 2, 40], center: [30, 1, 0] });
  const p = t.addPiece({ size: [10, 2, 10], center: [67, 1.7, 3.3] });
  p.transform(t.snap(p, { grid: 1 }).transform);
  cerca([p.boundingBox.min.x, p.boundingBox.min.z], [60, -2], 1e-9, 'x la puso el imán; z, la grilla (de -1,7 a -2)');
});

test('una pieza soltada dentro de otra sale por el lado de menor penetración y queda en contacto, sin intersección', () => {
  const t = createWorkshop();
  const base = t.addPiece({ size: [60, 10, 40], center: [0, 5, 0] });
  const p = t.addPiece({ size: [10, 10, 10], center: [26, 6, 0] });          // metida 1 por el costado +x, 9 por arriba
  assert.ok(p.intersects(base));
  const r = t.pushOut(p);
  assert.deepEqual(r.from.map((x) => x.id), [base.id]);
  assert.ok(r.transform.translationVector.equals([9, 0, 0], 1e-9), 'por el costado, que es lo que menos se mete');
  p.transform(r.transform);
  assert.ok(p.touches(base) && !p.intersects(base));
  assert.equal(t.pushOut(p), null, 'ya afuera: nada');
});

test('si la base es un larguero girado 45°, sacar del choque deja la pieza tocando la cara inclinada', () => {
  const t = createWorkshop();
  const base = larguero(t, [0, 0, 0]).rotate(45, 'z');                     // 200 × 4 × 10, girado sobre z
  const p = t.addPiece({ size: [4, 4, 4], center: [0, 3, 0] });             // metida en la cara de arriba
  p.transform(t.pushOut(p).transform);
  assert.ok(p.touches(base) && !p.intersects(base));
  // la cara de arriba del larguero: normal (-1, 1, 0)/√2, a 2 del centro
  const n = new Vector3d(-1, 1, 0).unitize();
  const cs = p.contactsWith(base);
  assert.ok(cs.length && cs.every((c) => c.points.every((q) => Math.abs(n.dot(q.toArray()) - 2) <= 0.2)), 'el contacto está sobre la cara inclinada');
});

test('sacar del choque respeta el piso: no la mete abajo', () => {
  const t = createWorkshop();
  t.addPiece({ size: [60, 10, 40], center: [0, 5, 0] });
  const p = t.addPiece({ size: [10, 4, 10], center: [0, 1, 0] });          // metida por abajo: salir hacia abajo es lo más corto
  assert.ok(t.pushOut(p).transform.translationVector.y < 0, 'sin piso, sale por abajo');
  const r = t.pushOut(p, { floor: 0 });
  assert.ok(r.transform.translationVector.equals([0, 11, 0], 1e-9), 'con piso en 0, sale por arriba: 11');
  p.transform(r.transform);
  assert.ok(p.boundingBox.min.y >= -1e-9, 'queda arriba del piso');
});

test('apoyar: cuánto baja hasta tocar lo de abajo, o el piso', () => {
  const t = createWorkshop();
  const mesa = t.addPiece({ size: [60, 2, 40], center: [0, 74, 0] });       // tapa de y 73 a 75
  const caja = t.addPiece({ size: [10, 10, 10], center: [0, 100, 0] });
  const r = t.drop(caja);
  cerca([r.distance], [20]);
  assert.equal(r.on.id, mesa.id);
  caja.transform(r.transform);
  assert.ok(caja.touches(mesa) && !caja.intersects(mesa));
  const afuera = t.addPiece({ size: [10, 10, 10], center: [100, 50, 0] });
  assert.equal(t.drop(afuera), null, 'sin nada abajo ni piso: nada');
  const alPiso = t.drop(afuera, { floor: 0 });
  cerca([alPiso.distance], [45]);
  assert.equal(alPiso.on, null);
  const girada = t.addPiece({ size: [10, 10, 10], center: [0, 100, 0] }).rotate(45, 'z');
  cerca([t.drop(girada, { against: [mesa] }).distance], [100 - 5 * Math.SQRT2 - 75], 1e-9, 'girada, apoya con su arista');
});

test('las guías: con qué planos quedó alineada, los más cercanos primero', () => {
  const t = createWorkshop();
  const base = t.addPiece({ size: [60, 2, 40], center: [30, 1, 0] });
  const p = t.addPiece({ size: [10, 2, 10], center: [65.05, 1, 0] });       // al ras arriba y abajo; su -x a 0,05 del canto
  const g = t.alignmentGuides(p);
  assert.equal(g[0].kind, 'flush');
  assert.ok(g.some((x) => x.kind === 'face' && Math.abs(x.gap - 0.05) < 1e-9 && x.other.id === base.id));
  assert.deepEqual(g.map((x) => Math.abs(x.gap)), [...g.map((x) => Math.abs(x.gap))].sort((a, b) => a - b));
});

test('un grupo que se mueve junto: el imán y apoyar se calculan para el grupo entero', () => {
  const t = createWorkshop();
  const mesa = t.addPiece({ size: [60, 2, 40], center: [0, 1, 0] });
  const a = t.addPiece({ size: [4, 20, 4], center: [-10, 30, 0] });
  const b = t.addPiece({ size: [4, 10, 4], center: [10, 30, 0] });           // la de abajo es a: y 20
  const r = t.drop([a, b]);
  cerca([r.distance], [18], 1e-9, 'baja hasta que la más baja toca');
  assert.equal(r.on.id, mesa.id);
});

test('orient: la cara de A sobre la de B, enfrentadas, con los centros juntos; flip gira el ancho 180°', () => {
  const t = createWorkshop();
  const a = t.addPiece({ size: [20, 2, 10], center: [100, 50, 30] }).rotate(30, 'x');
  const b = t.addPiece({ size: [60, 4, 40], center: [0, 2, 0] });
  const caraA = a.faces.find((f) => f.localAxis === 'y' && f.localSide === -1);
  const caraB = b.faces.find((f) => f.localAxis === 'y' && f.localSide === 1);
  const T = Transform.orient(caraA, caraB);
  a.transform(T);
  const [c] = a.contactsWith(b);
  assert.equal(c.kind, 'face');
  cerca([c.area], [200], 1e-9);
  const nueva = a.faces.find((f) => f.localAxis === 'y' && f.localSide === -1);
  assert.ok(nueva.center.equals(caraB.center, 1e-9), 'los centros juntos');
  const largo = a.directions.length;
  a.transform(Transform.orient(nueva, caraB, { flip: true }));
  assert.ok(a.directions.length.equals(largo.reverse(), 1e-9), 'con flip, el largo queda al revés');
  const mismoLado = Transform.orient(caraA, caraB, { faceToward: false });
  assert.ok(caraA.normal.transform(mismoLado).equals(caraB.normal, 1e-9));
});

// ---------- recortes: una pieza pierde el volumen de otra ----------

/** Dos largueros cruzados en la misma altura: a lo largo de x y de z. */
const cruzados = (t) => {
  const a = t.addPiece({ name: 'A', size: [100, 4, 4], center: [0, 2, 0] });
  const b = t.addPiece({ name: 'B', size: [4, 4, 100], center: [0, 2, 0] });
  return { a, b };
};

test('dos largueros cruzados: después de recortar no hay intersección entre ellos y sí hay contacto', () => {
  const t = createWorkshop();
  const { a, b } = cruzados(t);
  assert.ok(a.intersects(b));
  a.addOperation({ kind: 'trim', against: b.id });
  assert.ok(!a.intersects(b), 'con un recorte, el choque se mira con la forma real');
  assert.ok(a.touches(b));
  assert.equal(t.collisions().length, 0);
  assert.ok(t.contacts().every((c) => c.kind === 'face'), 'tocan cara contra cara');
  cerca([a.local.solid.volume], [100 * 16 - 4 * 16], 1e-9, 'perdió el pedazo de B');
  assert.ok(a.intersects(b, { exact: false }), 'exact: false fuerza las cajas');
  assert.deepEqual(a.dims, { length: 100, width: 4, thickness: 4 }, 'el bruto no cambia');
});

test('mover la otra pieza recalcula; mover el ensamble que contiene a las dos, no', () => {
  const t = createWorkshop();
  const { a, b } = cruzados(t);
  a.addOperation({ kind: 'trim', against: b.id });
  const antes = a.local.solid;
  b.move([0, 3, 0]);                     // sube 3: solo 1 de su espesor sigue adentro de A
  cerca([a.local.solid.volume], [100 * 16 - 4 * 4], 1e-9);
  const ahora = a.local.solid;
  const e = t.assemble([a, b]);
  e.rotate(90, 'y').move([10, 0, 0]);
  assert.equal(a.local.solid, ahora, 'la misma: no se recalculó');
  assert.deepEqual(pts(a.local.vertices), pts(a.local.vertices));
  assert.notEqual(antes, ahora);
});

test('sacar el recorte devuelve la forma original', () => {
  const t = createWorkshop();
  const { a, b } = cruzados(t);
  const original = a.local.solid.positions;
  a.addOperation({ kind: 'trim', against: b.id });
  a.removeOperation('O-1');
  assert.deepEqual(a.local.solid.positions, original);
});

test('borrar la otra pieza quita el recorte, en el mismo paso: deshacer devuelve las dos', () => {
  const t = createWorkshop();
  const { a, b } = cruzados(t);
  a.addOperation({ kind: 'trim', against: b.id });
  const ev = [];
  t.on((x) => ev.push(x));
  b.remove();
  assert.deepEqual(a.operations, []);
  assert.ok(ev.some((x) => x.type === 'operation' && x.ids.includes(a.id)), 'avisa que A cambió');
  t.undo();
  assert.deepEqual(a.operations.map((o) => o.kind), ['trim']);
  assert.ok(!a.intersects(b));
});

test('mover la otra pieza avisa también por la que se recorta (para que el visor rehaga su malla)', () => {
  const t = createWorkshop();
  const { a, b } = cruzados(t);
  a.addOperation({ kind: 'trim', against: b.id });
  const ev = [];
  t.on((x) => ev.push(x));
  b.move([0, 1, 0]);
  assert.ok(ev.at(-1).ids.includes(a.id));
});

test('recortar con la forma real de la otra (mode: shape)', () => {
  const t = createWorkshop();
  const tabla = t.addPiece({ size: [40, 2, 40], center: [0, 1, 0] });
  const barra = t.addPiece({ size: [4, 4, 60], shape: BARRA(2), center: [0, 2, 0] }); // atraviesa la tabla por su eje
  tabla.addOperation({ kind: 'trim', against: barra.id, mode: 'shape' });
  cerca([tabla.local.solid.volume], [40 * 2 * 40 - 40 * poligono(2) / 2], 1e-6, 'pierde la media barra que tiene adentro');
  const t2 = createWorkshop();
  const tabla2 = t2.addPiece({ size: [40, 2, 40], center: [0, 1, 0] });
  const barra2 = t2.addPiece({ size: [4, 4, 60], shape: BARRA(2), center: [0, 2, 0] });
  tabla2.addOperation({ kind: 'trim', against: barra2.id });
  cerca([tabla2.local.solid.volume], [40 * 2 * 40 - 40 * 2 * 4], 1e-6, 'con la caja (por defecto), pierde la caja');
});

test('recortes: errores claros', () => {
  const t = createWorkshop();
  const { a } = cruzados(t);
  assert.throws(() => a.addOperation({ kind: 'trim', against: a.id }), /contra sí misma/);
  assert.throws(() => a.addOperation({ kind: 'trim', against: 'P-99' }), /no existe la parte P-99/);
  assert.throws(() => a.addOperation({ kind: 'trim', against: 'P-2', mode: 'casi' }), /mode casi/);
  assert.deepEqual(a.operations, []);
});

test('en una instancia, el recorte es contra la pieza de la misma instancia', () => {
  const t = createWorkshop();
  const { a, b } = cruzados(t);
  a.addOperation({ kind: 'trim', against: b.id });
  const e = t.assemble([a, b]);
  const [i] = t.array(e, { type: 'linear', count: 2, direction: [1, 0, 0], distance: 300 });
  const copiaA = i.children.find((x) => x.source.id === a.id);
  cerca([copiaA.local.solid.volume], [a.local.solid.volume], 1e-9);
  assert.ok(!copiaA.intersects(i.children.find((x) => x.source.id === b.id)));
  assert.ok(copiaA.intersects(b, { exact: false }) === false, 'y con la B de afuera ni se cruza');
});

test('con kernel, el recorte resta la otra pieza (llevada al marco de esta)', () => {
  const llamadas = [];
  const kernel = {
    intersect: (x) => x,
    subtract: (x, y) => { llamadas.push(y.boundingBox); return { positions: x.positions, indices: x.indices }; },
  };
  const t = createWorkshop({ kernel });
  const { a, b } = cruzados(t);
  b.move([10, 0, 0]);
  a.addOperation({ kind: 'trim', against: b.id }).addOperation({ kind: 'hole', axis: 0, side: 1, at: [0.5, 0.5], diameter: 1 });
  a.local.solid;
  assert.equal(llamadas.length, 2);
  cerca([llamadas[0].center.x, llamadas[0].min.z, llamadas[0].max.z], [10, -50, 50], 1e-9, 'la caja de B, en el marco de A');
});

// ---------- estirar un conjunto por un plano ----------

/** Una mesa: tapa de 90 × 2 × 50 a 74 de altura y cuatro patas de 4 × 74 × 4 en las esquinas. */
const mesa = (t) => {
  const tapa = t.addPiece({ name: 'Tapa', size: [90, 2, 50], center: [0, 75, 0] });
  const patas = [[-43, -23], [43, -23], [-43, 23], [43, 23]].map(([x, z]) => t.addPiece({ name: 'Pata', size: [4, 74, 4], center: [x, 37, z] }));
  return { tapa, patas, m: t.assemble([tapa, ...patas], { name: 'Mesa' }) };
};
/** Lo que ocupa cada pieza en el marco del ensamble, redondeado. */
const enElEnsamble = (e) => e.pieces.map((p) => {
  const b = BoundingBox.fromPoints(p.vertices.map((v) => v.transform(e.placement.inverse())));
  return [...b.min.toArray(), ...b.max.toArray()].map((v) => Math.round(v * 1e6) / 1e6).join(',');
});

test('mesa: estirar el ancho +20 desde la derecha: la tapa crece 20, las patas derechas se corren 20 y las izquierdas quedan', () => {
  const t = createWorkshop();
  const { tapa, patas, m } = mesa(t);
  assert.deepEqual(m.stretchPlanes('x')[0], { plane: 0, gap: 82 }, 'el hueco más ancho: entre las patas');
  const plan = m.stretch({ axis: 'x', side: 1, delta: 20 });
  assert.equal(plan.limited, false);
  assert.deepEqual(plan.pieces.map((x) => x.action), ['stretch', 'stay', 'move', 'stay', 'move']);
  assert.equal(tapa.dims.length, 110);
  cerca([tapa.boundingBox.min.x, tapa.boundingBox.max.x], [-45, 65]);
  cerca(patas.map((p) => p.boundingBox.center.x), [-43, 63, -43, 63]);
  t.undo();
  assert.equal(tapa.dims.length, 90, 'un solo paso de deshacer');
});

test('achicar más allá del mínimo se limita: los lados no se cruzan', () => {
  const t = createWorkshop();
  const { tapa, patas, m } = mesa(t);
  const plan = m.stretchPlan({ axis: 'x', delta: -200 });
  assert.equal(plan.limited, true);
  cerca([plan.min], [-82], 1e-9, 'hasta que las patas de un lado tocan las del otro');
  m.stretch({ axis: 'x', delta: -200 });
  cerca([tapa.dims.length, patas[1].boundingBox.min.x], [8, -41]);
  assert.ok(patas[1].touches(patas[0]) && !patas[1].intersects(patas[0]));
  const sola = createWorkshop();
  const larga = sola.addPiece({ size: [100, 4, 4] });
  const e = sola.assemble([larga, sola.addPiece({ size: [4, 4, 4], center: [60, 0, 0] })]);
  e.stretch({ axis: 'x', plane: 0, delta: -1000, minLength: 5 });
  assert.equal(larga.dims.length, 5, 'ninguna estirada baja del mínimo');
});

test('estirar partes sueltas en el workshop da lo mismo que hacerlo en un ensamble con esas partes', () => {
  const sueltas = createWorkshop(), armadas = createWorkshop();
  const a = mesa(sueltas), b = mesa(armadas);
  const plan = sueltas.stretch({ parts: [a.tapa, ...a.patas], axis: 'x', side: 1, delta: 20 });
  b.m.stretch({ axis: 'x', side: 1, delta: 20 });
  assert.deepEqual(plan.pieces.map((x) => x.action), ['stretch', 'stay', 'move', 'stay', 'move']);
  assert.equal(plan.plane, 0);
  cerca([a.tapa.boundingBox.min.x, a.tapa.boundingBox.max.x], [b.tapa.boundingBox.min.x, b.tapa.boundingBox.max.x]);
  cerca(a.patas.map((p) => p.boundingBox.center.x), b.patas.map((p) => p.boundingBox.center.x));
  assert.equal(a.tapa.dims.length, 110);
  sueltas.undo();
  assert.equal(a.tapa.dims.length, 90, 'un solo paso de deshacer');
  cerca(a.patas.map((p) => p.boundingBox.center.x), [-43, 43, -43, 43]);
});

test('workshop.stretchPlan no toca nada, y deja afuera lo que no se pasa', () => {
  const t = createWorkshop();
  const { tapa, patas } = mesa(t);
  const otra = t.addPiece({ size: [4, 4, 4], center: [200, 0, 0] });
  const plan = t.stretchPlan({ parts: [tapa, ...patas], axis: 'x', delta: 20 });
  assert.equal(tapa.dims.length, 90);
  assert.ok(!plan.pieces.some((x) => x.part.id === otra.id), 'la pieza que no se pasó no entra');
  assert.equal(t.stretchPlanes({ parts: [tapa, ...patas], axis: 'x' })[0].plane, 0);
  t.stretch({ parts: [tapa, ...patas], axis: 'x', delta: 20 });
  cerca([otra.boundingBox.center.x], [200]);
});

test('workshop.stretch: el eje es del mundo, y un ensamble o una parte repetida entran una sola vez', () => {
  const t = createWorkshop();
  const { tapa, patas, m } = mesa(t);
  m.rotate(90, 'y');
  const plan = t.stretchPlan({ parts: [m, tapa, m], axis: 'z', delta: 10 });
  assert.equal(plan.pieces.length, 5, 'cinco piezas, sin repetir');
  assert.throws(() => t.stretchPlan({ parts: [], axis: 'x' }), /falta `parts`/);
  assert.throws(() => t.stretchPlan({ parts: [tapa], axis: 'w' }), /eje inválido: w \(va 'x', 'y', 'z' del mundo\)/);
});

test('las patas bloqueadas nunca se estiran: el plano que las cruza las mueve o las deja enteras', () => {
  const t = createWorkshop();
  const { tapa, patas, m } = mesa(t);
  // en el marco del ensamble (su origen, en el centro de lo que junta: y = 38), las patas van de -38 a 36
  assert.deepEqual(m.stretchPlanes('y', { locked: patas }).map((p) => p.plane), [37], 'no se ofrece un plano que cruce una pata bloqueada');
  const plan = m.stretch({ axis: 'y', plane: -1, delta: 10, locked: patas });
  assert.ok(plan.pieces.filter((x) => x.part.name === 'Pata').every((x) => x.action !== 'stretch' && x.reason === 'locked'));
  assert.ok(patas.every((p) => p.dims.length === 74));
  cerca([tapa.boundingBox.min.y], [84], 1e-9, 'la tapa, del lado que se arrastra, sube 10');
});

test('la misma mesa girada 90° da el mismo resultado en el marco del ensamble', () => {
  const recto = createWorkshop(), girado = createWorkshop();
  const a = mesa(recto), b = mesa(girado);
  b.m.rotate(90, 'y').rotate(30, 'x');
  a.m.stretch({ axis: 'x', delta: 20 });
  b.m.stretch({ axis: 'x', delta: 20 });
  assert.deepEqual(enElEnsamble(b.m), enElEnsamble(a.m));
});

test('una pieza que cruza el plano en diagonal se mueve entera con el lado de su centro', () => {
  const t = createWorkshop();
  const larguero = t.addPiece({ size: [200, 4, 10] });
  const diagonal = t.addPiece({ size: [60, 4, 4], center: [5, 20, 0] }).rotate(45, 'z');
  const e = t.assemble([larguero, diagonal]);
  const plan = e.stretchPlan({ axis: 'x', plane: 0, delta: 10 });
  const d = plan.pieces.find((x) => x.part.id === diagonal.id);
  assert.deepEqual([d.action, d.reason], ['move', 'diagonal']);
  assert.equal(plan.pieces.find((x) => x.part.id === larguero.id).action, 'stretch');
});

test('estirar una pieza con operaciones las reaplica (van normalizadas)', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [60, 4, 5] }).addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO });
  const e = t.assemble([p, t.addPiece({ size: [4, 4, 4], center: [40, 0, 0] })]);
  e.stretch({ axis: 'x', plane: 0, delta: 60 });
  cerca([p.local.solid.volume], [0.75 * 120 * 4 * 5], 1e-9);
});

// ---------- relaciones: lo común (#12) ----------
// Una relación vive en el documento: se deshace, se guarda, se limpia si se borra una de sus
// partes, y se copia (o se ve) con lo que se copia.

/** Un mueble simple: dos laterales y un estante entre ellos, que los toca. */
const mueble = (t) => {
  const izq = t.addPiece({ name: 'Lateral izq', size: [2, 70, 50], center: [-31, 35, 0] });   // x de -32 a -30
  const der = t.addPiece({ name: 'Lateral der', size: [2, 70, 50], center: [31, 35, 0] });    // x de 30 a 32
  const est = t.addPiece({ name: 'Estante', size: [60, 2, 50], center: [0, 35, 0] });        // x de -30 a 30
  return { izq, der, est };
};
const anclar = (t, { izq, der, est }, gap) => [
  t.addLink({ base: izq, face: { axis: 'x', side: 1 }, moving: est, gap }),
  t.addLink({ base: der, face: { axis: 'x', side: -1 }, moving: est, gap }),
];
const xDe = (p) => [p.boundingBox.min.x, p.boundingBox.max.x];

test('una relación se guarda: toJSON → load → toJSON da lo mismo, y load revisa que sus partes existan', () => {
  const t = createWorkshop();
  const m = mueble(t);
  anclar(t, m);
  t.addFixing({ a: m.izq, b: m.est, count: 2, holes: { a: { diameter: 0.5 }, b: { diameter: 0.4, depth: 4 } }, meta: { tipo: 'cualquiera' } });
  const json = JSON.stringify(t.toJSON());
  assert.equal(JSON.parse(json).version, 5);
  const u = createWorkshop();
  u.load(JSON.parse(json));
  assert.equal(JSON.stringify(u.toJSON()), json);
  assert.equal(u.relations().length, 3);
  assert.deepEqual(u.relation('R-3').meta, { tipo: 'cualquiera' }, 'lo de la app viaja con ella, y el SDK no lo lee');
  const malo = JSON.parse(json);
  malo.relations[0].parts = ['P-1', 'P-99'];
  assert.throws(() => u.load(malo), /la relación R-1 apunta a P-99, que no existe/);
  assert.equal(JSON.stringify(u.toJSON()), json, 'un documento malo no se carga a medias');
});

test('borrar una parte borra sus relaciones (y los agujeros que dejaron en la otra), en el mismo paso', () => {
  const t = createWorkshop();
  const m = mueble(t);
  const [l1] = anclar(t, m);
  const f = t.addFixing({ a: m.izq, b: m.est, count: 2, holes: { b: { diameter: 0.4, depth: 4 } } });
  assert.equal(m.est.operations.length, 2, 'los agujeros de la unión son operaciones del estante');
  const ev = [];
  t.on((e) => ev.push(e));
  m.izq.remove();
  assert.deepEqual(t.relations().map((r) => r.id), ['R-2'], 'se fueron el vínculo y la unión del lateral; queda el del otro');
  assert.equal(m.est.operations.length, 0, 'sin la unión, el estante no tiene sus agujeros');
  assert.ok(ev.some((e) => e.type === 'relation-remove' && e.ids.includes(f.id)));
  assert.throws(() => l1.gap, /no existe la relación R-1/);
  t.undo();
  assert.deepEqual(t.relations().map((r) => r.id), ['R-1', 'R-2', 'R-3'], 'deshacer devuelve la pieza y sus relaciones');
  assert.equal(m.est.operations.length, 2);
});

test('duplicar copia las relaciones de adentro con ids nuevos; instanciar las muestra; soltar las hace propias', () => {
  const t = createWorkshop();
  const m = mueble(t);
  anclar(t, m);
  const e = t.assemble([m.izq, m.der, m.est]);
  const copia = e.duplicate();
  const nuevas = t.relations({ kind: 'link' }).filter((r) => r.parts.some((p) => copia.pieces.includes(p)));
  assert.equal(nuevas.length, 2);
  assert.ok(nuevas.every((r) => r.parts.every((p) => copia.pieces.includes(p))), 'las copias apuntan a las piezas nuevas');
  const i = t.instantiate(e, { placement: Transform.translation([0, 0, 100]) });
  const vistas = t.relations({ part: `${i.id}/P-3` });
  assert.deepEqual(vistas.map((r) => r.id).sort(), [`${i.id}/R-1`, `${i.id}/R-2`]);
  assert.ok(vistas.every((r) => r.isVirtual));
  assert.throws(() => vistas[0].remove(), /se cambia en su fuente/);
  assert.throws(() => t.addLink({ base: `${i.id}/P-1`, face: { axis: 'x', side: 1 }, moving: m.est }), /es parte de la instancia/);
  i.detach();
  const propias = t.relations({ kind: 'link' }).filter((r) => r.parts.every((p) => i.pieces.includes(p)));
  assert.equal(propias.length, 2, 'la instancia suelta tiene sus propios vínculos');
  assert.ok(propias.every((r) => !r.isVirtual));
});

test('las relaciones entran en el deshacer, y crear una avisa', () => {
  const t = createWorkshop();
  const m = mueble(t);
  const ev = [];
  t.on((e) => ev.push(e));
  const l = t.addLink({ base: m.izq, face: { axis: 'x', side: 1 }, moving: m.est });
  assert.ok(ev.some((e) => e.type === 'relation' && e.ids.includes(l.id)));
  l.setGap(-1);
  assert.equal(l.gap, -1);
  t.undo();
  assert.equal(t.relation(l.id).gap, 0);
  t.undo();
  assert.equal(t.relations().length, 0);
  t.redo();
  assert.equal(t.relations().length, 1);
  assert.deepEqual(RELATION_KINDS, ['joint', 'fixing', 'link']);
});

// ---------- juntas (#13) ----------

/** Un lateral y una puerta delante, que lo tapa: la puerta va de x -25 a 25, de z 25 a 27. */
const puertaYLateral = (t) => {
  const lat = t.addPiece({ name: 'Lateral', size: [2, 70, 50], center: [-24, 35, 0] });      // x de -25 a -23, z de -25 a 25
  const puerta = t.addPiece({ name: 'Puerta', size: [50, 70, 2], center: [0, 35, 26] });
  return { lat, puerta };
};

test('bisagra: el canto propuesto es el de al lado del lateral, y abierta a 90° la puerta queda perpendicular, sobre el canto', () => {
  const t = createWorkshop();
  const { lat, puerta } = puertaYLateral(t);
  const [c0] = t.hingeCandidates(puerta, lat);
  cerca([c0.axis.from.x, c0.axis.from.z, c0.axis.to.x, c0.axis.to.z], [-25, 25, -25, 25], 1e-9, 'el canto de atrás de la puerta, del lado del lateral');
  assert.equal(c0.axis.length, 70, 'a lo largo del canto');
  const j = t.addJoint(c0);
  assert.equal(j.type, 'revolute');
  const antes = JSON.stringify(t.toJSON());
  const a0 = j.at(0);
  assert.ok(a0.placements[puerta.id].frame.t.every((v, k) => Math.abs(v - puerta.placement.frame.t[k]) < 1e-9), 'cerrada es el modelo');
  const a90 = j.at(90);
  const caja = BoundingBox.fromPoints(puerta.local.vertices.map((v) => v.transform(a90.placements[puerta.id])));
  cerca([caja.min.x, caja.max.x, caja.min.z, caja.max.z], [-27, -25, 25, 75], 1e-9, 'abierta: de canto, hacia afuera del mueble');
  assert.ok(puerta.local.vertices.map((v) => v.transform(a90.placements[puerta.id])).some((v) => v.equals([-25, 0, 25])), 'su canto sigue sobre el de la bisagra');
  assert.equal(JSON.stringify(t.toJSON()), antes, 'abrir no toca el documento');
});

test('bisagra: con el mueble girado, abrir da lo mismo respecto del mueble', () => {
  const caja90 = (girar) => {
    const t = createWorkshop();
    const { lat, puerta } = puertaYLateral(t);
    const e = t.assemble([lat, puerta]);
    if (girar) e.rotate(90, 'y').rotate(30, 'x');
    const j = t.addJoint(t.hingeCandidates(puerta, lat)[0]);
    const enLat = lat.placement.inverse();
    return BoundingBox.fromPoints(puerta.local.vertices.map((v) => v.transform(j.at(90).placements[puerta.id]).transform(enLat)));
  };
  const a = caja90(false), b = caja90(true);
  cerca([...b.min.toArray(), ...b.max.toArray()], [...a.min.toArray(), ...a.max.toArray()], 1e-9);
});

test('corredera de cajón: la única salida es el frente, y at(value) se limita al largo', () => {
  const t = createWorkshop();
  const cuerpo = t.assemble([
    t.addPiece({ size: [2, 30, 50], center: [-21, 15, 0] }), t.addPiece({ size: [2, 30, 50], center: [21, 15, 0] }),
    t.addPiece({ size: [40, 2, 50], center: [0, 1, 0] }), t.addPiece({ size: [40, 2, 50], center: [0, 29, 0] }),
    t.addPiece({ size: [40, 26, 2], center: [0, 15, -24] }),
  ]);
  const cajon = t.addPiece({ name: 'Cajón', size: [39, 20, 47], center: [0, 15, 1.5] });
  const cs = t.slideCandidates(cajon, cuerpo);
  assert.equal(cs.length, 1, 'atrás, arriba, abajo y a los costados choca');
  assert.ok(cs[0].axis.direction.unitize().equals([0, 0, 1]));
  const j = t.addJoint(cs[0]);
  assert.deepEqual(j.limits, { min: 0, max: 47 });
  const r = j.at(100);
  assert.equal(r.value, 47);
  assert.ok(r.limited);
  cerca(r.placements[cajon.id].frame.t, [0, 15, 48.5], 1e-9);
  assert.equal(t.addJoint({ type: 'prismatic', moving: cajon, base: cuerpo, axis: [0, 0, 1] }).limits.max, 47, 'sin límites, la corredera llega hasta el largo de la móvil');
  assert.throws(() => t.addJoint({ type: 'helicoidal', moving: cajon, base: cuerpo, axis: [0, 0, 1] }), /tipo de junta inválido/);
  assert.deepEqual(JOINT_TYPES, ['revolute', 'prismatic']);
});

// ---------- uniones (#14) ----------

/** El centro de la boca de un agujero (una operación) en el mundo, y hacia dónde entra. */
const bocaDe = (p, op) => {
  const s = [p.size.x, p.size.y, p.size.z];
  const q = [0, 0, 0];
  q[op.axis] = (op.side * s[op.axis]) / 2;
  const [u, v] = [0, 1, 2].filter((i) => i !== op.axis);
  q[u] = op.at[0] * s[u] - s[u] / 2;
  q[v] = op.at[1] * s[v] - s[v] / 2;
  const n = [0, 0, 0];
  n[op.axis] = -op.side;
  return { boca: new Point3d(...q).transform(p.placement), hacia: new Vector3d(...n).transform(p.placement) };
};
const aLaRecta = (punto, { boca, hacia }) => punto.subtract(boca).cross(hacia).length;

test('unión entre lateral y estante: 2 puntos en 1/3 y 2/3, que siguen ahí al estirar', () => {
  const t = createWorkshop();
  const { izq, der, est } = mueble(t);
  const f = t.addFixing({ a: izq, b: est, count: 2 });
  assert.deepEqual(f.points.map((p) => p.uv), [[0.5, 1 / 3], [0.5, 2 / 3]], 'a lo largo del lado largo del parche (u, v: y, z del lateral)');
  cerca(f.points.map((p) => p.point.z), [-25 + 50 / 3, -25 + 100 / 3], 1e-9);
  assert.ok(f.direction.equals([1, 0, 0]), 'entra por el lateral, hacia el estante');
  assert.deepEqual(f.points[0].thickness, { a: 2, b: 60 }, 'atraviesa el lateral y agarra a lo largo del estante');
  const e = t.assemble([izq, der, est]);
  e.stretch({ axis: 'z', plane: 0, delta: 15 });
  assert.equal(est.size.z, 65);
  assert.deepEqual(f.points.map((p) => p.uv), [[0.5, 1 / 3], [0.5, 2 / 3]]);
  cerca(f.points.map((p) => p.point.z), [-25 + 65 / 3, -25 + 130 / 3], 1e-9, 'en 1/3 y 2/3 del parche estirado');
});

test('los agujeros de una unión caen en las dos piezas en el mismo punto del mundo, también con el mueble girado', () => {
  const t = createWorkshop();
  const { izq, der, est } = mueble(t);
  const f = t.addFixing({ a: izq, b: est, count: 2, holes: { a: { diameter: 0.5 }, b: { diameter: 0.4, depth: 4 } } });
  const revisar = (msg) => {
    const [ha, hb] = [izq.operations, est.operations];
    assert.equal(ha.length, 2, msg);
    assert.equal(hb.length, 2, msg);
    assert.ok(ha.every((o) => o.kind === 'hole' && o.diameter === 0.5 && o.depth === undefined), 'en el lateral, pasante');
    assert.ok(hb.every((o) => o.depth === 4), 'en el estante, con su profundidad');
    f.points.forEach((p, i) => {
      assert.ok(aLaRecta(p.point, bocaDe(izq, ha[i])) < 1e-9, `${msg}: el agujero ${i} del lateral pasa por el punto`);
      assert.ok(aLaRecta(p.point, bocaDe(est, hb[i])) < 1e-9, `${msg}: el agujero ${i} del estante pasa por el punto`);
      assert.ok(bocaDe(est, hb[i]).boca.equals(p.point), `${msg}: el del estante empieza en el contacto`);
    });
  };
  revisar('derecho');
  const e = t.assemble([izq, der, est]);
  e.rotate(37, 'z').rotate(90, 'y');
  revisar('girado');
  assert.deepEqual(f.points.map((p) => p.uv), [[0.5, 1 / 3], [0.5, 2 / 3]]);
  f.update({ points: [[0.5, 0.5]] }); // un punto: un agujero por pieza
  assert.equal(izq.operations.length, 1);
  assert.equal(est.operations.length, 1);
  assert.ok(aLaRecta(f.points[0].point, bocaDe(izq, izq.operations[0])) < 1e-9);
});

test('si las piezas se separan, la unión queda rota (y avisa); con policy remove se borra, con sus agujeros', () => {
  const t = createWorkshop();
  const { izq, est } = mueble(t);
  const f = t.addFixing({ a: izq, b: est, holes: { b: { diameter: 0.4, depth: 4 } } });
  const ev = [];
  t.on((e) => ev.push(e));
  izq.move([-5, 0, 0]);
  assert.match(f.broken, /ya no se tocan/);
  assert.ok(ev.some((e) => e.type === 'relation-broken' && e.ids.includes(f.id)));
  assert.equal(f.direction, null);
  izq.move([5, 0, 0]);
  assert.equal(f.broken, null, 'se vuelven a tocar: vale otra vez');
  f.update({ policy: 'remove' });
  ev.length = 0;
  izq.move([-5, 0, 0]);
  assert.equal(t.relations().length, 0);
  assert.equal(est.operations.length, 0, 'sin la unión no quedan sus agujeros');
  assert.ok(ev.some((e) => e.type === 'relation-remove' && e.ids.includes(f.id)));
  t.undo();
  assert.equal(t.relations().length, 1, 'deshacer la devuelve');
  assert.throws(() => t.addFixing({ a: izq, b: t.addPiece({ size: [1, 1, 1], center: [100, 0, 0] }) }), /no se tocan cara con cara/);
});

test('dentro de una transacción la unión no se rompe por un estado a medio hacer', () => {
  const t = createWorkshop();
  const { izq, est } = mueble(t);
  const f = t.addFixing({ a: izq, b: est, policy: 'remove' });
  t.transaction(() => {
    izq.move([-5, 0, 0]);
    izq.move([5, 0, 0]);
  });
  assert.equal(t.relations().length, 1);
  assert.equal(f.broken, null);
});

// ---------- vínculos (#15) ----------

test('estante entre dos laterales: mover un lateral 10 estira el estante 10, y deshacer devuelve los dos', () => {
  const t = createWorkshop();
  const m = mueble(t);
  anclar(t, m);
  m.der.move([10, 0, 0]);
  assert.equal(m.est.size.x, 70);
  cerca(xDe(m.est), [-30, 40], 1e-9);
  m.izq.move([-4, 0, 0]);
  cerca(xDe(m.est), [-34, 40], 1e-9);
  t.undo();
  cerca(xDe(m.est), [-30, 40], 1e-9, 'un paso deshace el lateral y el estante');
  t.undo();
  assert.equal(m.est.size.x, 60);
  cerca(xDe(m.est), [-30, 30], 1e-9);
});

test('una sola punta anclada: la pieza se mueve con la base y conserva su largo; gap negativo la mete', () => {
  const t = createWorkshop();
  const m = mueble(t);
  const l = t.addLink({ base: m.izq, face: { axis: 'x', side: 1 }, moving: m.est });
  m.izq.move([-3, 0, 0]);
  assert.equal(m.est.size.x, 60);
  cerca(xDe(m.est), [-33, 27], 1e-9);
  l.setGap(-1);
  cerca(xDe(m.est), [-34, 26], 1e-9, 'con gap -1 el estante entra 1 en el lateral');
  const u = createWorkshop();
  const m2 = mueble(u);
  anclar(u, m2, -1);
  assert.equal(m2.est.size.x, 62, 'anclado a los dos con gap -1: entra 1 en cada uno');
  cerca(xDe(m2.est), [-31, 31], 1e-9);
});

test('con el mueble girado, mover un lateral da lo mismo respecto del mueble', () => {
  const t = createWorkshop();
  const m = mueble(t);
  const e = t.assemble([m.izq, m.der, m.est]);
  e.rotate(90, 'y').rotate(25, 'x');
  anclar(t, m);
  m.der.move(m.der.axes.x.multiply(10));
  assert.ok(Math.abs(m.est.size.x - 70) < 1e-9);
  const enLat = m.izq.placement.inverse();
  const b = BoundingBox.fromPoints(m.est.vertices.map((v) => v.transform(enLat)));
  cerca([b.min.x, b.max.x], [1, 71], 1e-9, 'en el marco del lateral, el estante sigue al ras de los dos');
});

test('un ciclo, una punta de más o caras no paralelas se rechazan sin cambiar nada', () => {
  const t = createWorkshop();
  const m = mueble(t);
  anclar(t, m);
  const antes = JSON.stringify(t.toJSON());
  const ciclo = { base: m.est, face: { axis: 'x', side: -1 }, moving: m.izq };
  assert.deepEqual({ ...t.validateLink(ciclo) }.reason, 'cycle');
  assert.throws(() => t.addLink(ciclo), /sería un ciclo: P-1 → P-3 → P-1/);
  const otro = t.addPiece({ size: [2, 70, 50], center: [-40, 35, 0] });
  assert.equal(t.validateLink({ base: otro, face: { axis: 'x', side: 1 }, moving: m.est }).reason, 'over-constrained');
  assert.match(t.validateLink({ base: otro, face: { axis: 'x', side: 1 }, moving: m.est }).message, /ya está anclada por R-1/);
  const girada = t.addPiece({ size: [2, 70, 50], center: [-60, 35, 0] }).rotate(30, 'y');
  assert.equal(t.validateLink({ base: girada, face: { axis: 'x', side: 1 }, moving: otro }).reason, 'not-parallel');
  assert.equal(t.validateLink({ base: m.est, face: { axis: 'x', side: 1 }, moving: m.est }).reason, 'self');
  assert.equal(t.validateLink({ base: m.izq, face: { axis: 'y', side: 1 }, moving: otro }).ok, true);
  assert.equal(t.relations().length, 2, 'lo rechazado no se creó');
  assert.match(antes, /"relations":\[\{"id":"R-1"/);
});

test('achicar por debajo del mínimo no se hace: la operación falla entera', () => {
  const t = createWorkshop();
  const m = mueble(t);
  anclar(t, m);
  const antes = JSON.stringify(t.toJSON());
  assert.throws(() => m.der.move([-60, 0, 0]), /menos que el mínimo/);
  assert.equal(JSON.stringify(t.toJSON()), antes);
});

test('en cascada: lo que depende de la pieza anclada la sigue, en el orden que haga falta', () => {
  const t = createWorkshop();
  const base = t.addPiece({ size: [2, 70, 50], center: [-31, 35, 0] });          // x de -32 a -30
  const s1 = t.addPiece({ size: [10, 2, 50], center: [-25, 35, 0] });           // x de -30 a -20
  const s2 = t.addPiece({ size: [10, 2, 50], center: [-15, 35, 0] });           // x de -20 a -10
  const s3 = t.addPiece({ size: [10, 2, 50], center: [-5, 35, 0] });            // x de -10 a 0
  t.addLink({ base: s2, face: { axis: 'x', side: 1 }, moving: s3 });            // creados al revés de como dependen
  t.addLink({ base: s1, face: { axis: 'x', side: 1 }, moving: s2 });
  t.addLink({ base, face: { axis: 'x', side: 1 }, moving: s1 });
  base.move([-3, 0, 0]);
  cerca([...xDe(s1), ...xDe(s2), ...xDe(s3)], [-33, -23, -23, -13, -13, -3], 1e-9, 's1 sigue a la base, s2 a s1 y s3 a s2');
  t.undo();
  cerca(xDe(s2), [-20, -10], 1e-9);
});

test('con una matriz, la fuente manda y las copias siguen', () => {
  const t = createWorkshop();
  const m = mueble(t);
  anclar(t, m);
  const e = t.assemble([m.izq, m.der, m.est]);
  const [i] = t.array(e, { type: 'linear', count: 2, direction: [0, 0, 1], distance: 100 });
  m.der.move([10, 0, 0]);
  assert.equal(t.part(`${i.id}/${m.est.id}`).size.x, 70);
  assert.equal(t.relations({ kind: 'link' }).length, 4, 'los de la fuente, y los mismos vistos en la copia');
});

test('duplicar un ensamble con vínculos: la copia se mueve sola, sin tocar a la original', () => {
  const t = createWorkshop();
  const m = mueble(t);
  anclar(t, m);
  const e = t.assemble([m.izq, m.der, m.est]);
  const copia = e.duplicate();
  const [, derCopia, estCopia] = copia.pieces;
  derCopia.move([10, 0, 0]);
  assert.equal(estCopia.size.x, 70);
  assert.equal(m.est.size.x, 60);
});

// ---------- despiece (#16) ----------

/** Un bastidor: dos montantes y dos travesaños. */
const bastidor = (t, z = 0) => t.assemble([
  t.addPiece({ name: 'Montante', size: [4, 100, 2], center: [-23, 50, z], material: 'pino' }),
  t.addPiece({ name: 'Montante', size: [4, 100, 2], center: [23, 50, z], material: 'pino' }),
  t.addPiece({ name: 'Travesaño', size: [42, 4, 2], center: [0, 2, z], material: 'pino' }),
  t.addPiece({ name: 'Travesaño', size: [42, 4, 2], center: [0, 98, z], material: 'pino' }),
]);

test('despiece de los dos bastidores: la copia suma cantidades a las mismas filas', () => {
  const t = createWorkshop();
  const b = bastidor(t);
  const solo = t.cutList();
  assert.deepEqual(solo.map((r) => [r.length, r.width, r.thickness, r.count]), [[100, 4, 2, 2], [42, 4, 2, 2]]);
  t.array(b, { type: 'linear', count: 2, direction: [1, 0, 0], distance: 60 });
  const filas = t.cutList();
  assert.deepEqual(filas.map((r) => [r.material, r.length, r.width, r.thickness, r.count]), [['pino', 100, 4, 2, 4], ['pino', 42, 4, 2, 4]]);
  assert.deepEqual(filas[0].stock, { kind: 'box' });
  assert.ok(filas[0].ids.includes('I-1/P-1'), 'las piezas de la copia van con su id de camino');
  assert.equal(t.cutList({ groupBy: 'none' }).length, 8);
  assert.equal(t.cutList({ groupBy: (p) => p.name }).length, 2);
});

test('el despiece respeta los ejes forzados y reporta el bruto, no la forma recortada', () => {
  const t = createWorkshop();
  t.addPiece({ size: [10, 60, 2], axes: { length: 0, width: 1, thickness: 2 }, material: 'mdf' });
  const p = t.addPiece({ size: [60, 4, 5], center: [0, 20, 0] }).addOperation({ kind: 'cut', axis: 2, outline: TRAPECIO });
  const otra = t.addPiece({ size: [10, 10, 10], center: [30, 20, 0] });
  p.addOperation({ kind: 'trim', against: otra.id });
  const [forzada, recortada] = t.cutList();
  assert.deepEqual([forzada.length, forzada.width, forzada.thickness], [10, 60, 2], 'los ejes pedidos, no los por tamaño');
  assert.deepEqual([recortada.length, recortada.width, recortada.thickness, recortada.count], [60, 5, 4, 1], 'lo que se compra');
});

test('el despiece dice qué uniones tiene cada fila, para los herrajes', () => {
  const t = createWorkshop();
  const m = mueble(t);
  const f = t.addFixing({ a: m.izq, b: m.est, count: 2 });
  const filas = t.cutList();
  assert.deepEqual(filas.find((r) => r.ids.includes(m.est.id)).fixings, [f.id]);
});

// ---------- que el SDK siga siendo puro ----------

test('el SDK no depende de ningún paquete externo ni del navegador (lo puede usar el servidor)', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['src/frame.js', 'src/model.js', 'src/contact.js', 'src/geometry.js', 'src/help.js', 'src/array.js', 'src/units.js', 'src/config.js', 'src/solid.js', 'src/polygon.js', 'src/convex.js', 'src/sections.js', 'src/features.js', 'src/grab.js', 'src/placement.js', 'src/stretch.js', 'src/relations.js', 'src/index.js', 'examples/demo.js']) {
    const src = await readFile(new URL(`../${f}`, import.meta.url), 'utf8');
    const sin = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const ext = [...sin.matchAll(/^\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/gm)]
      .map((m) => m[1]).filter((s) => !s.startsWith('.'));
    assert.deepEqual(ext, [], `${f} importa ${ext.join(', ')}`);
    assert.doesNotMatch(sin, /\b(document|window|THREE)\./, `${f} usa el navegador o three`);
    if (f.startsWith('src/')) assert.doesNotMatch(sin, /from\s*['"]\.\.\//, `${f} importa algo de afuera de src/: el núcleo no conoce al adaptador`);
  }
});

// ---------- validateLink devuelve la punta que se ancla ----------

test('validateLink dice qué punta se va a anclar, igual que el vínculo ya creado', () => {
  const t = createWorkshop();
  const pared = t.addPiece({ size: [2, 70, 50], center: [0, 35, 0] });
  const tabla = t.addPiece({ size: [40, 2, 50], center: [25, 35, 0] });      // su punta -x mira a la pared
  const v = t.validateLink({ base: pared, face: { axis: 'x', side: 1 }, moving: tabla });
  assert.equal(v.ok, true);
  assert.deepEqual({ ...v.end }, { localAxis: 'x', localSide: -1 });
  assert.deepEqual({ ...v.face }, { localAxis: 'x', localSide: 1 });
  const link = t.addLink({ base: pared, face: { axis: 'x', side: 1 }, moving: tabla });
  assert.deepEqual({ ...link.end }, { ...v.end }, 'lo que se anunció es lo que se ancló');
  assert.deepEqual({ ...link.face }, { ...v.face });
  assert.throws(() => { v.end.localAxis = 'y'; }, 'de solo lectura');
});

// ---------- partes fijas ----------

test('una parte fija no la mueve el asentador: el vínculo no se crea, y el que ya estaba queda roto', () => {
  const t = createWorkshop();
  const pared = t.addPiece({ size: [2, 70, 50], center: [0, 35, 0] });
  const tabla = t.addPiece({ size: [40, 2, 50], center: [25, 35, 0] });
  assert.equal(tabla.fixed, false);
  const link = t.addLink({ base: pared, face: { axis: 'x', side: 1 }, moving: tabla });
  tabla.setFixed(true);
  assert.equal(tabla.fixed, true);
  pared.move([10, 0, 0]);
  cerca([tabla.boundingBox.min.x], [5], 1e-9, 'la fija se queda donde estaba (a 4 de la pared, el hueco que tenía)');
  assert.match(link.broken, /es fija/);
  tabla.setFixed(false);
  cerca([tabla.boundingBox.min.x], [15], 1e-9, 'suelta, el vínculo la lleva a su lugar, con el mismo hueco');
  assert.equal(link.broken, null);
  tabla.setFixed(true);
  const otro = t.addPiece({ size: [2, 70, 50], center: [100, 35, 0] });
  const v = t.validateLink({ base: otro, face: { axis: 'x', side: -1 }, moving: tabla });
  assert.equal(v.reason, 'fixed');
  assert.throws(() => t.addLink({ base: otro, face: { axis: 'x', side: -1 }, moving: tabla }), /fija/);
});

test('una parte fija se deja mover a mano: move y transform no lo miran', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [4, 4, 4], fixed: true });
  assert.equal(p.fixed, true);
  p.move([5, 0, 0]);
  cerca([p.boundingBox.center.x], [5]);
});

test('un ensamble fijo fija todo lo de adentro; la pieza suelta, solo ella', () => {
  const t = createWorkshop();
  const a = t.addPiece({ size: [2, 2, 2] }), b = t.addPiece({ size: [2, 2, 2], center: [5, 0, 0] });
  const e = t.assemble([a, b]);
  e.setFixed(true);
  assert.deepEqual([e.fixed, a.fixed, b.fixed], [true, true, true]);
  a.setFixed(false);
  assert.equal(a.fixed, true, 'sigue fija mientras el ensamble lo sea');
  e.setFixed(false);
  assert.deepEqual([e.fixed, a.fixed, b.fixed], [false, false, false]);
  b.setFixed(true);
  assert.deepEqual([e.fixed, a.fixed, b.fixed], [false, false, true]);
  assert.throws(() => a.setFixed('si'), /fixed inválido/);
});

test('fijo se guarda y se deshace; un documento sin partes fijas sigue saliendo como versión 5', () => {
  const t = createWorkshop();
  const p = t.addPiece({ size: [2, 2, 2] });
  assert.equal(t.toJSON().version, 5);
  assert.ok(!JSON.stringify(t.toJSON()).includes('fixed'));
  p.setFixed(true);
  const doc = JSON.parse(JSON.stringify(t.toJSON()));
  assert.equal(doc.version, 6);
  const otro = createWorkshop();
  otro.load(doc);
  assert.equal(otro.part(p.id).fixed, true);
  t.undo();
  assert.equal(p.fixed, false);
  assert.equal(t.toJSON().version, 5);
});
