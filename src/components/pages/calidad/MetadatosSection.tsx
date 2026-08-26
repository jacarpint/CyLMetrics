'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Info, Scale, Tags, Wrench,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { DownloadButton } from '@/components/ui/download-button';
import { cn } from '@/lib/utils';
import { toCsv } from '@/lib/csv-write';
import { METADATA_GAPS, type MetadataGapCode } from '@/lib/metadata-gaps';
import { buildQualityUrl } from '@/lib/quality-filters';

/** Lo mínimo de cada dataset que necesita esta vista. */
export interface MetadataDatasetLite {
  slug: string;
  title: string;
  /** Periodos declarados transcurridos, cuando se ha podido medir. */
  periodsLate?: number | null;
  /** Periodicidad declarada, en texto ya resuelto en servidor. */
  periodicity?: string;
}

export interface MetadataGapGroup {
  code: MetadataGapCode;
  datasets: MetadataDatasetLite[];
}

interface MetadatosSectionProps {
  totalDatasets: number;
  /** Un grupo por campo pendiente, ya ordenados de mayor a menor. */
  groups: MetadataGapGroup[];
  /** Conjuntos con retraso demostrable: publican dct:modified y lo han pasado. */
  overdue: MetadataDatasetLite[];
  /** Campo pendiente preseleccionado al llegar desde un enlace de Prioridades. */
  initialGap?: string;
}

/** Cuántos datasets se listan antes de plegar el resto. */
const VISIBLE_DATASETS = 12;

const AXIS_STYLE = {
  completitud: { label: 'Completitud', className: 'border-info-line bg-info-surface text-info' },
  actualidad: { label: 'Actualidad', className: 'border-warn-line bg-warn-surface text-warn' },
  apertura: { label: 'Apertura', className: 'border-ok-line bg-ok-surface text-ok' },
  recomendacion: { label: 'Recomendación', className: 'border-border bg-fill text-faint' },
} as const;

const CSV_HEADER = [
  'campo_pendiente', 'campo_dcat', 'conjunto_de_datos', 'ficha', 'periodicidad',
  'periodos_transcurridos',
];

function gapsToCsv(rows: MetadataDatasetLite[], code: string): string {
  // `code` puede ser un pseudocódigo de vista («vencidos»), que no está en la
  // tabla de huecos: en ese caso se escribe tal cual y sin campo DCAT.
  const info = METADATA_GAPS[code as MetadataGapCode];
  return toCsv(
    CSV_HEADER,
    rows.map((r) => [
      info?.label ?? code, info?.field ?? '', r.title, `/catalogo/${r.slug}`,
      r.periodicity ?? '', r.periodsLate ?? '',
    ])
  );
}

/**
 * Los campos pendientes de la ficha, como lista de tareas.
 *
 * Un porcentaje de metadatos no se puede corregir; una lista de campos con el
 * nombre del elemento y los conjuntos afectados, sí. Por eso esta vista desglosa
 * lo que `computeQuality` resume en una cifra.
 */
