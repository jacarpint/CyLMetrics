"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-bad-surface">
        <AlertTriangle className="h-7 w-7 text-bad" aria-hidden />
      </div>
      {/* `h1` y no `h2`: este boundary sustituye al contenido de la página, así
          que si aquí empezáramos en `h2` la vista se quedaría sin encabezado de
          primer nivel. */}
      <h1 className="text-lg font-semibold text-strong">Algo ha salido mal</h1>
      {/* Mensaje genérico, no `error.message`: en un fallo del lado del servidor
          ese texto puede ser una traza interna, y en el cliente no le dice nada
          útil a quien está leyendo. El detalle va a la consola y el digest queda
          a la vista para poder cruzarlo con los registros. */}
      <p className="mt-2 max-w-sm text-sm text-faint">
        No se ha podido cargar este contenido. Puede ser un problema puntual del
        servicio de origen; inténtalo de nuevo en unos segundos.
      </p>
      <Button onClick={reset} className="mt-6">
        Reintentar
      </Button>
      {error.digest && (
        <p className="mt-4 font-mono text-[11px] text-faint">
          Referencia del error: {error.digest}
        </p>
      )}
    </div>
  );
}
