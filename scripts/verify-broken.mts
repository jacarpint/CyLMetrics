/**
 * Contrasta contra el origen los archivos que el portal da por rotos.
 *
 *   npx vite-node scripts/verify-broken.mts -- [--census] [--sample N] [--all]
 *
 * El portal identifica un par de centenares de archivos como no accesibles. Esa
 * lectura solo vale si sigue siendo cierta cuando alguien la comprueba, así que
 * esto la comprueba: descarga cada uno ENTERO, lo abre cuando lo que está en
 * cuestión es el contenido, y contrasta lo que pasa con lo que el informe dice.
 *
 * No usa `/api/proxy` a propósito: el proxy es del portal, y aquí se trata de
 * salir a por el archivo como haría cualquiera desde fuera.
 *
 * Un desacuerdo no significa necesariamente que el portal se equivocara: el
 * informe es una foto fechada y el catálogo está vivo, así que un archivo puede
 * haberse arreglado desde entonces. Lo que no puede haber es un archivo que
 * nunca estuvo roto.
 */
import fs from 'node:fs';
import { XMLValidator } from 'fast-xml-parser';
import { classifyDelivery, deliveryCause } from '../src/lib/availability';
import { unzip } from '../src/lib/zip-read';
import type { QualityReport } from '../src/lib/quality-report';

const REPORT_PATH = 'reports/current/index.json';

/**
 * Plazo por archivo. El mismo que usa el analizador (`DEFAULT_TIMEOUT` en
 * `cli.py`), y por el mismo motivo: buena parte de los recursos pesados se
 * generan al vuelo y tardan más de dos minutos en empezar a llegar. Con los 45 s
 * de antes, esta herramienta habría «confirmado» como rotos archivos que solo
 * necesitaban esperar.
 */
const TIMEOUT_MS = 300_000;

/** Peticiones a la vez. Bajo a propósito: es un servidor público ajeno. */
const CONCURRENCY = 4;

/**
 * Tope de descarga al comprobar. Por encima de esto se para y se da por
 * alcanzable: si han llegado 700 MB, lo que el portal dice —que no se puede
 * descargar— ya está desmentido.
 */
const MAX_DOWNLOAD = 700 * 1024 * 1024;

const args = process.argv.slice(2);
const census = args.includes('--census');
const all = args.includes('--all');
const sampleSize = Number(args[args.indexOf('--sample') + 1]) || 30;

/**
 * Dónde queda el resultado.
 *
 * Va dentro de `reports/current/` porque verifica ESE informe y no otro, y porque
 * el directorio ya se versiona entero: la comprobación queda archivada junto a lo
 * que comprueba. El portal NO lo lee —la página de Metodología describe el método,
 * no publica los resultados de una ejecución—, así que tampoco está declarado en
 * `outputFileTracingIncludes`; si algún día se pinta, habrá que añadirlo.
 *
 * `write_bundle` solo vacía el subdirectorio `d/`, así que un análisis nuevo no se
 * lo lleva. Justo por eso el artefacto guarda el `generated_at` del informe: sin esa
 * fecha, sobrevivir a un análisis nuevo lo dejaría describiendo una foto que ya no
 * está publicada, sin forma de notarlo.
 */
const outPath = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : 'reports/current/verification.json';

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
 * Causas en las que el veredicto lo da la descarga misma.
 *
 * El portal afirma que el archivo no se puede descargar, así que descargarlo lo
 * desmiente y no hay nada más que mirar. En las demás causas el archivo SÍ llega
 * y lo que se discute es si se puede interpretar, que exige abrirlo.
 */
const CAUSAS_DE_DESCARGA = ['descarga', 'archivo-vacio'];

/** Cuánto se guarda en memoria para poder abrir el archivo y validarlo. */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * ¿Sigue siendo cierto que no se puede interpretar?
 *
 * Para las causas de contenido no vale con que el archivo llegue: el portal no
 * dijo que no llegara, dijo que no se podía abrir. Esto lo comprueba de verdad,
 * con la misma pregunta que hizo el analizador.
 */
