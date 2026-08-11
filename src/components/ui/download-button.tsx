'use client';

import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DownloadButtonProps {
  /** Contenido del fichero, o una función que lo produzca al pulsar. */
  content: string | (() => string);
  filename: string;
  mimeType?: string;
  label: string;
  className?: string;
}

/**
 * Descarga un fichero generado en el cliente.
 *
 * Usa un Blob al pulsar en vez de un `data:` URI en el href: el segundo mete
 * el fichero entero, ya codificado, dentro del HTML de la página. En la lista
 * de alertas eso suponía cientos de KB en cada carga para algo que casi nadie
 * llega a descargar.
 */
export function DownloadButton({ content, filename, mimeType = 'text/plain;charset=utf-8', label, className }: DownloadButtonProps) {
  const onClick = () => {
    const text = typeof content === 'function' ? content() : content;
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-field bg-transparent px-3 py-2 text-xs font-medium text-body transition-colors',
        'hover:bg-fill hover:text-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        className
      )}
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
