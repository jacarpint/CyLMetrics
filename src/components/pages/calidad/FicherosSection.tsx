'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileWarning,
  ListFilter, Search, SearchCode, Table2, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DownloadButton } from '@/components/ui/download-button';
import { cn } from '@/lib/utils';
import { issueLabel, formatBytes } from '@/lib/quality-labels';
import { isGeoFormat } from '@/lib/geo';
import {
  DELIVERY_EXPLANATIONS, DELIVERY_SHORT, groupByCause, rowMatchesCauses,
  type ContentSummary, type DeliveryState, type FileIssueRow,
} from '@/lib/availability';
import { toCsv } from '@/lib/csv-write';
import type { FamilyFilter, QualityFilters } from '@/lib/quality-filters';
import type { FormatSummary } from '@/lib/quality-report';

interface FicherosSectionProps {
  rows: FileIssueRow[];
  /** Notas del analizador sin repetir; las filas apuntan por `noteIdx`. */
  notes: string[];
  /** Resultados por formato del informe, para el bloque plegado. */
  byFormat: [string, FormatSummary][];
  /**
   * Calidad media por formato recalculada, en vez del `avg_score` del informe.
   *
   * Llega desde el servidor porque hace falta el informe entero para calcularla y
   * aquí solo hay el resumen. Ver `formatContentScores`: el `avg_score` del
   * informe incluye los ceros que los analizadores ponen cuando les falta su
   * lector, y con eso XLSX salía al 0 %.
   */
  formatScores: Record<string, ContentSummary>;
  /**
   * Filtros leídos de la URL, ya interpretados por `parseQualityFilters`.
   *
   * Siembran el estado local, y la página fuerza un remontaje con `key` cuando
   * cambian: el buscador escribe en cada tecla y no puede navegar por cada letra,
   * pero al llegar desde otro enlace el filtro tiene que ser el nuevo.
   */
  filters: QualityFilters;
}

/** Filas por página, y las que añade cada «Mostrar más». */
const PAGE = 50;

/**
 * Cuántas causas se ofrecen como botón.
 *
 * El catálogo tiene 15 distintas y una cola muy fina —las últimas afectan a uno
 * o dos archivos—, así que este corte deja fuera lo anecdótico sin esconder nada
 * con volumen. Las causas activas se añaden aparte aunque caigan fuera.
 */
const TOP_CAUSES = 12;

/**
 * Chip de filtro activo, con el anillo de foco que lleva el resto del portal.
 *
 * Son botones que quitan un filtro, así que además de la etiqueta visible cada uno
 * necesita un nombre accesible que diga qué hace: «formato: GML» a secas no dice
 * que al pulsarlo se quite. Ver `chipLabel`.
 */
const CHIP = [
  'inline-flex items-center gap-1 rounded-md border border-border bg-fill px-2 py-0.5 text-body',
  'transition-colors hover:bg-fill-strong',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
].join(' ');

const chipLabel = (what: string, value: string) => `Quitar el filtro ${what}: ${value}`;

const FAMILY_TABS: { id: FamilyFilter; label: string; hint: string }[] = [
  { id: 'todas', label: 'Todos', hint: 'Todos los archivos con algún problema' },
  { id: 'entrega', label: 'No se pueden usar', hint: 'No llegan, o llegan y no se pueden interpretar' },
  { id: 'contenido', label: 'Abren con errores', hint: 'Se pueden leer, pero los datos requieren limpieza' },
];

/**
 * Tono de la etiqueta de estado de cada fila.
 *
 * Las filas de contenido reutilizan el tono de `ok` —el archivo se entrega bien,
 * el problema está dentro— y por eso la clave se escoge en `rowTone`.
 */
