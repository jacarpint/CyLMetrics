'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy, Check, ChevronRight, Search, FoldVertical, UnfoldVertical, Link2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** Hijos que se pintan de golpe en un nodo; el resto se revela bajo demanda. */
const CHUNK = 100;
/** Tope de nodos visitados al buscar, para no colgar el hilo en ficheros enormes. */
const SEARCH_VISIT_CAP = 60_000;
/** Líneas que se muestran en modo crudo. */
const RAW_LINE_CAP = 3000;

type Json = unknown;
type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

function typeOf(v: Json): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as JsonType;
}

function isBranch(v: Json): v is Record<string, Json> | Json[] {
  const t = typeOf(v);
  return t === 'object' || t === 'array';
}

function entriesOf(v: Json): [string, Json][] {
  return Array.isArray(v)
    ? v.map((item, i) => [String(i), item] as [string, Json])
    : Object.entries(v as Record<string, Json>);
}

/** Ruta legible tipo `[3].direccion.calle`, la que se copia al portapapeles. */
function childPath(parent: string, key: string, parentIsArray: boolean): string {
  if (parentIsArray) return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

/* ── Búsqueda ─────────────────────────────────────────────────────────────
   Devuelve las rutas que coinciden y todas sus ascendientes, para poder
   desplegar únicamente las ramas con resultados.                          */
function searchTree(data: Json, query: string): { matches: Set<string>; open: Set<string>; count: number; capped: boolean } {
  const needle = query.trim().toLowerCase();
  const matches = new Set<string>();
  const open = new Set<string>(['']);
  let visited = 0;
  let capped = false;

  function walk(value: Json, path: string, ancestors: string[]): void {
    if (visited++ > SEARCH_VISIT_CAP) {
      capped = true;
      return;
    }
    if (!isBranch(value)) return;
    const asArray = Array.isArray(value);
    for (const [key, child] of entriesOf(value)) {
      if (capped) return;
      const p = childPath(path, key, asArray);
      const keyHit = !asArray && key.toLowerCase().includes(needle);
      const leafHit = !isBranch(child) && String(child).toLowerCase().includes(needle);
      if (keyHit || leafHit) {
        matches.add(p);
        for (const a of ancestors) open.add(a);
        open.add(path);
      }
      if (isBranch(child)) walk(child, p, [...ancestors, path]);
    }
  }

  if (needle) walk(data, '', []);
  return { matches, open, count: matches.size, capped };
}

/**
 * Árbol navegable del documento JSON, con búsqueda, plegado y modo crudo.
 *
 * Recibe el JSON ya parseado: la descarga y los estados de error los gestiona
 * quien lo usa (hoy, el explorador de archivos), que es el mismo camino que
 * siguen CSV y XLSX.
 */
export function JsonTree({ data, url }: { data: Json; url: string }) {
  const [mode, setMode] = useState<'tree' | 'raw'>('tree');
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  /** Cambia al plegar/desplegar todo, para reiniciar el estado local del árbol. */
  const [treeEpoch, setTreeEpoch] = useState(0);
  const [allOpen, setAllOpen] = useState(false);

  const rawText = useMemo(() => (mode === 'raw' ? JSON.stringify(data, null, 2) : ''), [mode, data]);

  const copyRaw = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const search = useMemo(() => (query.trim() ? searchTree(data, query) : null), [data, query]);

  // Con búsqueda activa manda el conjunto de ramas con resultados; se deriva
  // en el render en lugar de copiarlo a estado desde un efecto.
  const openPaths = search ? search.open : expanded;

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const foldAll = () => {
    setAllOpen(false);
    setExpanded(new Set(['']));
    setTreeEpoch((n) => n + 1);
  };
  const unfoldAll = () => {
    setAllOpen(true);
    setTreeEpoch((n) => n + 1);
  };

  const rawLines = mode === 'raw' ? rawText.split('\n') : [];
  const rawTruncated = rawLines.length > RAW_LINE_CAP;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {mode === 'tree' && (
          <>
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar clave o valor…"
                aria-label="Buscar dentro del JSON"
                className="h-8 w-full rounded-lg border border-field bg-card pl-8 pr-7 text-xs text-body placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-body"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>

            {search && (
              <span className="text-[11px] text-faint" role="status">
                {search.count === 0
                  ? 'Sin coincidencias'
                  : `${search.count.toLocaleString('es-ES')} coincidencia${search.count === 1 ? '' : 's'}`}
                {search.capped && ' (búsqueda parcial: archivo muy grande)'}
              </span>
            )}

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={unfoldAll}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-faint transition-colors hover:bg-fill hover:text-body"
              >
                <UnfoldVertical className="h-3.5 w-3.5" aria-hidden /> Desplegar
              </button>
              <button
                type="button"
                onClick={foldAll}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-faint transition-colors hover:bg-fill hover:text-body"
              >
                <FoldVertical className="h-3.5 w-3.5" aria-hidden /> Plegar
              </button>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div
            className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5"
            role="group"
            aria-label="Modo de visualización"
          >
            {(['tree', 'raw'] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  mode === m ? 'bg-primary text-primary-fg' : 'text-body hover:bg-fill'
                )}
              >
                {m === 'tree' ? 'Árbol' : 'Crudo'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={copyRaw}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint transition-colors hover:bg-fill hover:text-body"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-ok" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? 'Copiado' : 'Copiar JSON'}
          </button>
        </div>
      </div>

      <div className="max-h-[36rem] overflow-auto p-3 font-mono text-xs leading-relaxed">
        {mode === 'tree' ? (
          <JsonNode
            key={treeEpoch}
            value={data}
            name={null}
            path=""
            depth={0}
            expanded={openPaths}
            onToggle={toggle}
            forceOpen={allOpen}
            matches={search?.matches ?? null}
            query={query.trim().toLowerCase()}
          />
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-x-3">
            {rawLines.slice(0, RAW_LINE_CAP).map((line, i) => (
              <div key={i} className="contents">
                <span className="select-none text-right text-faint tabular-nums">{i + 1}</span>
                <span className="whitespace-pre-wrap break-words text-body">{line}</span>
              </div>
            ))}
            {rawTruncated && (
              <div className="col-span-2 mt-2 text-faint">
                … {(rawLines.length - RAW_LINE_CAP).toLocaleString('es-ES')} líneas más. Usa «Copiar JSON» o{' '}
                <a href={url} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
                  abre el archivo completo
                </a>
                .
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Árbol recursivo ── */

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-warn-surface px-0.5 text-warn">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function LeafValue({ value, query }: { value: Json; query: string }) {
  const t = typeOf(value);
  if (t === 'string') {
    return (
      <span className="break-all text-ok">
        &quot;<Highlight text={value as string} query={query} />&quot;
      </span>
    );
  }
  if (t === 'number') return <span className="text-info"><Highlight text={String(value)} query={query} /></span>;
  if (t === 'boolean') return <span className="text-accent">{String(value)}</span>;
  return <span className="italic text-faint">null</span>;
}

function CopyPathButton({ path }: { path: string }) {
  const [done, setDone] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  if (!path) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(path).then(() => {
          setDone(true);
          timeoutRef.current = setTimeout(() => setDone(false), 1200);
        });
      }}
      title={`Copiar la ruta ${path}`}
      aria-label={`Copiar la ruta ${path}`}
      className="ml-1 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-body focus-visible:opacity-100 group-hover/row:opacity-100"
    >
      {done ? <Check className="h-3 w-3 text-ok" aria-hidden /> : <Link2 className="h-3 w-3" aria-hidden />}
    </button>
  );
}

interface JsonNodeProps {
  value: Json;
  name: string | null;
  path: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  forceOpen: boolean;
  matches: Set<string> | null;
  query: string;
}

function JsonNode({ value, name, path, depth, expanded, onToggle, forceOpen, matches, query }: JsonNodeProps) {
  const [limit, setLimit] = useState(CHUNK);
  const t = typeOf(value);
  const isMatch = matches?.has(path) ?? false;

  const keyEl =
    name != null ? (
      <span className="font-medium text-strong">
        &quot;<Highlight text={name} query={query} />&quot;
      </span>
    ) : null;

  if (!isBranch(value)) {
    return (
      <div
        className={cn(
          'group/row -mx-1 flex items-baseline gap-1 rounded px-1 hover:bg-fill/70',
          isMatch && 'bg-warn-surface/60'
        )}
      >
        <span className="pl-4">
          {keyEl}
          {keyEl && <span className="text-faint">: </span>}
          <LeafValue value={value} query={query} />
        </span>
        <CopyPathButton path={path} />
      </div>
    );
  }

  const entries = entriesOf(value);
  const count = entries.length;
  const asArray = t === 'array';
  const open = asArray ? '[' : '{';
  const close = asArray ? ']' : '}';

  if (count === 0) {
    return (
      <div className="group/row -mx-1 flex items-baseline gap-1 rounded px-1 hover:bg-fill/70">
        <span className="pl-4">
          {keyEl}
          {keyEl && <span className="text-faint">: </span>}
          <span className="text-faint">{open}{close}</span>
        </span>
        <CopyPathButton path={path} />
      </div>
    );
  }

  // Las dos primeras plantas se abren solas: dan la forma del documento sin
  // obligar a hacer clic, y sin pintar el árbol entero.
  const isOpen = forceOpen || expanded.has(path) || (matches == null && depth < 2);
  const shown = entries.slice(0, limit);

  return (
    <div>
      <div className="group/row -mx-1 flex items-baseline rounded px-1 hover:bg-fill/70">
        <button
          type="button"
          onClick={() => onToggle(path)}
          aria-expanded={isOpen}
          className="inline-flex items-baseline gap-1 text-left"
        >
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 translate-y-0.5 text-faint transition-transform', isOpen && 'rotate-90')}
            aria-hidden
          />
          {keyEl}
          {keyEl && <span className="text-faint">: </span>}
          <span className="text-faint">{open}</span>
          {!isOpen && (
            <span className="text-faint">
              {' '}{count.toLocaleString('es-ES')} {asArray ? 'elem.' : 'claves'}{' '}
            </span>
          )}
          {!isOpen && <span className="text-faint">{close}</span>}
          {isOpen && (
            <span className="ml-1.5 text-[11px] text-faint">
              {count.toLocaleString('es-ES')} {asArray ? 'elem.' : 'claves'}
            </span>
          )}
        </button>
        <CopyPathButton path={path} />
      </div>

      {isOpen && (
        <div className="ml-[0.4rem] space-y-0.5 border-l border-border pl-3">
          {shown.map(([k, v]) => (
            <JsonNode
              key={k}
              value={v}
              name={asArray ? null : k}
              path={childPath(path, k, asArray)}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              forceOpen={forceOpen}
              matches={matches}
              query={query}
            />
          ))}
          {count > limit && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + CHUNK * 5)}
              className="ml-4 rounded px-1 text-faint underline-offset-2 hover:text-body hover:underline"
            >
              … mostrar {Math.min(CHUNK * 5, count - limit).toLocaleString('es-ES')} de{' '}
              {(count - limit).toLocaleString('es-ES')} restantes
            </button>
          )}
          <div className="pl-0 text-faint">{close}</div>
        </div>
      )}
    </div>
  );
}
