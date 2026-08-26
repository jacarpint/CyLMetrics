/**
 * Contrasta contra el origen los archivos que el portal da por rotos.
 *
 *   npx vite-node scripts/verify-broken.mts -- [--census] [--sample N] [--all]
 *
 * El portal acusa públicamente a 227 archivos de no poder abrirse. Esa
 * afirmación solo vale si sigue siendo cierta cuando alguien la comprueba, así
 * que esto la comprueba: coge una muestra estratificada por causa, la descarga
 * ahora mismo y contrasta lo que pasa con lo que el informe dice que pasa.
 *
 * No usa `/api/proxy` a propósito: el proxy es del portal, y aquí se trata de
 * salir a por el archivo como haría cualquiera desde fuera.
 *
 * Un desacuerdo no significa necesariamente que el portal se equivocara: el
 * informe es una foto del 14 de agosto y el catálogo está vivo, así que un
 * archivo puede haberse arreglado desde entonces. Lo que no puede haber es un
 * archivo que nunca estuvo roto.
 */
import fs from 'node:fs';
import { XMLValidator } from 'fast-xml-parser';
import { classifyDelivery, deliveryCause } from '../src/lib/availability';
import type { QualityReport } from '../src/lib/quality-report';

const REPORT_PATH = 'reports/current/index.json';
const TIMEOUT_MS = 45_000;
/** Peticiones a la vez. Bajo a propósito: es un servidor público ajeno. */
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const census = args.includes('--census');
const all = args.includes('--all');
const sampleSize = Number(args[args.indexOf('--sample') + 1]) || 30;

const report: QualityReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));

interface Broken {
  url: string;
  format: string;
  cause: string;
  causeLabel: string;
  httpStatus: number | null;
  fetchStatus: string | undefined;
  dataset: string;
}

const broken: Broken[] = [];
for (const ds of report.datasets) {
  for (const dist of ds.distribution_results) {
    if (classifyDelivery(dist) !== 'roto') continue;
    const cause = deliveryCause(dist);
    broken.push({
      url: dist.url,
      format: dist.format,
      cause: cause?.code ?? 'desconocido',
      causeLabel: cause?.label ?? '—',
      httpStatus: dist.fetch?.http_status ?? null,
      fetchStatus: dist.fetch?.status,
      dataset: ds.dataset_title,
    });
  }
}

const byCause = new Map<string, Broken[]>();
for (const b of broken) {
  const list = byCause.get(b.cause);
  if (list) list.push(b);
  else byCause.set(b.cause, [b]);
}

