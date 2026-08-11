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
      <h2 className="text-lg font-semibold text-strong">Algo ha salido mal</h2>
      <p className="mt-2 max-w-sm text-sm text-faint">
        {error.message || "Se ha producido un error inesperado al cargar este contenido."}
      </p>
      <Button onClick={reset} className="mt-6">
        Reintentar
      </Button>
    </div>
  );
}