const ROW_TONE: Record<DeliveryState, { text: string; surface: string; border: string }> = {
  roto: { text: 'text-bad', surface: 'bg-bad-surface', border: 'border-bad-line' },
  'no-entrega': { text: 'text-warn', surface: 'bg-warn-surface', border: 'border-warn-line' },
  omitida: { text: 'text-faint', surface: 'bg-fill', border: 'border-border' },
  // En tono informativo y no de aviso: el archivo puede estar perfectamente y lo
  // que falta es un lector nuestro. Pintarlo como advertencia era señalar al
  // publicador por algo que no ha hecho él.
  'no-analizado': { text: 'text-info', surface: 'bg-info-surface', border: 'border-info-line' },
  ok: { text: 'text-warn', surface: 'bg-warn-surface', border: 'border-warn-line' },
};

function rowTone(row: FileIssueRow) {
  return ROW_TONE[row.family === 'contenido' ? 'ok' : row.state];
}

/** Etiqueta corta de la fila: el estado de entrega, o «contenido» si abre. */
function rowStateLabel(row: FileIssueRow): string {
  return row.family === 'contenido' ? 'Contenido' : DELIVERY_SHORT[row.state];
}

/** Las columnas siguen a los rótulos de la tabla: `estado` pasó a ser `problema`. */
const CSV_HEADER = [
  'dimension', 'problema', 'formato', 'conjunto_de_datos', 'tematica', 'causa', 'codigo_causa',
  'errores_contenido', 'http', 'url', 'ficha',
];

function rowsToCsv(rows: FileIssueRow[]): string {
  return toCsv(
    CSV_HEADER,
    rows.map((r) => [
      r.family, rowStateLabel(r), r.format, r.datasetTitle, r.category,
      issueLabel(r.causeCode), r.causeCode, r.errorIssues ?? '', r.httpStatus ?? '', r.url,
      `/catalogo/${r.datasetSlug}/${r.distSlug}`,
    ])
  );
}

/**
 * Todos los ficheros con algún defecto, explorables en una sola tabla.
 *
 * Antes esta vista solo traía los que no se pueden usar, y los ~328 que abren con
 * errores de contenido vivían en una lista de alertas agrupada por dataset: no se
 * podían filtrar por causa, ni buscar, ni exportar. Ahora las dos familias
 * comparten tabla y se separan con un filtro, porque son dos trabajos distintos
 * —restablecer un enlace o limpiar una columna— sobre el mismo inventario.
 */
