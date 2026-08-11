"use client";

import { useEffect } from "react";

/**
 * Pantalla de último recurso: sustituye al layout raíz, así que no puede dar
 * por hecho que los tokens de `globals.css` estén cargados. Va autocontenida,
 * con su propio soporte de tema vía `prefers-color-scheme`.
 */
const STYLES = `
  :root { color-scheme: light dark; }
  .ge-root {
    --ge-bg: #f7f9fc; --ge-card: #ffffff; --ge-strong: #0f172a;
    --ge-body: #475569; --ge-bad: #b91c1c; --ge-bad-surface: #fef2f2;
    --ge-primary: #047857; --ge-primary-hover: #036349; --ge-border: #e2e8f0;
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 0.5rem;
    padding: 2rem; text-align: center;
    background: var(--ge-bg); color: var(--ge-strong);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    .ge-root {
      --ge-bg: #0b1220; --ge-card: #151f31; --ge-strong: #f1f5f9;
      --ge-body: #cbd5e1; --ge-bad: #f87171; --ge-bad-surface: #2c1517;
      --ge-primary: #34d399; --ge-primary-hover: #6ee7b7; --ge-border: #2c3a52;
    }
    .ge-button { color: #04241c; }
  }
  .ge-icon {
    width: 4rem; height: 4rem; border-radius: 9999px; margin-bottom: 0.5rem;
    display: flex; align-items: center; justify-content: center;
    background: var(--ge-bad-surface); color: var(--ge-bad); font-size: 1.75rem;
  }
  .ge-title { font-size: 1.25rem; font-weight: 700; margin: 0; }
  .ge-text { margin: 0; max-width: 28rem; font-size: 0.875rem; color: var(--ge-body); }
  .ge-button {
    margin-top: 1.5rem; border: 0; border-radius: 0.5rem; cursor: pointer;
    padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 600;
    background: var(--ge-primary); color: #ffffff;
  }
  .ge-button:hover { background: var(--ge-primary-hover); }
  .ge-button:focus-visible { outline: 2px solid var(--ge-primary); outline-offset: 2px; }
`;

export default function GlobalError({
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
    <html lang="es">
      <body>
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
        <div className="ge-root">
          <div className="ge-icon" aria-hidden>
            !
          </div>
          <h1 className="ge-title">Error crítico de la aplicación</h1>
          <p className="ge-text">
            {error.message || "No ha sido posible inicializar el portal. Por favor, inténtelo de nuevo."}
          </p>
          <button type="button" className="ge-button" onClick={reset}>
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