async function validarContenido(item: Broken, buf: Uint8Array, ctype: string): Promise<Check> {
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
      if (res !== true) return ok(`XML mal formado: ${res.err.msg.slice(0, 60)}`);

      /*
       * `XMLValidator` no mira dentro del DTD interno, y ahí hay documentos
       * rotos que él da por buenos.
       *
       * El registro de desfibriladores empieza con `<!DOCTYPE DATOS [
       * <!ELEMENTDATOS (DATA_RECORD*)> …`: falta el espacio entre `<!ELEMENT` y
       * `DATOS`. El analizador de Python lo señala en la línea 3, columna 2, y
       * tiene razón; esta comprobación lo desmentía en cada ejecución y el
       * desmentido era falso. Un verificador que grita en falso acaba ignorándose.
       */
      const declaracionRota = /<!(ELEMENT|ATTLIST|ENTITY|NOTATION)(?![\s>])/.exec(text.slice(0, 65536));
      if (declaracionRota) {
        return ok(`DTD interno mal formado: «${declaracionRota[0]}» sin separar del nombre`);
      }
      return no(`el XML sí está bien formado (${buf.byteLength.toLocaleString('es-ES')} B)`);
    }

    case 'formato-no-esperado':
      // Un .xls/.xlsx que no empieza por "PK" no es un Excel moderno, diga lo
      // que diga la extensión ni el content-type.
      if (!zip) return ok(`no es un XLSX: llega ${ctype || 'sin tipo'}, ${buf.byteLength.toLocaleString('es-ES')} B`);
      return no(`sí parece un XLSX (ZIP, ${buf.byteLength.toLocaleString('es-ES')} B)`);

    /*
     * Añadido después de la primera verificación publicada, y conviene saber por
     * qué: esta causa NO tenía caso, así que caía al `default` y salía siempre
     * «inconcluso». O sea que los 6 `zip-invalido` del informe eran
     * inconfirmables por construcción, y las dos que entraron en la muestra
     * figuraban como sin confirmar cuando el origen devolvía 2 bytes: un ZIP no
     * puede pesar eso, le faltan hasta los 4 bytes de la firma.
     *
     * Se abre con `unzip`, el lector del propio portal, en vez de mirar los bytes
     * a mano: lo que se afirma es que el ZIP no se puede abrir, así que la comprobación
     * honesta es intentar abrirlo. Y se distingue un archivo roto de un formato que
     * nuestro lector no cubre —ZIP64, cifrado—, que es una limitación nuestra y no
     * un defecto de quien publica.
     */
    case 'zip-invalido': {
      const copia = buf.slice().buffer;
      try {
        const entradas = await unzip(copia);
        if (entradas.size === 0) return ok('el ZIP abre pero no trae ninguna entrada');
        const nombres = [...entradas.keys()].slice(0, 3).join(', ');
        return no(`el ZIP sí abre: ${entradas.size} entradas (${nombres})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/ZIP64|cifrad/i.test(msg)) {
          return { item, verdict: 'inconcluso', detail: `nuestro lector no cubre este ZIP: ${msg.slice(0, 60)}` };
        }
        return ok(`ZIP inválido: ${msg.slice(0, 60)}`);
      }
    }

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

/**
 * Lee el cuerpo contando bytes, con tope y sin acumular más de lo necesario.
 *
 * Para las causas de contenido hay que quedarse con los bytes y abrirlos; para
 * las de descarga basta con saber cuántos llegaron, así que por encima de
 * `MAX_BYTES` se sigue contando pero se deja de guardar. Sin eso, comprobar un
 * shapefile de 618 MB se lo traía entero a memoria para nada.
 */
async function leer(
  body: ReadableStream<Uint8Array>,
  guardarHasta: number
): Promise<{ bytes: number; muestra: Uint8Array; cortado: boolean }> {
  const reader = body.getReader();
  const trozos: Uint8Array[] = [];
  let bytes = 0;
  let guardados = 0;
  let cortado = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (guardados < guardarHasta) {
        trozos.push(value);
        guardados += value.byteLength;
      }
      if (bytes >= MAX_DOWNLOAD) {
        cortado = true;
        break;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const muestra = new Uint8Array(guardados);
  let pos = 0;
  for (const t of trozos) {
    muestra.set(t, pos);
    pos += t.byteLength;
  }
  return { bytes, muestra, cortado };
}

/** Descarga y cuenta qué pasó de verdad. */
async function probe(item: Broken): Promise<Check> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const arranque = Date.now();
  /*
   * Se descarga ENTERO, también para las causas de descarga.
   *
   * Antes se pedían 64 KB con `Range` para esos casos, con el argumento de no
   * bajarse un raster de 400 MB solo para saber si responde. El argumento era
   * malo: el portal no afirma «el servidor responde», afirma «este archivo no se
   * puede descargar», y eso solo se desmiente descargándolo.
   *
   * No es teórico. Dos shapefiles de incendios de 563 y 618 MB contestaban 206 a
   * la petición de 64 KB —así que esta herramienta los daba por buenos— y
   * tardaban 130 y 157 s en entregarse enteros, por encima del plazo que tenía
   * entonces el analizador. Estuvieron publicados como rotos sin estarlo, y esta
   * comprobación, que existe justo para cazar eso, miró para otro lado.
   */
  try {
    const res = await fetch(item.url, {
      headers: { 'user-agent': 'CyLMetrics-verificacion/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const ctype = (res.headers.get('content-type') ?? '').split(';')[0].trim();

    // El origen falla antes de entregar nada: el portal tenía razón.
    if (!res.ok && res.status !== 206) {
      return { item, verdict: 'confirmado', detail: `HTTP ${res.status}` };
    }
    if (!res.body) {
      return { item, verdict: 'confirmado', detail: `HTTP ${res.status} sin cuerpo` };
    }

    const { bytes, muestra, cortado } = await leer(res.body, MAX_BYTES);
    const segundos = (Date.now() - arranque) / 1000;
    const cuanto = `${(bytes / 1048576).toFixed(1)} MB en ${segundos.toFixed(0)} s`;

    const head = new TextDecoder('utf-8', { fatal: false }).decode(muestra.slice(0, 512)).trimStart();
    if (/^<!doctype html|^<html/i.test(head) && item.format !== 'HTML') {
      return { item, verdict: 'confirmado', detail: `HTTP ${res.status} pero devuelve HTML` };
    }
    if (bytes === 0) {
      return { item, verdict: 'confirmado', detail: `HTTP ${res.status} con cuerpo vacío` };
    }

    // Llegó, y entero. Si el portal dijo «no se descarga», queda desmentido; el
    // tiempo se publica porque es la mitad del diagnóstico: un archivo que tarda
    // 157 s explica por qué el analizador lo daba por perdido.
    if (CAUSAS_DE_DESCARGA.includes(item.cause)) {
      return {
        item,
        verdict: 'discrepa',
        detail: `HTTP ${res.status} · ${ctype || 'sin tipo'} · ${cuanto}${cortado ? ' (tope)' : ''}`,
      };
    }

    // Causa de contenido: hay que abrirlo, y para eso hace falta el archivo.
    if (cortado || bytes > MAX_BYTES) {
      return { item, verdict: 'inconcluso', detail: `${cuanto}, por encima del tope para validarlo` };
    }
    return await validarContenido(item, muestra, ctype);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const msg = err instanceof Error ? err.message : String(err);
    const segundos = ((Date.now() - arranque) / 1000).toFixed(0);
    return {
      item,
      verdict: 'confirmado',
      detail:
        name === 'AbortError'
          ? `sin entregar el archivo en ${TIMEOUT_MS / 1000} s`
          : `${name} a los ${segundos} s: ${msg.slice(0, 70)}`,
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

/*
 * El artefacto que publica la página.
 *
 * Hasta ahora esto solo se imprimía en consola, así que la comprobación existía y
 * no se veía: el portal señala cientos de archivos como no accesibles y la
 * comprobación que lo respalda —haberlos ido a buscar al origen— vivía solo en la
 * consola de quien ejecutaba el script. Escribirlo la deja como evidencia junto al
 * informe que verifica.
 *
 * Se guarda TODO lo que no se confirmó, con su URL y su motivo, y no solo los
 * recuentos. Una verificación que solo publica «salió bien» no es verificable, que
 * es exactamente lo que este proyecto le reprocha a los demás.
 */
const perCause = [...byCause.entries()]
  .map(([cause, list]) => {
    const checked = results.filter((r) => r.item.cause === cause);
    return {
      cause,
      label: list[0].causeLabel,
      broken: list.length,
      checked: checked.length,
      confirmado: checked.filter((r) => r.verdict === 'confirmado').length,
      discrepa: checked.filter((r) => r.verdict === 'discrepa').length,
      inconcluso: checked.filter((r) => r.verdict === 'inconcluso').length,
    };
  })
  .sort((a, b) => b.broken - a.broken);

const verification = {
  verified_at: new Date().toISOString(),
  /** El informe que se verificó, para que la página detecte si ya está viejo. */
  report_generated_at: report.generated_at,
  broken_total: broken.length,
  sample: {
    checked: results.length,
    strategy: all ? 'todos' : 'estratificada por causa, con un mínimo de 2 por causa',
  },
  totals: {
    confirmado: count('confirmado'),
    discrepa: count('discrepa'),
    inconcluso: count('inconcluso'),
  },
  by_cause: perCause,
  /** Lo que NO quedó confirmado, entero: es la parte que hay que poder auditar. */
  unconfirmed: results
    .filter((r) => r.verdict !== 'confirmado')
    .map(({ item, verdict, detail }) => ({
      verdict,
      format: item.format,
      cause: item.cause,
      label: item.causeLabel,
      dataset: item.dataset,
      url: item.url,
      detail,
    })),
};

fs.writeFileSync(outPath, `${JSON.stringify(verification, null, 2)}\n`);
console.log(`\nEscrito ${outPath}`);
