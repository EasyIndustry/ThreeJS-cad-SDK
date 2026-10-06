// Los parámetros que dependen de en qué sistema y a qué escala se trabaja.
//
// Es el único lugar del SDK donde viven esos números: nada de `src/` los escribe a mano. Cada
// sistema (métrico, imperial) los trae en SU unidad natural, como los diría alguien que trabaja
// en él, y `tolerancesFor` los lleva a la unidad del documento. Así los mismos valores sirven
// si el documento está en mm, en cm o en m, y si alguien trabaja en pulgadas no recibe un
// "0,0787" que no significa nada para él.
//
// Son SUGERENCIAS. Un taller puede pisarlos al crearse (`createWorkshop({ tolerances })`) o
// pasar una tolerancia puntual a cada pregunta (`a.touches(b, { tolerance })`). Para otro
// criterio —otro oficio, otra máquina— se cambian acá o se pisan desde afuera, sin tocar el
// resto del SDK.
//
// Puro: no importa three ni DOM.
import { convertLength, systemOf, checkUnit } from './units.js';

/** @typedef {import('./units.js').Unit} Unit */
/** @typedef {import('./units.js').System} System */

/**
 * Tolerancias de contacto sugeridas.
 *   touch:       dos partes se tocan si están a esta distancia o menos.
 *   penetration: se meten una en otra si la penetración pasa de esto.
 * La proporción es la misma en los dos sistemas (4 a 3): 2 mm y 1,5 mm; 1/16 in y 3/64 in.
 * @type {Readonly<Record<System, Readonly<{ unit: Unit, touch: number, penetration: number }>>>}
 */
export const TOLERANCE_PRESETS = Object.freeze({
  metric: Object.freeze({ unit: 'mm', touch: 2, penetration: 1.5 }),
  imperial: Object.freeze({ unit: 'in', touch: 1 / 16, penetration: 3 / 64 }),
});

/**
 * @typedef {Object} Tolerances
 * @property {number} touch         distancia máxima para que dos partes se toquen, en la unidad del documento
 * @property {number} penetration   cuánto se pueden meter una en otra antes de chocar, en la unidad del documento
 */

/**
 * Las tolerancias para un documento en `unit`: las sugeridas de su sistema, llevadas a su
 * unidad, y encima lo que se pida. `overrides` va en la unidad del documento.
 * @param {Unit} unit @param {Partial<Tolerances>} [overrides]
 * @returns {Readonly<Tolerances>}
 */
export function tolerancesFor(unit, overrides = {}) {
  const preset = TOLERANCE_PRESETS[systemOf(checkUnit(unit))];
  /** @type {Tolerances} */
  const out = {
    touch: convertLength(preset.touch, preset.unit, unit),
    penetration: convertLength(preset.penetration, preset.unit, unit),
  };
  for (const k of /** @type {const} */ (['touch', 'penetration'])) {
    const v = overrides[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new TypeError(`tolerancia ${k} inválida: ${String(v)} (va un número de 0 o más, en la unidad del documento)`);
    out[k] = v;
  }
  return Object.freeze(out);
}
