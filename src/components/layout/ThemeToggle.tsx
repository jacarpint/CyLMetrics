"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { watchTheme } from "@/lib/map-theme";

type Theme = "light" | "dark";

const STORAGE_KEY = "jcyl-data-quality-theme";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

/**
 * El tema vive en la clase `dark` de <html>, que pone el script anti-FOUC
 * antes del primer pintado. Se lee como fuente externa en vez de copiarlo a
 * estado en un efecto: así el botón queda sincronizado aunque el tema cambie
 * desde otro sitio, y no hay un render intermedio con el valor equivocado.
 */
function subscribe(onChange: () => void) {
  return watchTheme(onChange);
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe, getSnapshot, () => "light");

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-body shadow-sm transition-colors hover:bg-fill hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
      title={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
      suppressHydrationWarning
    >
      {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </button>
  );
}
