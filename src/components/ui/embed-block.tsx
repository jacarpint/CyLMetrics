'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Fragmento de código listo para copiar.
 *
 * La URL se muestra tal cual se pasa (relativa, corta de leer), pero al copiar
 * se resuelve contra el origen actual: un `<img src="/api/sello">` pegado en
 * otra web no apuntaría a ninguna parte. El `alt` también describe la imagen en
 * lugar de repetir la etiqueta del bloque, que era el texto de la interfaz.
 */
export default function EmbedBlock({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const snippet = (absolute: boolean) => {
    const src =
      absolute && typeof window !== 'undefined'
        ? new URL(url, window.location.origin).toString()
        : url;
    return `<img src="${src}" alt="Calidad de los datos — JCyL Data Quality Portal" />`;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet(true));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles: el código está a la vista para copiarlo a mano.
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-faint">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded border border-border bg-fill px-2 py-1.5 font-mono text-xs text-body">
          {snippet(false)}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Código copiado' : 'Copiar el código'}
          className="shrink-0 rounded-md border border-field p-1.5 text-faint transition-colors hover:bg-fill hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-ok" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
      <span role="status" className="sr-only">
        {copied ? 'Código copiado al portapapeles' : ''}
      </span>
    </div>
  );
}
