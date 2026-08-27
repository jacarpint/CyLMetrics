/**
 * Los cuatro pasos de la comprobación, en un solo sitio.
 *
 * Estaban escritos dos veces —una en Inicio y otra en Metodología— y ya habían
 * divergido: el tercer paso se llamaba «Se abre con su analizador» en una página
 * y «Se identifica y se abre» en la otra. Aquí viven una vez, con dos
 * redacciones declaradas: `short` para la portada, que solo necesita transmitir
 * la idea, y `long` para Metodología, que además tiene que ser auditable.
 *
 * `detail` es telemetría de operación (topes, tiempos de espera). Da confianza a
 * quien la busca, así que no se tira; pero va en letra pequeña y, en Metodología,
 * dentro del bloque de detalle técnico plegado.
 */
export interface PipelineStep {
  /** Clave del icono, que resuelve cada página con su propio import. */
  icon: 'catalogo' | 'descarga' | 'lectura' | 'registro';
  title: string;
  /** Versión de portada: qué pasa y por qué importa. */
  short: string;
  /** Versión de metodología: lo mismo, con los límites reales del código. */
  long: string;
  /**
   * Límites operativos concretos de este paso.
   *
   * Estas cifras viven en el analizador, que es Python, así que no se pueden
   * importar y hay que escribirlas. Ya envejecieron una vez —se publicaba «tope
   * 25 MB · … · 60 s de lectura» mucho después de que el análisis subiera a 512
   * MB y 120 s—, y llegaron a contradecir a la propia página de Metodología.
   * `pipeline-limits.test.ts` las contrasta contra `cli.py` y `downloader.py`
   * para que no vuelva a pasar: si tocas un tope allí, este texto falla aquí.
   */
  detail: string;
}

export const PIPELINE: PipelineStep[] = [
  {
    icon: 'catalogo',
    title: 'Se lee el catálogo',
    short:
      'Del catálogo oficial se extraen los metadatos de cada conjunto de datos: título, licencia, organismo, temática y la dirección de cada archivo.',
    long:
      'Del catálogo oficial se extrae cada conjunto de datos con su título, licencia, organismo, temática, fechas, periodicidad declarada y la dirección de cada archivo. El portal lo lee en vivo; si el servicio no responde, sigue sirviendo la última copia buena en vez de quedarse en blanco.',
    detail: 'una petición · lectura en vivo · copia de respaldo si el origen falla',
  },
  {
    icon: 'descarga',
    title: 'Se descarga cada archivo',
    short:
      'Uno a uno, siguiendo redirecciones y respetando límites de tamaño. Aquí ya se descubre lo que ningún inventario de metadatos ve: enlaces caídos y direcciones que devuelven una página en vez del dato.',
    long:
      'Uno a uno. Primero se pregunta cuánto pesa: si declara más del tope, se anota y no se descarga, y queda como «sin analizar» en vez de contarse como fallo. Si cabe, se descarga siguiendo redirecciones y conservando la extensión original, porque los lectores de CSV y Excel deducen el formato de ella.',
    detail: 'tope 512 MB · 15 s para conectar · 300 s de lectura · 2 reintentos',
  },
  {
    icon: 'lectura',
    title: 'Se intenta abrir',
    short:
      'Cada formato con su lector: CSV, Excel, JSON, XML, mapas y servicios cartográficos. Si no abre, no es reutilizable, por muy completos que sean sus metadatos.',
    long:
      'Antes de abrirlo se mira lo que hay dentro, no la extensión: si el archivo empieza como una página web, es una página web disfrazada de dato; si trae un mensaje de error de un servidor de mapas, es el servicio contestando que la capa ya no existe. En los CSV se detecta además la codificación y el separador. Después, cada formato con su lector: CSV, Excel, JSON, XML, KML, GeoJSON, shapefiles, calendarios, imágenes y servicios de mapas WMS y WFS.',
    detail: 'el tipo se decide por el contenido, no por la extensión',
  },
  {
    icon: 'registro',
    title: 'Se registra y se puntúa',
    short:
      'Las incidencias se agrupan por tipo y gravedad, y quedan publicadas archivo por archivo para que cualquiera pueda comprobarlas o corregirlas.',
    long:
      'Cada problema se anota con un código estable, su gravedad, cuántas veces ocurre y algunos ejemplos con su fila y su columna. De ahí sale la puntuación de contenido del archivo, y de la media de sus archivos, la del conjunto de datos.',
    detail: 'hasta 5 ejemplos guardados por tipo de incidencia',
  },
];
