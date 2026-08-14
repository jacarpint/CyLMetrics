/**
 * Etiquetas legibles de códigos de incidencia del informe de análisis.
 *
 * Módulo "client-safe": SIN imports de node:* para poder usarse desde
 * componentes cliente (a diferencia de `quality-report.ts`, que lee el
 * informe con fs y solo puede usarse en servidor).
 *
 * La lista de códigos se mantiene sincronizada con los analizadores de
 * `src/analysis` (ver cada "code" emitido en formats/*.py y engine.py).
 */

/**
 * Las tres dimensiones que se le pueden achacar al dato, más una cuarta que no.
 *
 * `portal` existe porque faltaba: el analizador emite incidencias que no hablan
 * del archivo sino de nosotros —no teníamos instalado el lector, se agotó
 * nuestro tope de descarga, se cayó nuestro propio código— y estaban repartidas
 * entre `format` y ninguna categoría. Clasificar «openpyxl no disponible» como
 * conformidad de formato atribuía al publicador una librería que no habíamos
 * instalado.
 */
export type IssueCategory = 'availability' | 'format' | 'content' | 'portal';

/* ── Formateo (aquí y no en quality-report.ts, para que también lo puedan
      usar los componentes cliente) ── */

/** Decimal con coma: `toFixed` siempre usa punto y el portal está en español. */
function esNumber(value: number, decimals: number): string {
  return value.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  if (bytes >= 1e9) return `${esNumber(bytes / 1e9, 2)} GB`;
  if (bytes >= 1e6) return `${esNumber(bytes / 1e6, 1)} MB`;
  if (bytes >= 1e3) return `${esNumber(bytes / 1e3, 0)} KB`;
  return `${esNumber(bytes, 0)} B`;
}

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${esNumber(s, 1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/* ── Volumen de datos analizado ────────────────────────────────────────────
   El analizador nombra las métricas según el formato (`rows`/`columns` en
   CSV y JSON tabular, `total_rows`/`sheet_count` en XLSX, `total_elements`
   en XML/RSS). La UI leía `row_count`/`col_count`, claves que el analizador
   NO emite en ningún formato: por eso los contadores salían siempre vacíos.
   Este helper es el único sitio donde vive esa correspondencia.            */

export interface VolumeMetric {
  value: number;
  label: string;
}

export interface DistributionVolume {
  /** Eje principal: filas, elementos, entidades… */
  primary: VolumeMetric | null;
  /** Eje secundario: columnas, campos, hojas… */
  secondary: VolumeMetric | null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function distributionVolume(
  format: string | undefined,
  metrics: Record<string, unknown> | null | undefined
): DistributionVolume {
  const m = metrics ?? {};
  const rows = asNumber(m.rows);
  const columns = asNumber(m.columns);
  const fmt = (format ?? '').toUpperCase();

  if (fmt === 'JSON' || fmt === 'GEOJSON') {
    const elements = asNumber(m.elements) ?? rows;
    return {
      primary: elements != null ? { value: elements, label: 'Elementos' } : null,
      secondary: columns != null ? { value: columns, label: 'Campos' } : null,
    };
  }

  if (fmt === 'XLSX' || fmt === 'XLS') {
    const totalRows = asNumber(m.total_rows) ?? rows;
    const sheets = asNumber(m.sheet_count);
    return {
      primary: totalRows != null ? { value: totalRows, label: 'Filas totales' } : null,
      secondary: sheets != null ? { value: sheets, label: 'Hojas' } : columns != null ? { value: columns, label: 'Columnas' } : null,
    };
  }

  if (fmt === 'XML' || fmt === 'RDF' || fmt === 'RSS') {
    const elements = asNumber(m.total_elements);
    const items = asNumber(m.items) ?? asNumber(m.dcat_datasets);
    return {
      primary: elements != null ? { value: elements, label: 'Elementos' } : null,
      secondary: items != null ? { value: items, label: 'Registros' } : null,
    };
  }

  if (fmt === 'WFS') {
    const types = asNumber(m.feature_types);
    return { primary: types != null ? { value: types, label: 'Tipos de entidad' } : null, secondary: null };
  }

  if (fmt === 'WMS') {
    const layers = asNumber(m.layers);
    return { primary: layers != null ? { value: layers, label: 'Capas' } : null, secondary: null };
  }

  if (fmt === 'SHP') {
    const features = asNumber(m.features);
    const fields = asNumber(m.fields);
    return {
      primary: features != null ? { value: features, label: 'Entidades' } : null,
      secondary: fields != null ? { value: fields, label: 'Campos' } : null,
    };
  }

  if (fmt === 'TXT' && rows == null) {
    const lines = asNumber(m.lines);
    return { primary: lines != null ? { value: lines, label: 'Líneas' } : null, secondary: null };
  }

  return {
    primary: rows != null ? { value: rows, label: 'Filas' } : null,
    secondary: columns != null ? { value: columns, label: 'Columnas' } : null,
  };
}

/** Celdas analizadas (filas × columnas), para calcular el % de incidencias. */
export function analyzedCells(metrics: Record<string, unknown> | null | undefined): number {
  const rows = asNumber((metrics ?? {}).rows);
  const columns = asNumber((metrics ?? {}).columns);
  return rows != null && columns != null ? rows * columns : 0;
}

/** Categoriza un código de incidencia. `portal` va primero: no es del dato. */
export function issueCategory(code: string): IssueCategory {
  if (PORTAL_LIMITATION_CODES.has(code)) return 'portal';
  if (code in AVAILABILITY_ISSUES) return 'availability';
  if (code in FORMAT_ISSUES) return 'format';
  return 'content';
}

/**
 * Etiqueta legible para un código de incidencia (para nivel dataset).
 *
 * El respaldo NO puede ser el código: devolverlo tal cual es lo que sacaba
 * «downloaded» a la tabla de archivos, en inglés y en minúsculas, como si fuera
 * el motivo por el que un XLSX no se había analizado. Y no era un caso aislado:
 * `DEFAULT_ISSUE` de `formats/tabular.py` puede emitir cualquier tipo crudo de
 * Frictionless como código, así que la lista de abajo nunca va a estar completa
 * por definición. El código sigue estando disponible para depurar, pero no se
 * enseña como si fuera una frase.
 */
export function issueLabel(code: string): string {
  return ISSUE_LABELS[code] ?? 'Incidencia sin descripción';
}

/**
 * Códigos que hablan del portal, no del archivo.
 *
 * Falta un lector, se agotó nuestro tope de descarga, se rompió nuestro propio
 * analizador: en los tres casos el archivo puede estar perfectamente y lo único
 * que sabemos es que no lo hemos comprobado. No cuentan como error del dato, no
 * entran en las medias de calidad y se presentan como «sin analizar».
 *
 * Tiene que decir lo mismo que `PORTAL_LIMITATION_CODES` en
 * `src/analysis/checks.py`; hay un test que compara las dos listas, porque la
 * sincronización entre los analizadores y estas tablas es manual.
 *
 * Deliberadamente fuera: `no-es-archivo` y `no-es-imagen`. Que la URL publicada
 * devuelva una página web en vez del archivo es un defecto de publicación, no
 * una limitación nuestra, aunque `engine.py` los degrade a «omitida» junto a
 * estos.
 */
export const PORTAL_LIMITATION_CODES: ReadonlySet<string> = new Set([
  'dependencia-faltante',
  'fallo-analizador',
  'error-validacion',
  'descarga-truncada',
  'too_large',
]);

/** Se lee igual que `isBlockingCode` de `alerts.ts`, y por eso está aquí. */
export function isPortalLimitation(code: string): boolean {
  return PORTAL_LIMITATION_CODES.has(code);
}

/** Etiqueta legible para una categoría de incidencia. */
export function categoryLabel(cat: IssueCategory): string {
  return CATEGORY_LABELS[cat];
}

/** Etiqueta legible para el tipo de una columna del esquema inferido. */
export function schemaTypeLabel(type: string): string {
  return SCHEMA_TYPE_LABELS[type] ?? type;
}

const SCHEMA_TYPE_LABELS: Record<string, string> = {
  string: 'Texto',
  number: 'Número',
  date: 'Fecha',
  // «Booleano» solo lo entiende quien programa; lo que la columna contiene es
  // sí o no.
  boolean: 'Sí / No',
  unknown: 'Sin determinar',
};

const AVAILABILITY_ISSUES: Record<string, true> = {
  'descarga': true,
  'error-fuente': true,
  'no-es-archivo': true,
  'archivo-vacio': true,
  'servicio-no-disponible': true,
  // El origen contesta, pero con un error OGC en vez del archivo: el recurso
  // publicado apunta a una capa que ya no existe en el servidor.
  'servicio-error': true,
};

/**
 * `descarga-truncada` no entraba en ninguna categoría a propósito: no es un
 * fallo del recurso sino del tope de descarga del analizador, y clasificarlo
 * como problema de disponibilidad o de formato penalizaría al publicador por una
 * limitación nuestra. Ahora tiene sitio propio: `PORTAL_LIMITATION_CODES`, junto
 * al resto de lo que es nuestro. Quedarse sin categoría funcionaba solo mientras
 * nadie preguntara, y `dependencia-faltante` demostró que se preguntaba.
 */

const FORMAT_ISSUES: Record<string, true> = {
  'formato-no-esperado': true,
  'json-invalido': true,
  'xml-no-bien-formado': true,
  'xlsx-invalido': true,
  'zip-invalido': true,
  'xml-reparado': true,
  'error-encoding': true,
  'tipo-detectado': true,
  'tipo-no-identificado': true,
  'xls-legado': true,
  // `dependencia-faltante` y `error-validacion` estaban aquí: son limitaciones
  // del portal, no de la conformidad del archivo. Ver `PORTAL_LIMITATION_CODES`.
  'error-esquema': true,
  'ical-invalido': true,
  'firma-invalida': true,
  'geojson-invalido': true,
  'raiz-invalida': true,
  'shp-faltante': true,
  'zip-extraccion': true,
  'shp-lectura': true,
  'no-es-imagen': true,
};

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  availability: 'Disponibilidad',
  format: 'Conformidad del formato',
  content: 'Calidad de contenido',
  portal: 'Limitación de este portal',
};

/**
 * Etiquetas de incidencia en lenguaje llano.
 *
 * Estas cadenas son lo que lee cualquiera que entre en el portal: salen en las
 * filas de la tabla de archivos, en la ficha de cada archivo y en el CSV
 * descargable. Estaban escritas en el idioma del motor de análisis —«no se puede
 * parsear», «la firma (magic bytes) no es la esperada», «no declara
 * FeatureTypes»—, que no significa nada para quien publica los datos ni para
 * quien quiere reutilizarlos.
 *
 * El criterio: decir qué le pasa al archivo, no cómo lo ha detectado el
 * analizador. El nombre del formato se mantiene cuando es lo que el publicador
 * tiene que buscar (XLSX, GeoJSON, shapefile); se retira cuando es solo el
 * mecanismo interno.
 */
export const ISSUE_LABELS: Record<string, string> = {
  // Estados de la descarga (`fetch.status`). No son incidencias del analizador,
  // pero `deliveryCause` cae a ellos cuando la descarga falla sin dejar código,
  // y sin etiqueta se enseñaban en crudo: «http_error».
  //
  // Están los ocho, no los cuatro que fallan. Faltaban justo los que significan
  // que la descarga fue BIEN, y ahí estaba el error que se veía en producción:
  // un XLSX descargado con éxito del que no teníamos lector aparecía en la tabla
  // de archivos etiquetado «downloaded», con HTTP 200 al lado. `deliveryCause` ya
  // no cae aquí cuando los bytes han llegado, pero estas cuatro entradas son la
  // segunda línea: si alguna vez vuelve a caer, al menos se leerá en español.
  http_error: 'El servidor respondió con un error',
  unreachable: 'No se pudo contactar con el servidor',
  service: 'El servicio de origen no atendió la petición',
  too_large: 'Supera el tamaño máximo que este portal descarga',
  downloaded: 'El archivo se descargó completo',
  truncated: 'El archivo se descargó solo en parte',
  no_url: 'El catálogo no publica ninguna URL de acceso',
  error: 'Fallo interno del análisis de este portal',
  'celda-faltante': 'Celdas vacías en filas con datos',
  'error-tipo': 'Valores que no encajan con el tipo de su columna',
  'encabezado-vacio': 'Encabezados de columna vacíos',
  'fila-vacia': 'Filas completamente vacías',
  'celda-extra': 'Celdas de más (filas más largas que el encabezado)',
  'encabezado-duplicado': 'Encabezados de columna duplicados',
  'fila-duplicada': 'Filas duplicadas',
  'error-restriccion': 'Valores fuera de lo que admite su columna',
  'error-unico': 'Valores repetidos en una columna que no debería repetirlos',
  'error-esquema': 'No se ha podido deducir la estructura de las columnas',
  'zip-invalido': 'El archivo comprimido (ZIP) está dañado',
  'servicio-error': 'El servicio de origen rechaza la descarga del archivo',
  'descarga-truncada': 'Comprobado solo en parte: la descarga se cortó por tamaño',
  'json-invalido': 'El archivo JSON no se puede leer',
  'xlsx-invalido': 'El archivo Excel no se puede abrir',
  'formato-no-esperado': 'El contenido no coincide con el formato declarado',
  'xml-no-bien-formado': 'El archivo XML tiene errores de estructura',
  'archivo-vacio': 'El archivo se descarga vacío (0 bytes)',
  'error-encoding': 'Los acentos y las eñes llegan corrompidos',
  'no-es-archivo': 'La URL no devuelve un archivo',
  'error-fuente': 'El servidor de origen devolvió un error',
  'xml-reparado': 'El XML tenía errores que se han corregido al leerlo',
  'descarga': 'Error de descarga',
  'fallo-analizador': 'Fallo interno del análisis de este portal',
  'tipo-detectado': 'El contenido no coincide con el formato anunciado',
  'tipo-no-identificado': 'No se ha podido identificar qué tipo de archivo es',
  'xls-legado': 'Se anuncia como XLSX pero es un Excel antiguo (.xls)',
  'dependencia-faltante': 'Este portal no dispone de lector para este formato',
  'error-validacion': 'La comprobación de la estructura no se pudo completar',
  'servicio-no-disponible': 'El servicio de mapas no responde',
  'no-es-imagen': 'El contenido descargado no es una imagen',
  'sin-datos': 'El archivo no contiene ninguna fila de datos',
  'sin-contenido': 'El archivo no tiene contenido',
  'sin-entidades': 'El documento no contiene ningún registro',
  'sin-eventos': 'El calendario no contiene eventos',
  'errores-linea': 'Líneas mal formadas que se han descartado al leer',
  'sin-capas': 'El servicio de mapas no ofrece ninguna capa',
  'sin-feature-types': 'El servicio de mapas no ofrece ninguna capa de datos',
  'imagen-corrupta': 'La imagen está dañada y no se puede abrir',
  'firma-invalida': 'El contenido no es del tipo que anuncia el archivo',
  'geojson-invalido': 'El archivo GeoJSON no cumple la especificación',
  'raiz-invalida': 'El documento no tiene la estructura esperada',
  'tipo-desconocido': 'El GeoJSON usa un tipo de geometría no reconocido',
  'geometria-nula': 'Elementos sin ubicación en el mapa',
  'sin-features': 'El archivo no contiene ningún elemento geográfico',
  'sin-prj': 'El mapa no dice en qué sistema de coordenadas está (falta el .prj)',
  'shp-faltante': 'El ZIP no contiene el mapa (.shp) que debería',
  'zip-extraccion': 'El ZIP no se ha podido descomprimir',
  'shp-lectura': 'El mapa (shapefile) no se ha podido leer',
  'ical-invalido': 'El calendario no se puede leer',
};

/**
 * Qué significa cada incidencia para quien quiere usar el archivo.
 *
 * Complementa a `ISSUE_LABELS`, no lo repite: la etiqueta dice *qué le pasa* al
 * archivo y sale como titular; esto dice *qué implica* y se lee debajo. Escribir
 * aquí otra vez el titular con más palabras es lo que hacía la tabla anterior.
 *
 * Vivía dentro del explorador de incidencias, aislada del resto del portal, y de
 * ahí venían sus dos defectos. Cubría 18 de los 50 códigos, así que los otros 32
 * se desplegaban sin ninguna explicación —el hueco no se veía, simplemente no se
 * pintaba nada—. Y estaba escrita para quien programa: «puede causar errores en
 * parsers», «conflictos al indexar o hacer joins», «timeout, 404, acceso
 * denegado». Justo la página donde alguien llega sin saber qué mira era la única
 * que no hablaba su idioma.
 *
 * El criterio es el de la consecuencia: no cómo lo ha detectado el analizador,
 * sino qué se encuentra quien abra el archivo. Y separado a propósito de
 * `CONTENT_ACTIONS` en `repair-actions.ts`, que dice qué hacer para arreglarlo:
 * eso se lee desde el panel de reparación, donde está quien publica el dato y
 * puede ejecutarlo. Aquí está quien lo reutiliza, y darle instrucciones sobre un
 * archivo que no controla no le sirve de nada.
 */
const ISSUE_EXPLANATIONS: Record<string, string> = {
  // Estados de la descarga, por si `deliveryCause` cae a ellos sin código.
  http_error:
    'El servidor del organismo contesta, pero con un error en lugar del archivo. Si no es algo momentáneo, el enlace del catálogo apunta a algo que ya no está ahí.',
  unreachable:
    'No hay respuesta del servidor que guarda el archivo. Mientras siga así, el dato consta como publicado pero no hay forma de conseguirlo.',
  service:
    'El servicio que sirve estos datos recibe la petición y no la atiende. Puede estar saturado o no admitir descargas automáticas.',
  too_large:
    'El archivo pasa del tamaño que este portal descarga para analizar, así que su contenido no se ha comprobado. No es un defecto del archivo: se sigue pudiendo descargar del enlace original.',
  no_url:
    'La ficha del conjunto de datos describe este recurso pero no dice de dónde bajarlo, así que no hay nada que comprobar. El dato puede existir; lo que falta es el enlace en el catálogo.',
  downloaded:
    'Los bytes del archivo llegaron completos. Si aun así aparece aquí como motivo, lo que falla no es la descarga sino el análisis posterior, y el archivo puede estar perfectamente.',
  truncated:
    'El archivo llegó solo hasta el tope que este portal descarga, así que las cifras de filas y columnas son de la parte leída y no del total. El archivo completo sigue estando en su enlace original.',
  error:
    'El análisis de este portal se interrumpió antes de poder decir nada del archivo. Es un problema nuestro, no del dato: hace falta repetir la comprobación para saber cómo está.',

  // Contenido: el archivo se abre, lo que hay dentro es lo que falla.
  'celda-faltante':
    'Hay filas con datos en unas columnas y vacías en otras. Puede ser normal —un campo que no siempre aplica— o faltar de verdad; el archivo por sí solo no lo distingue, hay que mirar de qué columna se trata.',
  'error-tipo':
    'Una columna que casi siempre trae números o fechas contiene algún valor de otro tipo. Al sumarla u ordenarla el resultado sale mal, y nada avisa de que ha salido mal.',
  'encabezado-vacio':
    'Alguna columna llega sin nombre en la primera fila. Al abrir el archivo no hay manera de saber qué contiene, ni de referirse a ella.',
  'fila-vacia':
    'Entre los datos hay filas completamente en blanco. Cuentan al contar filas, así que hay que quitarlas antes de usar el archivo.',
  'celda-extra':
    'Algunas filas traen más celdas que columnas tiene el encabezado, así que a partir de ahí los valores dejan de corresponder con su columna. Suele venir de un separador colado dentro de un texto sin entrecomillar.',
  'encabezado-duplicado':
    'Dos columnas se llaman igual, así que al pedir esa columna por su nombre no se sabe cuál de las dos llega.',
  'fila-duplicada':
    'El mismo registro aparece más de una vez. Si se cuentan o se suman, el total sale inflado.',
  'error-restriccion':
    'Hay valores que se salen de lo que su propia columna admite según la estructura que el archivo declara.',
  'error-unico':
    'Una columna que debería identificar cada fila repite valores, así que no sirve para distinguir una fila de otra.',
  'error-esquema':
    'No se ha podido determinar qué contiene cada columna, normalmente porque el encabezado o los datos no son uniformes. Sin eso, las demás comprobaciones de contenido no se pueden aplicar.',
  'sin-datos':
    'El archivo tiene encabezado pero ninguna fila debajo: está la estructura, no los datos.',
  'sin-contenido': 'El archivo se abre pero no tiene nada dentro. No hay nada que consultar.',
  'sin-entidades': 'El documento se lee sin problemas, pero no contiene ningún registro.',
  'sin-eventos': 'El calendario se lee sin problemas, pero no tiene ninguna cita dentro.',
  'errores-linea':
    'Algunas líneas no se han podido leer y se han descartado, así que lo que se ve es el archivo sin ellas y las cifras cubren solo las líneas válidas.',
  'geometria-nula':
    'Hay elementos sin coordenadas: están en el archivo, pero no se pueden situar en el mapa.',
  'sin-features': 'El archivo es un mapa, pero no contiene ninguna forma que dibujar.',
  'descarga-truncada':
    'La descarga se cortó al llegar al tope de este portal, así que todo lo analizado cubre solo el principio del archivo. Las cifras son de esa parte, no del total.',
  'fallo-analizador':
    'El análisis de este portal falló al procesar el archivo. Es un problema nuestro, no del dato: el archivo puede estar perfectamente.',

  // Formato: lo que llega no es lo que dice ser, o no se puede abrir.
  'zip-invalido':
    'Lo que se descarga no se abre como archivo comprimido, así que no hay forma de llegar a lo que lleva dentro.',
  'json-invalido':
    'El texto del archivo no cumple las reglas del formato JSON, así que ningún programa lo lee tal cual.',
  'xlsx-invalido':
    'El archivo no se abre como hoja de cálculo. Puede estar dañado o ser en realidad otro formato con la extensión cambiada.',
  'formato-no-esperado':
    'Lo que devuelve el enlace no es del formato que anuncia el catálogo. Quien lo descargue esperando ese formato se encontrará otra cosa.',
  'xml-no-bien-formado':
    'El archivo XML tiene etiquetas mal cerradas o caracteres que no admite, y así no se puede leer.',
  'error-encoding':
    'El archivo no respeta la codificación con la que dice estar escrito, así que los acentos y las eñes se leen como símbolos raros.',
  'xml-reparado':
    'El XML tenía defectos que se han podido sortear al leerlo aquí, pero un programa más estricto puede rechazarlo.',
  'tipo-detectado':
    'El contenido real del archivo no es del tipo que anuncian su extensión y el catálogo.',
  'tipo-no-identificado':
    'No se ha reconocido de qué tipo es el contenido descargado, así que no se sabe con qué abrirlo.',
  'xls-legado':
    'Se anuncia como XLSX pero por dentro es un Excel de los antiguos. Los programas que solo aceptan XLSX lo rechazan.',
  'dependencia-faltante':
    'Este portal no tiene con qué leer este formato, así que su contenido no se ha comprobado. No es un defecto del archivo.',
  'error-validacion':
    'La comprobación de la estructura no se pudo terminar, así que de este archivo consta lo que se ve, pero sin verificar.',
  'ical-invalido':
    'El archivo no se abre como calendario, así que no se puede cargar en una agenda.',
  'firma-invalida':
    'El interior del archivo no corresponde al tipo que anuncia: por dentro es otra cosa.',
  'geojson-invalido':
    'El archivo se lee como JSON pero no respeta las reglas del GeoJSON, así que los programas de mapas no lo aceptan.',
  'raiz-invalida':
    'El documento se lee, pero por dentro no tiene la forma que su formato exige.',
  'tipo-desconocido':
    'El archivo usa un tipo de forma geográfica que no está entre los que define el formato, así que puede no dibujarse.',
  'sin-prj':
    'Falta la pieza que dice en qué sistema de coordenadas está el mapa. Sin ella hay que suponerlo, y al suponer mal las formas aparecen en otro punto del mundo.',
  'shp-faltante':
    'El comprimido no incluye el .shp, que es la pieza con el mapa. Sin ella, las demás no sirven de nada.',
  'zip-extraccion':
    'El comprimido se reconoce como tal, pero no se ha podido abrir para sacar lo que hay dentro.',
  'shp-lectura': 'El mapa viene dentro del comprimido, pero no se ha podido leer.',
  'no-es-imagen': 'Lo que devuelve el enlace no es una imagen, aunque se anuncie como tal.',
  'imagen-corrupta': 'La imagen se descarga, pero no se puede abrir.',

  // Disponibilidad: no se llega al archivo.
  'descarga':
    'El archivo no se ha podido descargar del servidor del organismo. Mientras siga así, figura en el catálogo pero no se puede conseguir.',
  'error-fuente':
    'El servidor que guarda el archivo devolvió un error en lugar del contenido.',
  'no-es-archivo':
    'La dirección responde, pero con una página web en lugar del archivo. Una persona puede buscar dentro el enlace de descarga; un programa que se actualiza solo, no.',
  'archivo-vacio': 'La descarga funciona, pero lo que llega no tiene nada dentro: cero bytes.',
  'servicio-no-disponible': 'El servicio de mapas que sirve estos datos no responde.',
  'servicio-error':
    'El servicio contesta, pero rechaza la petición de este archivo. Suele querer decir que la capa publicada ya no existe en el servidor.',
  'sin-capas':
    'El servicio de mapas responde, pero no ofrece ninguna capa: no hay nada que consultar.',
  'sin-feature-types':
    'El servicio responde, pero no ofrece ninguna capa de datos que se pueda descargar.',
};

/**
 * Qué implica una incidencia para quien usa el archivo, o `null` si no consta.
 *
 * Devuelve `null` en vez de una cadena vacía para que quien llama se ahorre el
 * recuadro entero: un bloque de explicación vacío es peor que ninguno.
 */
export function issueExplanation(code: string): string | null {
  return ISSUE_EXPLANATIONS[code] ?? null;
}

/**
 * Fecha ISO en formato largo castellano: «1 de marzo de 2022».
 *
 * Las mismas opciones estaban repetidas en cada página que muestra una fecha, y
 * una fecha inválida se pintaba tal cual —cadena ISO en crudo— o rompía el
 * render. Devuelve `null` cuando no hay nada que formatear, para que quien llama
 * decida qué poner.
 */
export function formatLongDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
