"use client";

import { Columns3 } from "lucide-react";
import type { SchemaField } from "@/lib/quality-report";
import { schemaTypeLabel } from "@/lib/quality-labels";
import { unitWords, capitalize, type UnitVoice } from "@/lib/unit-words";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const TYPE_BADGE: Record<string, "default" | "success" | "warning" | "destructive" | "info" | "format"> = {
  number: "info",
  date: "warning",
  boolean: "success",
  string: "default",
  unknown: "default",
};

function formatRange(field: SchemaField): string {
  if (field.min == null && field.max == null) return "—";
  const min = typeof field.min === "number" ? field.min.toLocaleString("es-ES") : field.min;
  const max = typeof field.max === "number" ? field.max.toLocaleString("es-ES") : field.max;
  if (min === max) return `${min}`;
  return `${min ?? "…"} … ${max ?? "…"}`;
}

export function SchemaTable({ schema, unit = "table" }: { schema: SchemaField[]; unit?: UnitVoice }) {
  const words = unitWords(unit);
  const nullPctTotal = schema.reduce((s, f) => s + (f.null_pct || 0), 0) / Math.max(1, schema.length);
  const completeness = Math.round((1 - nullPctTotal) * 100);

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-fill px-3 py-2">
          <p className="eyebrow">{capitalize(words.cols)}</p>
          <p className="text-lg font-bold tabular-nums text-strong">{schema.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-fill px-3 py-2">
          <p className="eyebrow">Completitud</p>
          <p className="text-lg font-bold tabular-nums text-strong">{completeness}%</p>
        </div>
        <div className="col-span-2 rounded-lg border border-border bg-fill px-3 py-2">
          <p className="eyebrow mb-1.5">Valores no nulos</p>
          <Progress
            value={completeness}
            indicatorClassName="bg-ok-solid"
            className="h-1.5"
            label={`Completitud del esquema: ${completeness}% de valores no nulos`}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-fill text-left">
              <th scope="col" className="px-3 py-2 font-semibold text-faint">{capitalize(words.col)}</th>
              <th scope="col" className="px-3 py-2 font-semibold text-faint">Tipo</th>
              <th scope="col" className="px-3 py-2 font-semibold text-faint">Nulos</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold text-faint">Distintos</th>
              <th scope="col" className="px-3 py-2 font-semibold text-faint">Rango</th>
            </tr>
          </thead>
          <tbody>
            {schema.map((field, idx) => {
              const pct = Math.round((field.null_pct || 0) * 100);
              return (
                // La clave lleva la POSICIÓN, no solo el nombre.
                //
                // Los nombres de columna repetidos no son una rareza teórica en
                // este catálogo: son un defecto que este mismo portal detecta y
                // publica (`encabezado-duplicado`). Hay 29 distribuciones con
                // columnas homónimas —una con 28 repeticiones, y otra con
                // «Localidad» tres veces—, y con `key={field.name}` React recibe
                // claves duplicadas justo en las fichas de esos archivos, que son
                // las que más falta hace leer bien.
                <tr
                  key={`${idx}-${field.name}`}
                  className="border-b border-border last:border-0 hover:bg-fill"
                >
                  <th
                    scope="row"
                    className="max-w-[16rem] truncate px-3 py-2 text-left font-mono font-normal text-strong"
                    title={field.name}
                  >
                    {field.name}
                  </th>
                  <td className="px-3 py-2">
                    <Badge variant={TYPE_BADGE[field.type] ?? "default"} className="text-[11px]">
                      {schemaTypeLabel(field.type)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Progress
                        value={pct}
                        indicatorClassName={pct === 0 ? "bg-ok-solid" : pct < 20 ? "bg-warn-solid" : "bg-bad-solid"}
                        className="h-1 w-16"
                      />
                      <span className="tabular-nums text-faint">
                        {field.null_count.toLocaleString("es-ES")}
                        <span className="sr-only"> nulos ({pct}%)</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-body">
                    {field.distinct.toLocaleString("es-ES")}
                  </td>
                  <td className="px-3 py-2 font-mono text-faint">{formatRange(field)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SchemaExplorer({
  schema,
  unit = "table",
  truncated = false,
}: {
  schema: SchemaField[];
  unit?: UnitVoice;
  /** La descarga se cortó por tamaño: las cifras son de la parte analizada. */
  truncated?: boolean;
}) {
  if (schema.length === 0) {
    return (
      <p className="text-sm text-faint">
        Sin esquema disponible: el recurso no tiene datos tabulares analizables.
      </p>
    );
  }

  return (
    <section>
      <h3 className="eyebrow mb-3 flex items-center gap-1.5">
        <Columns3 className="h-3.5 w-3.5" aria-hidden />
        {truncated ? "Esquema inferido (sobre la parte descargada)" : "Esquema inferido"}
      </h3>
      <SchemaTable schema={schema} unit={unit} />
      {truncated && (
        <p className="mt-2 text-xs text-warn">
          El archivo supera el tope de descarga del analizador, así que nulos, valores distintos y
          rangos corresponden solo a la parte que se pudo leer.
        </p>
      )}
    </section>
  );
}
