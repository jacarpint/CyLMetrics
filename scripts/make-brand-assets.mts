/**
 * Genera los recursos de marca del portal a partir del logotipo.
 *
 * El favicon que se servía era el de la plantilla de create-next-app —25.931
 * bytes, el logo de Next—, así que la pestaña de un portal de datos de Castilla
 * y León mostraba el logotipo del framework. Y no había imagen de compartir, de
 * modo que cualquier enlace pegado en Slack, WhatsApp o LinkedIn salía como una
 * tarjeta de texto desnuda: mal negocio para un proyecto cuyo objetivo es que la
 * auditoría circule.
 *
 * Todo se deriva de `public/logo-light.png`, que ya es la identidad del portal.
 * No hay arte nuevo que mantener aparte.
 *
 * Los ficheros se generan una vez y se commitean: son estáticos y Next los
 * resuelve por convención de nombre (`icon`, `apple-icon`, `opengraph-image`).
 * Nada de esto corre en producción.
 *
 *   npm run brand:assets
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const LOGO = path.join(ROOT, 'public', 'logo-light.png');
const APP_DIR = path.join(ROOT, 'src', 'app');

/**
 * El isotipo dentro del logotipo: las tres barras con degradado azul→verde.
 *
 * Medido sobre los píxeles no transparentes del tercio izquierdo del lienzo de
 * 2000×420. Es idéntico en `logo-light.png` y en `logo-dark.png` —solo cambia el
 * color del texto—, así que un único icono sirve para los dos temas.
 */
const MARK = { left: 37, top: 79, width: 295, height: 259 };

/** Colores de marca, los mismos tokens que `globals.css`. */
const CANVAS = '#f7f9fc';
const STRONG = '#0f172a';
const FAINT = '#5b6979';

/**
 * El icono, sobre placa clara.
 *
 * El extremo azul oscuro del degradado se pierde contra una pestaña en tema
 * oscuro, así que el isotipo va sobre fondo claro en lugar de transparente: es
 * lo que hace que se lea igual en cualquier navegador.
 */
async function makeIcon(size: number, out: string) {
  const padding = Math.round(size * 0.17);
  const inner = size - padding * 2;
  // El isotipo es más ancho que alto: se escala por el lado que manda y se
  // centra, para no deformarlo.
  const scale = Math.min(inner / MARK.width, inner / MARK.height);
  const w = Math.round(MARK.width * scale);
  const h = Math.round(MARK.height * scale);

  const mark = await sharp(LOGO)
    .extract(MARK)
    .resize(w, h)
    .toBuffer();

  const radius = Math.round(size * 0.22);
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${CANVAS}"/>
     </svg>`
  );

  await sharp(plate)
    .composite([{ input: mark, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }])
    .png()
    .toFile(out);

  return out;
}

/**
 * La tarjeta de compartir: 1200×630, el tamaño que esperan las redes.
 *
 * Lleva el logotipo completo y la promesa del portal en una línea. El texto va
 * como SVG y no con una fuente incrustada: son dos frases fijas y no compensa
 * arrastrar un `.ttf` al repositorio para componerlas.
 */
async function makeOgImage(out: string) {
  const W = 1200;
  const H = 630;
  const logoWidth = 620;

  const logo = await sharp(LOGO).resize({ width: logoWidth }).toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const logoTop = 168;

  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
       <rect width="${W}" height="${H}" fill="${CANVAS}"/>
       <rect x="0" y="${H - 12}" width="${W}" height="12" fill="#047857"/>
       <text x="80" y="${logoTop + (logoMeta.height ?? 130) + 96}"
             font-family="Segoe UI, Helvetica, Arial, sans-serif"
             font-size="42" font-weight="700" fill="${STRONG}">
         ¿Se pueden usar de verdad los datos abiertos
       </text>
       <text x="80" y="${logoTop + (logoMeta.height ?? 130) + 152}"
             font-family="Segoe UI, Helvetica, Arial, sans-serif"
             font-size="42" font-weight="700" fill="${STRONG}">
         de Castilla y León?
       </text>
       <text x="80" y="${H - 74}"
             font-family="Segoe UI, Helvetica, Arial, sans-serif"
             font-size="26" fill="${FAINT}">
         Se descarga cada archivo publicado y se comprueba que abre
       </text>
     </svg>`
  );

  await sharp(background)
    .composite([{ input: logo, left: 80, top: logoTop }])
    .png()
    .toFile(out);

  return out;
}

async function main() {
  await fs.access(LOGO);

  const written = [
    await makeIcon(512, path.join(APP_DIR, 'icon.png')),
    await makeIcon(180, path.join(APP_DIR, 'apple-icon.png')),
    await makeOgImage(path.join(APP_DIR, 'opengraph-image.png')),
  ];

  for (const file of written) {
    const { size } = await fs.stat(file);
    console.log(`  ${path.relative(ROOT, file)} — ${(size / 1024).toFixed(1)} KB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
