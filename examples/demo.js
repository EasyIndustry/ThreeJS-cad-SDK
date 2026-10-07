// Una escena de ejemplo armada solo con la API del SDK. Es el caso que lo motivó: un
// bastidor con una diagonal girada 45°, ensamblado, parado, girado entero y repetido. En el
// modelo viejo girar el ensamble reescribía las medidas de sus piezas y repetirlo obligaba
// a rearmarlo de cero; acá son cuatro llamadas.

/** @param {ReturnType<typeof import('../src/index.js').createWorkshop>} t */
export function demo(t) {
  t.clear();
  const sec = 4.5; // larguero de 45 × 45 mm
  const l1 = t.addPiece({ name: 'Larguero', size: [120, sec, sec], center: [0, sec / 2, -30] });
  const l2 = t.addPiece({ name: 'Larguero', size: [120, sec, sec], center: [0, sec / 2, 30] });
  const t1 = t.addPiece({ name: 'Travesaño', size: [sec, sec, 60 - sec], center: [-60 + sec / 2, sec / 2, 0] });
  const t2 = t.addPiece({ name: 'Travesaño', size: [sec, sec, 60 - sec], center: [60 - sec / 2, sec / 2, 0] });
  const diagonal = t.addPiece({ name: 'Diagonal', size: [80, sec, sec], center: [0, sec / 2, 0] });
  diagonal.rotate(45, 'y');

  // el ensamble entero: parado como el lateral de un mueble, y girado un ángulo que no es
  // recto, para que se vea que eso tampoco toca a las piezas
  const bastidor = t.assemble([l1, l2, t1, t2, diagonal], { name: 'Bastidor' });
  bastidor.rotate(90, 'x').rotate(25, 'y');
  bastidor.move([0, -bastidor.boundingBox.min.y, 0]); // apoyado en el piso

  const copia = bastidor.duplicate().move([0, 0, -80]);
  return { bastidor, copia };
}
