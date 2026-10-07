// La referencia de la API: docs/API.md y docs/index.html (con buscador), generados desde las
// tablas de help() de cada clase, del Workshop, del módulo y del adaptador de three. No se
// editan a mano: se regeneran con
//
//   npm run docs
//
// y una prueba (test/sdk.test.mjs) falla si lo que está en docs/ no es lo que sale de acá.
// Así la referencia no puede quedar atrás del código, igual que help().
//
// Corre en Node, sin three y sin dependencias.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as sdk from '../src/index.js';
import { memberNames } from '../src/help.js';
import { VIEW_MEMBERS } from '../adapters/three/members.js';

const {
  createWorkshop, Part, Piece, Assembly, Relation, Joint, Fixing, Link,
  Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection, Mesh,
  WORKSHOP_MEMBERS, MODULE_MEMBERS,
} = sdk;

const raiz = new URL('../', import.meta.url);
const REPO = 'https://github.com/EasyIndustry/ThreeJS-cad-SDK';

/** @typedef {[string, string]} Member */
/**
 * @typedef {{ id: string, group: string, name: string, tagline: string, intro?: string,
 *             inherits?: { id: string, name: string }, members: Member[], values?: [string, string][] }} Seccion
 */

/** El título de help() de una clase: "Piece — una pieza: lo que se corta". @param {{ help: (o: { print: false }) => { title?: string } }} cls */
const tituloDe = (cls) => {
  const t = cls.help({ print: false }).title ?? '';
  const [name, ...resto] = t.split(' — ');
  return { name, tagline: resto.join(' — ') };
};

/** Un valor exportado, para leer. @param {unknown} v @returns {string} */
function valor(v) {
  if (Array.isArray(v)) return v.map((x) => `'${x}'`).join(', ');
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    const vals = Object.values(v);
    if (vals.length && vals.every((x) => typeof x === 'function')) return Object.keys(v).map((k) => `'${k}'`).join(', ');
    return Object.entries(v).map(([k, x]) => `${k}: ${JSON.stringify(x).replace(/"/g, '').replace(/,/g, ', ').replace(/:/g, ': ')}`).join(' · ');
  }
  return String(v);
}

/** @param {typeof Part} cls @param {string} group @param {{ intro?: string, inherits?: { id: string, name: string } }} [extra] @returns {Seccion} */
const deClase = (cls, group, extra = {}) => ({
  id: cls.name.toLowerCase(), group, ...tituloDe(/** @type {any} */ (cls)), members: /** @type {any} */ (cls).members, ...extra,
});

/** Todo lo que va en la referencia, en orden. @returns {Seccion[]} */
export function secciones() {
  const constantes = MODULE_MEMBERS.flatMap(([sig]) => memberNames(sig).map((m) => m.name))
    .filter((n) => { const v = /** @type {any} */ (sdk)[n]; return v !== undefined && typeof v !== 'function' && !n.endsWith('_MEMBERS'); });
  const ws = createWorkshop();
  const [wsName, ...wsResto] = (ws.help({ print: false }).title ?? '').split(' — ');
  return [
    {
      id: 'module', group: 'Para empezar', name: 'Módulo', tagline: "lo que se importa de 'threejs-cad-sdk'",
      intro: "Todo sale de `createWorkshop()`: el documento, con sus partes, sus relaciones y su historial. Las medidas son números en la unidad del documento; los ángulos, en grados.",
      members: MODULE_MEMBERS,
      values: constantes.map((n) => [n, valor(/** @type {any} */ (sdk)[n])]),
    },
    {
      id: 'workshop', group: 'Para empezar', name: wsName, tagline: wsResto.join(' — '),
      intro: 'Lo que devuelve `createWorkshop()`. En los ejemplos se llama `taller`, pero el nombre de la variable es de quien lo usa.',
      members: WORKSHOP_MEMBERS,
    },
    {
      id: 'part', group: 'Partes', name: 'Part', tagline: 'lo que tiene toda parte: Piece y Assembly',
      intro: 'Identidad, colocación, geometría consultable y los verbos. La geometría se lee en el mundo, o en el marco de la parte con `local`.',
      members: Part.members,
    },
    deClase(Piece, 'Partes', { inherits: { id: 'part', name: 'Part' } }),
    deClase(Assembly, 'Partes', { inherits: { id: 'part', name: 'Part' } }),
    deClase(Relation, 'Relaciones', { intro: 'Viven en el documento entre partes guardadas: entran en el deshacer, se guardan y se limpian solas si se borra una de sus partes.' }),
    deClase(Joint, 'Relaciones', { inherits: { id: 'relation', name: 'Relation' } }),
    deClase(Fixing, 'Relaciones', { inherits: { id: 'relation', name: 'Relation' } }),
    deClase(Link, 'Relaciones', { inherits: { id: 'relation', name: 'Relation' } }),
    ...[Point3d, Vector3d, Line, BoundingBox, Face, Transform, Contact, Intersection, Mesh].map((c) => deClase(/** @type {any} */ (c), 'Valores')),
    {
      id: 'three', group: 'Adaptador', name: 'createThreeView', tagline: "el adaptador de three ('threejs-cad-sdk/three')",
      intro: 'Lo único del SDK que importa three. No es dueño de nada: escucha los eventos del documento y deja cada malla donde el modelo dice. Renderer, cámara y controles son de la app.',
      members: VIEW_MEMBERS,
    },
  ];
}