export function MetadatosSection({
  totalDatasets, groups: allGroups, overdue: allOverdue, initialGap = '',
}: MetadatosSectionProps) {
  /**
   * Con `?hueco=`, esta vista enseña SOLO ese campo pendiente.
   *
   * Antes el parámetro únicamente desplegaba la lista de la tarjeta que le
   * correspondía y dejaba las otras doce a la vista. Quien llegaba desde «Ver los
   * conjuntos de datos afectados» aterrizaba en la página entera y tenía que
   * localizar a mano cuál de las tarjetas era la suya, que es el mismo problema
   * que tenían los enlaces de la tabla de archivos.
   */
  const gapFilter = allGroups.some((g) => g.code === initialGap) ? initialGap : '';
  const groups = gapFilter ? allGroups.filter((g) => g.code === gapFilter) : allGroups;
  // Los vencidos son una tarjeta aparte y no un hueco: solo se enseñan sin filtro.
  const overdue = gapFilter ? [] : allOverdue;

  const byAxis = useMemo(() => {
    const out = {
      actualidad: [] as MetadataGapGroup[],
      completitud: [] as MetadataGapGroup[],
      apertura: [] as MetadataGapGroup[],
      recomendacion: [] as MetadataGapGroup[],
    };
    for (const g of groups) out[METADATA_GAPS[g.code].axis].push(g);
    return out;
  }, [groups]);

  const unverifiable = groups.find((g) => g.code === 'sin-fecha-actualizacion');
  /* «No se puede verificar» tiene tarjeta propia arriba, junto a los vencidos de
     verdad, así que no se repite en la rejilla del resto del eje. */
  const otherFreshnessGaps = byAxis.actualidad.filter((g) => g.code !== 'sin-fecha-actualizacion');

  if (groups.length === 0) {
    return (
      <Card tone="ok">
        <CardContent className="flex items-start gap-3 p-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-strong">Fichas completas</h2>
            <p className="mt-1 text-sm text-body">
              Los {totalDatasets.toLocaleString('es-ES')} conjuntos de datos del catálogo declaran
              todos los campos que evalúa el portal.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <p className="max-w-4xl text-sm leading-relaxed text-faint">
        Lo que falta en la ficha de cada conjunto de datos. Son las correcciones más baratas del
        catálogo —se editan en el gestor de metadatos, sin tocar los datos— y las que más rinden: un
        campo bien puesto mejora a la vez la búsqueda, la puntuación y la recogida automática por
        parte de datos.gob.es.
      </p>

      {/* Sin esto la vista filtrada sería un callejón: se enseña un solo campo y
          no hay forma de volver al resto sin editar la URL a mano. */}
      {gapFilter && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-faint">Mostrando un solo campo pendiente</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-fill px-2 py-0.5 text-body">
            campo: {METADATA_GAPS[gapFilter as MetadataGapCode].label}
          </span>
          <Link
            href={buildQualityUrl({ vista: 'metadatos' })}
            className="font-medium text-link underline-offset-2 hover:underline"
          >
            Ver todos los campos pendientes
          </Link>
        </div>
      )}

      {/* ── Actualidad ───────────────────────────────────────────────────────
          Un retraso aparente y un retraso demostrado se separan a propósito.
          Medir desde la fecha de publicación cuando falta la de actualización
          hace que un conjunto que se refresca a diario figure con siglos de
          retraso: eso no es un dato viejo, es un metadato que falta. */}
      <section>
        <h2 className="flex items-center gap-2 text-base font-semibold text-strong">
          <CalendarClock className="h-4 w-4 text-faint" aria-hidden />
          Actualidad
        </h2>
        <p className="mt-1 max-w-4xl text-sm text-faint">
          La actualidad pesa un 25% en la puntuación de metadatos. Hay dos situaciones distintas y
          se corrigen de forma distinta: una es un metadato que falta, la otra es un dato que no se
          ha actualizado.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {unverifiable && unverifiable.datasets.length > 0 && (
            <GapCard
              code="sin-fecha-actualizacion"
              datasets={unverifiable.datasets}
              total={totalDatasets}
              defaultOpen={initialGap === 'sin-fecha-actualizacion'}
              headline="No se puede verificar"
            />
          )}

          {overdue.length > 0 && (
            <Card tone="bad">
              <CardContent>
                <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', AXIS_STYLE.actualidad.className)}>
                  Actualidad
                </span>
                <p className="mt-2.5 text-3xl font-bold tabular-nums text-bad">
                  {overdue.length.toLocaleString('es-ES')}
                </p>
                <h3 className="mt-1 text-sm font-semibold text-strong">
                  Conjuntos vencidos de verdad
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-body">
                  Declaran su fecha de última actualización y ha pasado más de un periodo desde
                  entonces. Aquí el retraso está demostrado: no es un metadato que falte, es el dato
                  que no se ha refrescado.
                </p>
                <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed text-body">
                  <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                  <span>Actualizar los datos, o corregir la periodicidad si ya no aplica.</span>
                </p>
                <DatasetList datasets={overdue} code="vencidos" showPeriods />
              </CardContent>
            </Card>
          )}
        </div>

        {otherFreshnessGaps.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {otherFreshnessGaps.map((g) => (
              <GapCard
                key={g.code}
                code={g.code}
                datasets={g.datasets}
                total={totalDatasets}
                defaultOpen={initialGap === g.code}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Completitud ── */}
      {byAxis.completitud.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-base font-semibold text-strong">
            <Tags className="h-4 w-4 text-faint" aria-hidden />
            Campos que faltan
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-faint">
            Entran en el 40% de completitud de la puntuación de metadatos.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {byAxis.completitud.map((g) => (
              <GapCard
                key={g.code}
                code={g.code}
                datasets={g.datasets}
                total={totalDatasets}
                defaultOpen={initialGap === g.code}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Apertura ── */}
      {byAxis.apertura.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-base font-semibold text-strong">
            <Scale className="h-4 w-4 text-faint" aria-hidden />
            Apertura
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-faint">
            Condiciones que no impiden publicar el dato, pero sí que alguien lo reutilice.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {byAxis.apertura.map((g) => (
              <GapCard
                key={g.code}
                code={g.code}
                datasets={g.datasets}
                total={totalDatasets}
                defaultOpen={initialGap === g.code}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Recomendaciones DCAT-AP, sin puntuar ── */}
      {byAxis.recomendacion.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-base font-semibold text-strong">
            <Info className="h-4 w-4 text-faint" aria-hidden />
            Recomendaciones DCAT-AP
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-faint">
            No entran en la puntuación y no afectan a ninguna cifra del portal. Se listan porque
            DCAT-AP las recomienda y en el catálogo apenas se publican.{" "}
            {/* Derivado y no escrito a mano: en cuanto un solo conjunto declare
                `dct:identifier`, la frase se ajusta en vez de contradecir el
                recuento de la tarjeta de al lado. */}
            {byAxis.recomendacion.every((g) => g.datasets.length === totalDatasets)
              ? "Ahora mismo no las declara ninguno."
              : "Los recuentos de cada tarjeta dicen a cuántos les falta."}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {byAxis.recomendacion.map((g) => (
              <GapCard
                key={g.code}
                code={g.code}
                datasets={g.datasets}
                total={totalDatasets}
                defaultOpen={initialGap === g.code}
                muted
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function GapCard({
  code, datasets, total, defaultOpen, headline, muted,
}: {
  code: MetadataGapCode;
  datasets: MetadataDatasetLite[];
  total: number;
  defaultOpen?: boolean;
  /** Titular alternativo cuando el contexto ya dice de qué va. */
  headline?: string;
  muted?: boolean;
}) {
  const info = METADATA_GAPS[code];
  const axis = AXIS_STYLE[info.axis];
  const pct = total > 0 ? Math.round((datasets.length / total) * 100) : 0;

  return (
    <Card tone={muted ? 'muted' : info.axis === 'actualidad' ? 'warn' : 'default'}>
      <CardContent>
        <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', axis.className)}>
          {axis.label}
        </span>

        <p className={cn('mt-2.5 text-3xl font-bold tabular-nums', muted ? 'text-faint' : info.axis === 'actualidad' ? 'text-warn' : 'text-strong')}>
          {datasets.length.toLocaleString('es-ES')}
        </p>
        <p className="text-xs text-faint">
          de {total.toLocaleString('es-ES')} conjuntos de datos · {pct}%
        </p>

        {/* El nombre del elemento va en una línea propia y rotulada, no dentro
            del título: quien publica lo necesita para saber dónde tocar, y para
            el resto es ruido en el encabezado. */}
        <h3 className="mt-2 text-sm font-semibold text-strong">{headline ?? info.label}</h3>
        <p className="mt-0.5 text-xs text-faint">
          Campo del catálogo:{' '}
          <code className="font-mono text-body">{info.field}</code>
        </p>

        <p className="mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed text-body">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          <span>{info.why}</span>
        </p>

        <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed text-body">
          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          <span>{info.action}</span>
        </p>

        <DatasetList datasets={datasets} code={code} defaultOpen={defaultOpen} />
      </CardContent>
    </Card>
  );
}

/** Lista plegable de datasets afectados, con su CSV. */
function DatasetList({
  datasets, code, defaultOpen, showPeriods,
}: {
  datasets: MetadataDatasetLite[];
  code: string;
  defaultOpen?: boolean;
  showPeriods?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [limit, setLimit] = useState(VISIBLE_DATASETS);
  const shown = datasets.slice(0, limit);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs font-medium text-link underline-offset-2 hover:underline"
        >
          {open
            ? <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          {open ? 'Ocultar' : 'Ver'} los conjuntos de datos afectados
        </button>
        <DownloadButton
          content={() => gapsToCsv(datasets, code)}
          filename={`metadatos-${code}.csv`}
          mimeType="text/csv;charset=utf-8"
          label="CSV"
          className="ml-auto"
        />
      </div>

      {open && (
        <>
          <ul className="mt-2.5 space-y-1">
            {shown.map((d) => (
              <li key={d.slug} className="flex items-baseline justify-between gap-2 text-xs">
                <Link
                  href={`/catalogo/${d.slug}`}
                  className="min-w-0 flex-1 truncate text-body underline-offset-2 hover:text-link hover:underline"
                >
                  {d.title}
                </Link>
                {/* Se leía «×2,5 (mensual)». El símbolo de multiplicar no dice
                    qué se multiplica: fuera de quien escribió el cálculo, nadie
                    puede saber que son periodos de retraso. Ahora lo dice. */}
                {showPeriods && d.periodsLate != null && (
                  <span className="shrink-0 text-faint">
                    <span className="tabular-nums">
                      {d.periodsLate.toLocaleString('es-ES', { maximumFractionDigits: 1 })}
                    </span>{' '}
                    {d.periodsLate === 1 ? 'periodo' : 'periodos'} de retraso
                    {d.periodicity ? ` · ${d.periodicity}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {datasets.length > shown.length && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + VISIBLE_DATASETS * 4)}
              className="mt-2 text-xs font-medium text-link underline-offset-2 hover:underline"
            >
              Mostrar más ({(datasets.length - shown.length).toLocaleString('es-ES')} restantes)
            </button>
          )}
        </>
      )}
    </div>
  );
}
