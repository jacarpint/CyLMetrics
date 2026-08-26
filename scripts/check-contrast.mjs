/**
 * Comprueba que la paleta de `src/app/globals.css` cumple WCAG 2.1 AA en los
 * dos temas: 4.5:1 para texto y 3:1 para elementos gráficos (bordes de campo,
 * barras, anillos y marcadores del mapa).
 *
 *   node scripts/check-contrast.mjs
 *
 * Devuelve código 1 si alguna combinación se queda corta, así que sirve tal
 * cual en un hook de pre-commit o en CI. Si tocas un token, pásalo por aquí.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');

/** Extrae los `--token: #rrggbb` del primer bloque con ese selector. */
function readTokens(selector) {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No se encontró el bloque ${selector} en globals.css`);
  const end = CSS.indexOf('\n}', start);
  const tokens = {};
  for (const line of CSS.slice(start, end).split('\n')) {
    const m = line.match(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{6})/);
    if (m) tokens[m[1]] = m[2].toLowerCase();
  }
  return tokens;
}

function luminance(hex) {
  const channels = hex
    .replace('#', '')
    .match(/../g)
    .map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['--card', '--canvas', '--fill'];
const TEXT = ['--strong', '--body', '--faint', '--ok', '--warn', '--bad', '--info', '--accent', '--link'];
const GRAPHIC = ['--ok-solid', '--warn-solid', '--bad-solid', '--field'];
/** Pares en los que el fondo no es una superficie neutra. */
const PAIRS = [
  ['--primary-fg', '--primary'],
  ['--bad-fg', '--bad-solid'],
  ['--ok', '--ok-surface'],
  ['--warn', '--warn-surface'],
  ['--bad', '--bad-surface'],
  ['--info', '--info-surface'],
  ['--strong', '--fill-strong'],
];

const THEMES = [
  ['claro', readTokens(':root')],
  ['oscuro', readTokens('.dark')],
];

let checks = 0;
const failures = [];

function check(theme, fg, bg, tokens, min, kind) {
  if (!tokens[fg] || !tokens[bg]) {
    failures.push(`${theme}: token ausente (${!tokens[fg] ? fg : bg})`);
    return;
  }
  checks += 1;
  const value = ratio(tokens[fg], tokens[bg]);
  if (value < min) {
    failures.push(`${theme}: ${kind} ${fg} sobre ${bg} = ${value.toFixed(2)}:1 (mínimo ${min}:1)`);
  }
}

for (const [theme, tokens] of THEMES) {
  for (const fg of TEXT) for (const bg of SURFACES) check(theme, fg, bg, tokens, 4.5, 'texto');
  for (const fg of GRAPHIC) for (const bg of SURFACES) check(theme, fg, bg, tokens, 3, 'gráfico');
  for (const [fg, bg] of PAIRS) check(theme, fg, bg, tokens, 4.5, 'par');
}

/*
 * El enlace contra el TEXTO que lo rodea, que es otra pregunta.
 *
 * Todo lo de arriba mide texto contra superficie. Un enlace tiene además que
 * poder distinguirse del párrafo en el que va, y ahí el fondo no interviene: si
 * el color es lo único que lo señala, tiene que contrastar 3:1 con el texto
 * vecino (WCAG 1.4.1). El nuestro se queda en 1,0–1,4:1 en los dos temas, así
 * que este criterio se cumple por el subrayado y no por el color.
 *
 * Esta comprobación existía como hueco: los enlaces pasaban con 5,5:1 y 9,3:1
 * contra el fondo mientras eran indistinguibles del texto de al lado, y el
 * script decía que todo cumplía AA. Lo encontró Lighthouse, no nosotros.
 */
const UNDERLINE_RULE = /:is\([^)]*\bp\b[^)]*\)\s*a\[class\*=["']text-link["']\]\s*\{[^}]*text-decoration-line:\s*underline/;
const subrayado = UNDERLINE_RULE.test(CSS);

for (const [theme, tokens] of THEMES) {
  for (const vecino of ['--body', '--faint', '--strong']) {
    if (!tokens['--link'] || !tokens[vecino]) continue;
    checks += 1;
    const value = ratio(tokens['--link'], tokens[vecino]);
    if (value >= 3) continue;
    if (subrayado) continue; // el subrayado es el segundo indicador: basta
    failures.push(
      `${theme}: enlace --link junto a ${vecino} = ${value.toFixed(2)}:1 (mínimo 3:1 si el color ` +
        `es el único indicador), y no hay regla de subrayado en globals.css que lo compense`
    );
  }
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} de ${checks} combinaciones no cumplen AA:\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`✓ ${checks} combinaciones comprobadas en claro y oscuro: todas cumplen AA.`);