const version = () => JSON.parse(readFileSync(new URL('package.json', raiz), 'utf8')).version;

// ---------- Markdown ----------

/** @param {string} s */
const celda = (s) => s.replace(/\|/g, '\\|');

/** @returns {string} */
export function buildMarkdown() {
  const ss = secciones();
  const out = [
    `# Referencia de la API — threejs-cad-sdk ${version()}`,
    '',
    '> Generada por `scripts/docs.mjs` desde las tablas de `help()`, que una prueba verifica contra el código. No se edita a mano: `npm run docs`.',
    `> Para entender cómo se usa cada cosa, el [README](${REPO}#readme). Para buscar, la [versión con buscador](index.html).`,
    '',
    '## Índice',
    '',
  ];
  let grupo = '';
  for (const s of ss) {
    if (s.group !== grupo) { grupo = s.group; out.push(`- **${grupo}**`); }
    out.push(`  - [${s.name}](#${s.id}) — ${s.tagline}`);
  }
  for (const s of ss) {
    out.push('', `<a id="${s.id}"></a>`, '', `## ${s.name}`, '', `_${s.tagline}_`, '');
    if (s.intro) out.push(s.intro, '');
    if (s.inherits) out.push(`Además, todo lo de [${s.inherits.name}](#${s.inherits.id}).`, '');
    out.push('| Miembro | Qué hace |', '|---|---|');
    for (const [sig, doc] of s.members) out.push(`| \`${celda(sig)}\` | ${celda(doc)} |`);
    if (s.values?.length) {
      out.push('', '**Valores**', '', '| Nombre | Valor |', '|---|---|');
      for (const [n, v] of s.values) out.push(`| \`${n}\` | ${celda(v)} |`);
    }
  }
  return `${out.join('\n')}\n`;
}