console.log(`Archivos que el portal da por rotos: ${broken.length}\n`);
console.log('Por causa:');
for (const [cause, list] of [...byCause.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const formats = [...new Set(list.map((b) => b.format))].sort().join(' ');
  const statuses = [...new Set(list.map((b) => b.httpStatus).filter(Boolean))].sort().join('/');
  console.log(
    `  ${cause.padEnd(26)} ${String(list.length).padStart(4)}  [${formats}]${statuses ? `  HTTP ${statuses}` : ''}`
  );
}

if (census) process.exit(0);

/**
 * Muestra estratificada: de cada causa se cogen unos cuantos, proporcional a su
 * peso pero con un mínimo de 2, para que ninguna quede sin comprobar. Coger 30
 * al azar habría dejado fuera las causas minoritarias, que son justo las que más
 * probabilidad tienen de estar mal clasificadas.
 */
function stratify(size: number): Broken[] {
  const causes = [...byCause.entries()].sort((a, b) => b[1].length - a[1].length);
  const picked: Broken[] = [];
  for (const [, list] of causes) {
    const n = Math.max(2, Math.round((list.length / broken.length) * size));
    // Repartidos a lo largo de la lista, no los N primeros: así no salen todos
    // del mismo conjunto de datos.
    const step = Math.max(1, Math.floor(list.length / n));
    for (let i = 0; i < list.length && picked.length < size * 2; i += step) picked.push(list[i]);
  }
  return picked;
}

const sample = all ? broken : stratify(sampleSize);
console.log(`\nComprobando ${sample.length} de ${broken.length} contra el origen…\n`);

type Verdict = 'confirmado' | 'discrepa' | 'inconcluso';

interface Check {
  item: Broken;
  verdict: Verdict;
  detail: string;
}

/**
 * Causas en las que basta con saber si el archivo llega: lo que el portal
 * afirma es que la descarga falla, así que una descarga correcta ya lo desmiente.
 */
const CAUSAS_DE_DESCARGA = ['descarga', 'archivo-vacio'];

/** Tope al bajarse un archivo entero para validarlo. */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * ¿Sigue siendo cierto que no se puede interpretar?
 *
 * Para las causas de contenido no vale con que el archivo llegue: el portal no
 * dijo que no llegara, dijo que no se podía abrir. Esto lo comprueba de verdad,
 * con la misma pregunta que hizo el analizador.
 */
function validarContenido(item: Broken, buf: Uint8Array, ctype: string): Check {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const zip = buf[0] === 0x50 && buf[1] === 0x4b; // "PK": todo XLSX es un ZIP
  const ok = (detail: string): Check => ({ item, verdict: 'confirmado', detail });
  const no = (detail: string): Check => ({ item, verdict: 'discrepa', detail });

  switch (item.cause) {
    case 'json-invalido':
      try {
        JSON.parse(text);
        return no(`el JSON sí parsea (${buf.byteLength.toLocaleString('es-ES')} B)`);
      } catch (err) {
        return ok(`JSON inválido: ${(err as Error).message.slice(0, 60)}`);
      }

    case 'xml-no-bien-formado': {
      const res = XMLValidator.validate(text);
      if (res === true) return no(`el XML sí está bien formado (${buf.byteLength.toLocaleString('es-ES')} B)`);
      return ok(`XML mal formado: ${res.err.msg.slice(0, 60)}`);
    }

    case 'formato-no-esperado':
      // Un .xls/.xlsx que no empieza por "PK" no es un Excel moderno, diga lo
      // que diga la extensión ni el content-type.
      if (!zip) return ok(`no es un XLSX: llega ${ctype || 'sin tipo'}, ${buf.byteLength.toLocaleString('es-ES')} B`);
      return no(`sí parece un XLSX (ZIP, ${buf.byteLength.toLocaleString('es-ES')} B)`);

    case 'servicio-error':
    case 'error-fuente':
      // El caso típico: el servidor de mapas contesta un informe de excepción
      // en vez del dato. Es una respuesta 200 que no trae ningún dato.
      if (/ExceptionReport|ServiceException|<ows:Exception/i.test(text)) {
        const msg = /<[^>]*ExceptionText[^>]*>([^<]{0,80})/i.exec(text)?.[1]?.trim();
        return ok(`el origen contesta una excepción${msg ? `: «${msg}»` : ''}`);
      }
      if (zip && item.format !== 'SHP') return ok(`llega un ZIP, no un ${item.format}`);
      return { item, verdict: 'inconcluso', detail: `llega ${ctype || 'sin tipo'}, ${buf.byteLength.toLocaleString('es-ES')} B` };

    default:
      return { item, verdict: 'inconcluso', detail: `llega ${ctype}, ${buf.byteLength.toLocaleString('es-ES')} B` };
  }
}

/** Descarga y cuenta qué pasó de verdad. */
async function probe(item: Broken): Promise<Check> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Para las causas de descarga basta con los primeros bytes; para las de
  // contenido hace falta el archivo entero, o el veredicto no valdría nada.
  const soloCabeza = CAUSAS_DE_DESCARGA.includes(item.cause);
  try {
    const res = await fetch(item.url, {
      headers: {
        'user-agent': 'CyLMetrics-verificacion/1.0',
        // `Range` para no bajarse un ECW de 400 MB solo para saber si responde.
        ...(soloCabeza ? { range: 'bytes=0-65535' } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const ctype = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const declared = Number(res.headers.get('content-length') ?? '');
    if (!soloCabeza && Number.isFinite(declared) && declared > MAX_BYTES) {
      return { item, verdict: 'inconcluso', detail: `pesa ${(declared / 1e6).toFixed(0)} MB, por encima del tope` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 512)).trimStart();
    const looksHtml = /^<!doctype html|^<html/i.test(head);

    // El origen falla: el portal tenía razón, sin más que mirar.
    if (!res.ok && res.status !== 206) {
      return { item, verdict: 'confirmado', detail: `HTTP ${res.status}` };
    }
    // Responde 200 pero con una página web: sigue sin entregar el archivo.
    if (looksHtml && item.format !== 'HTML') {
      return { item, verdict: 'confirmado', detail: `HTTP ${res.status} pero devuelve HTML` };
    }
    if (buf.byteLength === 0) {
      return { item, verdict: 'confirmado', detail: `HTTP ${res.status} con cuerpo vacío` };
    }
    // Llega y no es una página. Si el portal dijo «no se descarga», eso ya lo
    // desmiente; si dijo «no se puede interpretar», hay que interpretarlo.
    if (soloCabeza) {
      return {
        item,
        verdict: 'discrepa',
        detail: `HTTP ${res.status} · ${ctype || 'sin content-type'} · ${buf.byteLength.toLocaleString('es-ES')} B`,
      };
    }
    return validarContenido(item, buf, ctype);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const msg = err instanceof Error ? err.message : String(err);
    return {
      item,
      verdict: 'confirmado',
      detail: name === 'AbortError' ? `sin respuesta en ${TIMEOUT_MS / 1000} s` : `${name}: ${msg.slice(0, 80)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

const results: Check[] = [];
for (let i = 0; i < sample.length; i += CONCURRENCY) {
  const batch = sample.slice(i, i + CONCURRENCY);
  results.push(...(await Promise.all(batch.map(probe))));
  process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, sample.length)}/${sample.length}`);
}
console.log('\n');

const SYMBOL: Record<Verdict, string> = { confirmado: 'OK ', discrepa: '!! ', inconcluso: ' ? ' };
for (const { item, verdict, detail } of results) {
  console.log(
    `${SYMBOL[verdict]} ${item.format.padEnd(5)} ${item.cause.padEnd(24)} ${detail}\n      ${item.url}`
  );
}

const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
console.log('\n─────────────────────────────────────────');
console.log(`Confirmados (el origen sigue fallando): ${count('confirmado')}`);
console.log(`Discrepan   (ahora sí se descarga):     ${count('discrepa')}`);
console.log(`Inconclusos (llega, falta interpretar): ${count('inconcluso')}`);
