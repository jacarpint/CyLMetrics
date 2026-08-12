'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Info, Scale, Tags, Wrench,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { DownloadButton } from '@/components/ui/download-button';
import { cn } from '@/lib/utils';
import { METADATA_GAPS, type MetadataGapCode } from '@/lib/metadata-gaps';

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
  /** Un grupo por hueco, ya ordenados de mayor a menor. */
  groups: MetadataGapGroup[];
  /** Datasets con retraso demostrable: publican dct:modified y lo han pasado. */
  overdue: MetadataDatasetLite[];
  /** Hueco preseleccionado al llegar desde un enlace de Prioridades. */
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

function toCsv(rows: MetadataDatasetLite[], code: string): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['hueco', 'campo_dcat', 'dataset', 'ficha', 'periodicidad', 'periodos_transcurridos'];
  const info = METADATA_GAPS[code as MetadataGapCode];
  const lines = rows.map((r) =>
    [
      info?.label ?? code, info?.field ?? '', r.title, `/catalogo/${r.slug}`,
      r.periodicity ?? '', r.periodsLate ?? '',
    ].map(esc).join(';')
  );
  return `﻿${header.join(';')}\n${lines.join('\n')}`;
}

/**
 * Los huecos de la ficha DCAT, como lista de tareas.
 *
 * Esto no existía. `computeQuality` calculaba la completitud y la actualidad y
 * devolvía el desglose sin que nadie lo consumiera, así que un publicador veía
 * «metadatos 78%» y no tenía forma de saber qué campo le faltaba ni por qué
 * perdía puntos de actualidad.
 */
export function MetadatosSection({
  totalDatasets, groups, overdue, initialGap = '',
}: MetadatosSectionProps) {
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

  if (groups.length === 0) {
    return (
      <Card tone="ok">
        <CardContent className="flex items-start gap-3 p-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-strong">Fichas completas</h2>
            <p className="mt-1 text-sm text-body">
              Los {totalDatasets.toLocaleString('es-ES')} datasets del catálogo declaran todos los
              campos que evalúa el portal.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm leading-relaxed text-faint">
        Lo que falta en la ficha DCAT de cada dataset. Son las correcciones más baratas del catálogo
        —se editan en el gestor de metadatos, sin tocar los datos— y las que más rinden: un campo
        bien puesto mejora a la vez la búsqueda, la puntuación y la recolección por parte de
        datos.gob.es.
      </p>

      {/* ── Actualidad: la separación que importa ────────────────────────────
          Un retraso aparente y un retraso demostrado no son lo mismo, y hasta
          ahora el portal no distinguía: medía desde la fecha de PUBLICACIÓN
          cuando no había fecha de actualización, así que un dataset que se
          refresca a diario podía figurar con siglos de retraso. */}
      <section>
        <h2 className="flex items-center gap-2 text-base font-semibold text-strong">
          <CalendarClock className="h-4 w-4 text-faint" aria-hidden />
          Actualidad
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-faint">
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
              <CardContent className="p-5">
                <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', AXIS_STYLE.actualidad.className)}>
                  Actualidad
                </span>
                <p className="mt-2.5 text-3xl font-bold tabular-nums text-bad">
                  {overdue.length.toLocaleString('es-ES')}
                </p>
                <h3 className="mt-1 text-sm font-semibold text-strong">
                  Datasets vencidos de verdad
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-body">
                  Publican <code className="font-mono text-xs">dct:modified</code> y ha pasado más
                  de un periodo declarado desde esa fecha. Aquí el retraso está demostrado: no es un
                  metadato que falte, es el dato que no se ha refrescado.
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

        {byAxis.actualidad.filter((g) => g.code !== 'sin-fecha-actualizacion').length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {byAxis.actualidad
              .filter((g) => g.code !== 'sin-fecha-actualizacion')
              .map((g) => (
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
          <p className="mt-1 max-w-3xl text-sm text-faint">
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

      {/* ── Apertura, ahora accionable ───────────────────────────────────────
          El Panel decía «45% con CC-BY». Un porcentaje no se puede corregir;
          una lista de datasets, sí. */}
      {byAxis.apertura.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-base font-semibold text-strong">
            <Scale className="h-4 w-4 text-faint" aria-hidden />
            Apertura
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-faint">
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
          <p className="mt-1 max-w-3xl text-sm text-faint">
            No entran en la puntuación y no afectan a ninguna cifra del portal. Se listan porque
            DCAT-AP las recomienda y hoy no las publica ningún dataset del catálogo.
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
      <CardContent className="p-5">
        <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', axis.className)}>
          {axis.label}
        </span>

        <p className={cn('mt-2.5 text-3xl font-bold tabular-nums', muted ? 'text-faint' : info.axis === 'actualidad' ? 'text-warn' : 'text-strong')}>
          {datasets.length.toLocaleString('es-ES')}
        </p>
        <p className="text-xs text-faint">
          de {total.toLocaleString('es-ES')} datasets · {pct}%
        </p>

        <h3 className="mt-2 text-sm font-semibold text-strong">
          {headline ?? info.label}{' '}
          <code className="font-mono text-xs font-normal text-faint">{info.field}</code>
        </h3>

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
          {open ? 'Ocultar' : 'Ver'} los datasets afectados
        </button>
        <DownloadButton
          content={() => toCsv(datasets, code)}
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
                {showPeriods && d.periodsLate != null && (
                  <span className="shrink-0 tabular-nums text-faint">
                    ×{d.periodsLate.toLocaleString('es-ES', { maximumFractionDigits: 1 })}{' '}
                    {d.periodicity ? <span className="text-faint">({d.periodicity})</span> : null}
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