export function FicherosSection({
  rows, notes, byFormat, formatScores, filters,
}: FicherosSectionProps) {
  const [family, setFamily] = useState<FamilyFilter>(filters.familia);
  const [causes, setCauses] = useState<string[]>(filters.causas);
  const [format, setFormat] = useState<string>(filters.formato ?? '');
  const [category, setCategory] = useState<string>(filters.tematica ?? '');
  const [query, setQuery] = useState(filters.q ?? '');
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { todas: rows.length, entrega: 0, contenido: 0 };
    for (const r of rows) c[r.family]++;
    return c;
  }, [rows]);

  /**
   * Todo el filtrado MENOS la causa.
   *
   * Se separa porque la tira de causas se cuenta sobre esto y no sobre `rows`:
   * si los botones contaran el total, al estar en «Abren con errores» seguirían
   * ofreciendo causas de entrega —«Error de descarga»— que al pulsarlas dejan la
   * tabla vacía. Es la misma combinación imposible que `selectFamily` ya evita
   * al cambiar de pestaña.
   */
  const matchesBase = useCallback(
    (r: FileIssueRow) => {
      const needle = query.trim().toLowerCase();
      if (family !== 'todas' && r.family !== family) return false;
      if (format && r.format !== format) return false;
      if (category && r.category !== category) return false;
      if (needle && !`${r.datasetTitle} ${r.category} ${r.format} ${r.url}`.toLowerCase().includes(needle)) return false;
      return true;
    },
    [family, format, category, query]
  );

  const causeBase = useMemo(() => rows.filter(matchesBase), [rows, matchesBase]);

  const topCauses = useMemo(() => {
    const all = groupByCause(causeBase);
    const top = all.slice(0, TOP_CAUSES);
    // Una causa activa se pinta siempre, aunque caiga fuera del corte: si no, el
    // botón para quitarla desaparece justo cuando está en uso, y al llegar desde
    // un enlace con `?causa=` la tira no mostraría el filtro que está aplicado.
    for (const code of causes) {
      if (!top.some((c) => c.code === code)) {
        top.push(all.find((c) => c.code === code) ?? { code, affected: 0, datasets: 0 });
      }
    }
    return top;
  }, [causeBase, causes]);

  // `rowMatchesCauses` y no `r.causeCode === cause`: una fila puede traer varios
  // códigos de error, y filtrar solo por el primero escondía archivos que las
  // tarjetas de «Qué arreglar primero» sí cuentan.
  const filtered = useMemo(
    () => causeBase.filter((r) => rowMatchesCauses(r, causes)),
    [causeBase, causes]
  );

  const shown = filtered.slice(0, limit);
  const hasSubFilter =
    family !== 'todas' || causes.length > 0 || Boolean(format) || Boolean(category) || Boolean(query.trim());

  /**
   * Lo que hay que rehacer cada vez que cambia CUALQUIER filtro.
   *
   * Volver a la primera página y cerrar la fila desplegada: el detalle abierto
   * sobrevivía al cambio de filtro y podía quedar fuera de la lista resultante,
   * «abierto» sin nada que mostrar. Estaba repetido en unos manejadores y ausente
   * en otros, así que quitar un chip y cambiar de pestaña dejaban la tabla en
   * estados distintos.
   */
  const resetView = () => {
    setLimit(PAGE);
    setExpanded(null);
  };

  /**
   * Cambiar de familia limpia la causa.
   *
   * Sin esto, llegar con `?familia=entrega&causa=descarga` y pulsar «Abren con
   * errores» dejaba la causa puesta y la tabla salía vacía, con el chip de la
   * causa todavía visible: parecía que no había nada que ver cuando lo que había
   * era una combinación imposible. La condición conserva las causas al volver a
   * pulsar la pestaña que ya está activa.
   */
  const selectFamily = (next: FamilyFilter) => {
    setFamily(next);
    if (next !== family) setCauses([]);
    resetView();
  };

  const clearSubFilters = () => {
    setFamily('todas');
    setCauses([]);
    setFormat('');
    setCategory('');
    setQuery('');
    resetView();
  };

  if (rows.length === 0) {
    return (
      <Card tone="ok">
        <CardContent className="flex items-start gap-3 p-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-strong">Ningún archivo con problemas</h2>
            <p className="mt-1 text-sm text-body">
              Todos los archivos analizados se descargan, se abren y no traen errores de contenido.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <p className="max-w-4xl text-sm leading-relaxed text-faint">
        Inventario completo, archivo a archivo. Cada fila enlaza con su ficha, donde el explorador
        descarga el archivo real y permite recorrer las incidencias caso por caso. Las celdas vacías
        no generan fila propia —son la inmensa mayoría de las incidencias del catálogo y ahogarían la
        lista—: se revisan en la ficha de cada archivo.
      </p>

      {/* ── Filtro por familia: son dos trabajos distintos ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1" role="group" aria-label="Filtrar por dimensión de calidad">
          {FAMILY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectFamily(tab.id)}
              aria-pressed={family === tab.id}
              // La pista va en el nombre accesible y no en `title`: un tooltip
              // nativo no existe en táctil y no se anuncia al tabular.
              aria-label={`${tab.label}: ${tab.hint}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                family === tab.id ? 'bg-primary text-primary-fg' : 'text-body hover:bg-fill'
              )}
            >
              {tab.id === 'entrega' && <FileWarning className="h-3.5 w-3.5" aria-hidden />}
              {tab.id === 'contenido' && <SearchCode className="h-3.5 w-3.5" aria-hidden />}
              {tab.label}
              <span className="tabular-nums opacity-70">{counts[tab.id].toLocaleString('es-ES')}</span>
            </button>
          ))}
        </div>

        {/* La pista del filtro activo, visible: hasta ahora solo existía como
            tooltip, así que la diferencia entre las dos familias —que es la
            distinción central de esta vista— no se leía en pantalla. */}
        <p className="order-last w-full text-xs text-faint" aria-live="polite">
          {FAMILY_TABS.find((tab) => tab.id === family)?.hint}
        </p>

        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); resetView(); }}
            placeholder="Filtrar por conjunto de datos, temática o URL…"
            aria-label="Filtrar la lista de archivos"
            className="h-9 w-full rounded-lg border border-field bg-card pl-8 pr-3 text-xs text-body placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          />
        </div>

        {/* El CSV se genera al pulsar, respetando los filtros activos. */}
        <DownloadButton
          content={() => rowsToCsv(filtered)}
          filename="archivos-con-problemas.csv"
          mimeType="text/csv;charset=utf-8"
          label={`Descargar CSV (${filtered.length.toLocaleString('es-ES')})`}
        />
      </div>

      {/* ── Causas más frecuentes ────────────────────────────────────────────
          Aquí había una tira de temáticas. El filtro por causa existía desde
          siempre —los chips lo muestran y la URL lo transporta— pero no tenía
          ningún selector: solo se llegaba a él desde un enlace de la portada o
          de «Qué arreglar primero», así que desde esta vista era invisible. La
          temática, en cambio, sigue alcanzable desde el buscador de texto, que
          ya la incluye, y desde `?tematica=`.

          Es un filtro de selección múltiple porque `causas` siempre fue una
          lista: hay fallos que rompen la reutilización por el mismo motivo
          —encabezado vacío y encabezado duplicado— y conviene poder verlos
          juntos. */}
      {topCauses.length > 1 && (
        <section>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-strong">
            <ListFilter className="h-4 w-4 text-faint" aria-hidden />
            Causas más frecuentes
          </h2>
          {/* La advertencia no es un tecnicismo: un archivo con el encabezado
              vacío Y duplicado suma en los dos botones, así que sumarlos da más
              que el total de filas. Sin decirlo, las cifras parecen no cuadrar. */}
          <p className="mb-3 text-xs text-faint">
            Archivos afectados por cada causa. Un archivo con varios fallos cuenta en cada uno, así
            que las cifras no suman el total de la tabla.
          </p>
          <div className="flex flex-wrap gap-2">
            {topCauses.map((c) => {
              const isActive = causes.includes(c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => {
                    setCauses(isActive ? causes.filter((x) => x !== c.code) : [...causes, c.code]);
                    resetView();
                  }}
                  aria-pressed={isActive}
                  aria-label={
                    isActive
                      ? `Quitar el filtro por causa: ${issueLabel(c.code)}`
                      : `Filtrar por causa: ${issueLabel(c.code)}, ${c.affected} archivos afectados`
                  }
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                    isActive
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-border bg-card text-body hover:border-border-strong hover:bg-fill'
                  )}
                >
                  <span className="max-w-[28ch] truncate">{issueLabel(c.code)}</span>
                  <span className={cn('tabular-nums', isActive ? 'opacity-80' : 'text-faint')}>
                    {c.affected.toLocaleString('es-ES')}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Tabla ── */}
      <section>
        {/* La tira de filtros activos.
            Tiene que enseñarlos TODOS. Pintaba solo la causa y la temática, y por
            eso una tarjeta que prometía «32 archivos GML» podía llevar a una tabla
            con los 179 errores de descarga del catálogo sin que se notara: el
            formato no estaba ni en el filtro ni en los chips, así que no había
            nada que delatara la diferencia. */}
        {hasSubFilter && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-faint">
              Mostrando {filtered.length.toLocaleString('es-ES')} de {rows.length.toLocaleString('es-ES')}
            </span>
            {family !== 'todas' && (
              <button
                type="button"
                onClick={() => selectFamily('todas')}
                aria-label={chipLabel('por dimensión', FAMILY_TABS.find((t) => t.id === family)?.label ?? family)}
                className={CHIP}
              >
                {FAMILY_TABS.find((t) => t.id === family)?.label}
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            {causes.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => { setCauses(causes.filter((c) => c !== code)); resetView(); }}
                aria-label={chipLabel('por causa', issueLabel(code))}
                className={CHIP}
              >
                causa: {issueLabel(code)}
                <X className="h-3 w-3" aria-hidden />
              </button>
            ))}
            {format && (
              <button
                type="button"
                onClick={() => { setFormat(''); resetView(); }}
                aria-label={chipLabel('por formato', format)}
                className={CHIP}
              >
                formato: {format}
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            {category && (
              <button
                type="button"
                onClick={() => { setCategory(''); resetView(); }}
                aria-label={chipLabel('por temática', category)}
                className={CHIP}
              >
                temática: {category}
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            {query.trim() && (
              <button
                type="button"
                onClick={() => { setQuery(''); resetView(); }}
                aria-label={chipLabel('de texto', query.trim())}
                className={CHIP}
              >
                texto: {query.trim()}
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            <button onClick={clearSubFilters} className="font-medium text-link underline-offset-2 hover:underline">
              Quitar filtros
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <Card tone="muted">
            <CardContent className="p-6 text-center text-sm text-faint">
              Ningún archivo coincide con estos filtros.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">Archivos con problemas de disponibilidad o de contenido</caption>
              <thead>
                <tr className="border-b border-border bg-fill text-left">
                  {/* «Problema» y «Causa», no «Estado» y «Qué le pasa»: los dos
                      rótulos viejos sonaban a lo mismo y no dejaban ver que son
                      ejes distintos —si el archivo sirve o no, y por qué—.
                      «Causa» además es la palabra que ya usan los chips del
                      filtro y la tira de causas de arriba. */}
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Problema</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Formato</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Conjunto de datos</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold text-faint lg:table-cell">Temática</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Causa</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const id = `${r.datasetSlug}-${r.distSlug}-${r.family}`;
                  const tone = rowTone(r);
                  const isOpen = expanded === id;
                  return (
                    <tr key={id} className="border-b border-border last:border-0 align-top hover:bg-fill">
                      <td className="px-3 py-2">
                        <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', tone.border, tone.surface, tone.text)}>
                          {r.family === 'contenido'
                            ? <SearchCode className="h-3 w-3" aria-hidden />
                            : <FileWarning className="h-3 w-3" aria-hidden />}
                          {rowStateLabel(r)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="format" className="text-[11px]">{r.format}</Badge>
                      </td>
                      <td className="max-w-[26rem] px-3 py-2">
                        <Link
                          href={`/catalogo/${r.datasetSlug}/${r.distSlug}`}
                          className="line-clamp-2 font-medium text-body underline-offset-2 hover:text-link hover:underline"
                        >
                          {r.datasetTitle}
                        </Link>
                        <p className="mt-0.5 truncate text-[11px] text-faint lg:hidden">{r.category}</p>
                      </td>
                      <td className="hidden max-w-[16rem] px-3 py-2 text-faint lg:table-cell">
                        <span className="line-clamp-2">{r.category}</span>
                      </td>
                      <td className="max-w-[18rem] px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : id)}
                          aria-expanded={isOpen}
                          aria-controls={`detalle-${id}`}
                          className="flex items-start gap-1 text-left text-body hover:text-strong"
                        >
                          {isOpen
                            ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-faint" aria-hidden />
                            : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-faint" aria-hidden />}
                          <span>
                            {issueLabel(r.causeCode)}
                            {r.httpStatus ? <span className="ml-1 text-faint">HTTP {r.httpStatus}</span> : null}
                            {r.errorIssues != null && r.errorIssues > 1 && (
                              <span className="ml-1 text-faint">
                                y {(r.errorIssues - 1).toLocaleString('es-ES')} más
                              </span>
                            )}
                          </span>
                        </button>
                        {isOpen && (
                          <div id={`detalle-${id}`} className="mt-2 space-y-1.5 rounded-md border border-border bg-card p-2">
                            <p className="text-[11px] leading-relaxed text-body">
                              {r.family === 'contenido'
                                ? 'El archivo se descarga y se abre; el problema está en los datos. Se puede reutilizar, pero obliga a limpiar antes.'
                                : DELIVERY_EXPLANATIONS[r.state as Exclude<typeof r.state, 'ok'>]}
                            </p>
                            {r.noteIdx != null && notes[r.noteIdx] && (
                              <p className="text-[11px] leading-relaxed text-faint">{notes[r.noteIdx]}</p>
                            )}
                            <p className="break-all font-mono text-[11px] text-faint">{r.url}</p>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded p-1 text-faint transition-colors hover:bg-fill hover:text-body"
                          aria-label={`Abrir el archivo original de ${r.datasetTitle}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filtered.length > shown.length && (
              <div className="border-t border-border bg-fill p-3 text-center">
                <button
                  onClick={() => setLimit((n) => n + PAGE)}
                  className="rounded-lg border border-field bg-card px-3 py-1.5 text-xs font-medium text-body transition-colors hover:bg-fill"
                >
                  Mostrar {Math.min(PAGE, filtered.length - shown.length)} más
                  <span className="ml-1 text-faint">
                    ({(filtered.length - shown.length).toLocaleString('es-ES')} restantes)
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Resultados por formato, plegado ── */}
      {byFormat.length > 0 && (
        <details className="rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 text-sm font-semibold text-strong">
            <Table2 className="h-4 w-4 text-faint" aria-hidden />
            Resultados por formato
            <span className="text-[11px] font-normal text-faint">({byFormat.length} formatos)</span>
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-faint">
                  <th scope="col" className="px-5 py-2 font-medium">Formato</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Archivos</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Sin incidencias</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Con alguna incidencia</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Sin analizar</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Calidad media</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Descargado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byFormat.map(([fmt, f]) => {
                  const score = formatScores[fmt];
                  const isActive = format === fmt;
                  return (
                  /* Estas filas ahora filtran la tabla de arriba. Eran `<tr>`
                     inertes: la única vista del portal que desglosaba por formato
                     no podía llevarte a los archivos de ese formato.
                     El disparador es un `<button>` dentro de la celda y no un
                     `onClick` en el `<tr>`: una fila entera clicable no se alcanza
                     con el teclado ni se anuncia como accionable. */
                  <tr key={fmt} className={isActive ? 'bg-fill-strong' : 'hover:bg-fill'}>
                    <td className="px-5 py-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setFormat(isActive ? '' : fmt);
                          resetView();
                        }}
                        aria-pressed={isActive}
                        aria-label={
                          isActive
                            ? `Quitar el filtro por formato ${fmt}`
                            : `Ver solo los archivos ${fmt} en la tabla de arriba`
                        }
                        className="inline-flex items-center gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                      >
                        <Badge variant="format">{fmt}</Badge>
                        {isGeoFormat(fmt) && <span className="text-[11px] text-faint">geo</span>}
                        {isActive && <span className="text-[11px] text-link">filtrando</span>}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-body">{f.total}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ok">{f.ok}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-warn">{f.error}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-faint">{f.skipped}</td>
                    {/* De `formatScores` y no de `f.avg_score`: ese venía con los
                        ceros de los archivos que no se pudieron ni abrir. Un
                        formato sin ningún archivo legible dice «—», no «0 %». */}
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-body">
                      {score?.avgScore != null ? `${score.avgScore}%` : '—'}
                      {score != null && score.scored < f.total && (
                        <span className="ml-1 text-[11px] font-normal text-faint">
                          ({score.scored}/{f.total})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-faint">{formatBytes(f.bytes)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {/* «Con alguna incidencia» agrupa cosas de gravedad muy distinta, así
                que la tabla necesita esta aclaración. Los rótulos evitan a
                propósito «errores» y «omitidas», que sugieren archivos
                inutilizables cuando la mayoría solo necesita limpieza. */}
            <p className="px-5 py-3 text-[11px] leading-relaxed text-faint">
              «Con alguna incidencia» cuenta los archivos en los que el análisis anotó algo, incluidos
              los que se descargan y abren sin problema y solo necesitan limpieza. Para ver cuáles no
              se pueden usar, filtra arriba por «No se pueden usar». La calidad media se calcula solo
              sobre los archivos que se descargan y abren, y entre paréntesis va cuántos son de cada
              formato: un formato del que no se ha podido leer ninguno dice «—», no cero.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