// ---------- HTML ----------

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Texto con `código` adentro. @param {string} s */
const prosa = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
/** Lo que el buscador compara: minúsculas y sin tildes. @param {string} s */
const plano = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** @returns {string} */
export function buildHtml() {
  const ss = secciones();
  const v = version();
  const total = ss.reduce((n, s) => n + s.members.length, 0);
  let grupo = '';
  const nav = ss.map((s) => {
    const cab = s.group !== grupo ? `<li class="grupo">${esc((grupo = s.group))}</li>` : '';
    return `${cab}<li><a href="#${s.id}" data-sec="${s.id}">${esc(s.name)}<span class="n">${s.members.length}</span></a></li>`;
  }).join('\n');
  const cuerpo = ss.map((s) => {
    const filas = s.members.map(([sig, doc]) => {
      const nombre = memberNames(sig)[0]?.name ?? sig;
      const ancla = `${s.id}.${nombre}${sig.startsWith('static ') ? '.static' : ''}`;
      return `<div class="m" id="${esc(ancla)}" data-q="${esc(plano(`${s.name} ${s.tagline} ${sig} ${doc}`))}">
<a class="sig" href="#${esc(ancla)}"><code>${esc(sig)}</code></a>
<p class="doc">${prosa(doc)}</p>
</div>`;
    }).join('\n');
    const valores = s.values?.length
      ? `<div class="valores"><h3>Valores</h3>${s.values.map(([n, x]) => `<div class="m" id="${s.id}.${n}.valor" data-q="${esc(plano(`${n} ${x}`))}"><a class="sig" href="#${s.id}.${n}.valor"><code>${esc(n)}</code></a><p class="doc"><code>${esc(x)}</code></p></div>`).join('\n')}</div>`
      : '';
    return `<section id="${s.id}" data-sec="${s.id}">
<header><p class="grupo">${esc(s.group)}</p><h2>${esc(s.name)}</h2><p class="tag">${prosa(s.tagline)}</p>
${s.intro ? `<p class="intro">${prosa(s.intro)}</p>` : ''}${s.inherits ? `<p class="hereda">Además, todo lo de <a href="#${s.inherits.id}">${esc(s.inherits.name)}</a>.</p>` : ''}</header>
<div class="lista">
${filas}
</div>
${valores}
</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>threejs-cad-sdk · Referencia de la API</title>
<meta name="description" content="Referencia de la API de threejs-cad-sdk ${esc(v)}: piezas, ensambles, relaciones, contacto y geometría, para apps de three.js.">
<!-- Generado por scripts/docs.mjs desde las tablas de help(). No se edita a mano: npm run docs -->
<style>
:root {
  --bg: #fbfaf7; --panel: #f3f1ec; --text: #23201b; --muted: #6b655b; --line: #e3dfd6;
  --accent: #a84a1f; --accent-soft: #f6e4da; --code: #2b2620; --mark: #ffe08a; --mark-text: #23201b;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #171512; --panel: #201d19; --text: #ece7de; --muted: #a59d90; --line: #332f29;
    --accent: #f08a5d; --accent-soft: #3a2519; --code: #f3eee6; --mark: #7a5c00; --mark-text: #fff6dc;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #171512; --panel: #201d19; --text: #ece7de; --muted: #a59d90; --line: #332f29;
  --accent: #f08a5d; --accent-soft: #3a2519; --code: #f3eee6; --mark: #7a5c00; --mark-text: #fff6dc;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 88px; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 var(--sans); }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: var(--mono); font-size: 0.92em; color: var(--code); }
p code, .doc code { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
mark { background: var(--mark); color: var(--mark-text); border-radius: 2px; padding: 0 1px; }
.top { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); }
.top .in { max-width: 1180px; margin: 0 auto; padding: 12px 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.marca { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.marca b { font-size: 17px; letter-spacing: -0.01em; }
.marca .ver { font: 12px var(--mono); color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
.buscar { flex: 1 1 280px; position: relative; }
.buscar input { width: 100%; font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px 9px 34px; outline: none; }
.buscar input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.buscar svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--muted); }
.buscar kbd { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font: 11px var(--mono); color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
.buscar input:not(:placeholder-shown) ~ kbd { display: none; }
.links { display: flex; gap: 14px; font-size: 14px; }
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 16px; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 32px; }
nav { position: sticky; top: 70px; align-self: start; max-height: calc(100vh - 80px); overflow: auto; padding: 20px 0 40px; }
nav ul { list-style: none; margin: 0; padding: 0; }
nav li.grupo { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 16px 0 4px; }
nav li.grupo:first-child { margin-top: 0; }
nav a { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 3px 8px; border-radius: 6px; color: var(--text); font-size: 14px; }
nav a:hover { background: var(--panel); text-decoration: none; }
nav a.activo { background: var(--accent-soft); color: var(--accent); }
nav .n { color: var(--muted); font: 12px var(--mono); }
nav a.vacio { opacity: 0.35; }
main { padding: 20px 0 80px; min-width: 0; }
.estado { color: var(--muted); font-size: 14px; margin: 0 0 8px; min-height: 1.5em; }
section { border-top: 1px solid var(--line); padding: 28px 0 12px; }
section:first-of-type { border-top: 0; padding-top: 4px; }
section header .grupo { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
h2 { margin: 2px 0 2px; font-size: 26px; letter-spacing: -0.02em; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 20px 0 6px; }
.tag { margin: 0 0 8px; color: var(--muted); }
.intro, .hereda { margin: 6px 0; max-width: 70ch; }
.lista, .valores { margin-top: 10px; }
.m { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 4px 24px; padding: 9px 0; border-bottom: 1px dashed var(--line); }
.m:last-child { border-bottom: 0; }
.m:target { background: var(--accent-soft); border-radius: 6px; }
.sig { color: var(--text); overflow-wrap: anywhere; }
.sig code { font-weight: 600; }
.doc { margin: 0; color: var(--text); overflow-wrap: anywhere; }
.oculto { display: none !important; }
.nada { padding: 40px 0; color: var(--muted); }
footer { color: var(--muted); font-size: 13px; padding: 24px 0 0; border-top: 1px solid var(--line); }
@media (max-width: 860px) {
  .wrap { grid-template-columns: minmax(0, 1fr); gap: 0; }
  nav { position: static; max-height: none; padding: 12px 0 0; }
  nav ul { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; }
  nav li.grupo { display: none; }
  nav a { white-space: nowrap; border: 1px solid var(--line); }
  .m { grid-template-columns: minmax(0, 1fr); }
  .links, .buscar kbd { display: none; }
  html { scroll-padding-top: 120px; }
}
</style>
</head>
<body>
<div class="top"><div class="in">
  <div class="marca"><b>threejs-cad-sdk</b><span class="ver">${esc(v)}</span></div>
  <label class="buscar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="q" type="search" placeholder="Buscar en ${total} miembros: addPiece, contacto, bisagra…" autocomplete="off" spellcheck="false" aria-label="Buscar en la API"><kbd>/</kbd></label>
  <div class="links"><a href="${REPO}#readme">Guía</a><a href="API.md">Markdown</a><a href="${REPO}/blob/main/CHANGELOG.md">Cambios</a><a href="${REPO}">GitHub</a></div>
</div></div>
<div class="wrap">
<nav aria-label="Secciones"><ul>
${nav}
</ul></nav>
<main>
<p class="estado" id="estado" aria-live="polite"></p>
${cuerpo}
<p class="nada oculto" id="nada">Nada coincide. Probá con menos palabras, o con el nombre en inglés del método (<code>addPiece</code>, <code>contactsWith</code>…).</p>
<footer>Generada por <code>scripts/docs.mjs</code> desde las tablas de <code>help()</code>, que una prueba verifica contra el código. Para entender cómo se usa cada cosa, la <a href="${REPO}#readme">guía del README</a>. MIT © EasyIndustry.</footer>
</main>
</div>
<script>
(() => {
  const q = document.getElementById('q');
  const estado = document.getElementById('estado');
  const nada = document.getElementById('nada');
  const filas = [...document.querySelectorAll('.m')];
  const secs = [...document.querySelectorAll('section')];
  const enlaces = new Map([...document.querySelectorAll('nav a[data-sec]')].map((a) => [a.dataset.sec, a]));
  const original = new Map();
  const plano = (s) => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
  const marcar = (el, palabras) => {
    if (!original.has(el)) original.set(el, el.innerHTML);
    el.innerHTML = original.get(el);
    if (!palabras.length) return;
    const andar = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodos = [];
    while (andar.nextNode()) nodos.push(andar.currentNode);
    for (const n of nodos) {
      const t = n.nodeValue, p = plano(t);
      const tramos = [];
      for (const w of palabras) for (let i = p.indexOf(w); i >= 0; i = p.indexOf(w, i + 1)) tramos.push([i, i + w.length]);
      if (!tramos.length) continue;
      tramos.sort((a, b) => a[0] - b[0]);
      const f = document.createDocumentFragment();
      let k = 0;
      for (const [a, b] of tramos) {
        if (a < k) continue;
        f.append(t.slice(k, a));
        const m = document.createElement('mark');
        m.textContent = t.slice(a, b);
        f.append(m);
        k = b;
      }
      f.append(t.slice(k));
      n.replaceWith(f);
    }
  };
  const filtrar = () => {
    const palabras = plano(q.value).split(/\\s+/).filter(Boolean);
    let vistas = 0;
    for (const f of filas) {
      const ok = palabras.every((w) => f.dataset.q.includes(w));
      f.classList.toggle('oculto', !ok);
      if (ok) vistas++;
      if (ok) for (const el of f.querySelectorAll('.sig code, .doc')) marcar(el, palabras);
    }
    for (const s of secs) {
      const hay = s.querySelector('.m:not(.oculto)');
      s.classList.toggle('oculto', !!palabras.length && !hay);
      const a = enlaces.get(s.dataset.sec);
      if (a) a.classList.toggle('vacio', !!palabras.length && !hay);
      const h3 = s.querySelector('.valores');
      if (h3) h3.classList.toggle('oculto', !h3.querySelector('.m:not(.oculto)'));
    }
    nada.classList.toggle('oculto', !palabras.length || vistas > 0);
    estado.textContent = palabras.length ? (vistas === 1 ? '1 resultado' : vistas + ' resultados') : '';
    const url = new URL(location.href);
    if (q.value) url.searchParams.set('q', q.value); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
  };
  q.addEventListener('input', filtrar);
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; filtrar(); q.blur(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); q.select(); }
  });
  const inicial = new URL(location.href).searchParams.get('q');
  if (inicial) { q.value = inicial; filtrar(); }
  // la sección que se está leyendo, marcada en el índice
  const ver = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      for (const a of enlaces.values()) a.classList.remove('activo');
      enlaces.get(e.target.dataset.sec)?.classList.add('activo');
    }
  }, { rootMargin: '-90px 0px -70% 0px' });
  secs.forEach((s) => ver.observe(s));
})();
</script>
</body>
</html>
`;
}

/** Escribe docs/API.md y docs/index.html. */
export function writeDocs() {
  mkdirSync(new URL('docs/', raiz), { recursive: true });
  writeFileSync(new URL('docs/API.md', raiz), buildMarkdown());
  writeFileSync(new URL('docs/index.html', raiz), buildHtml());
  writeFileSync(new URL('docs/.nojekyll', raiz), '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeDocs();
  console.log(`docs/API.md y docs/index.html, para ${version()} (${fileURLToPath(new URL('docs/', raiz))})`);
}
