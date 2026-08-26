import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Dos entornos, separados por la extensión del fichero de test.
 *
 *   *.test.ts   → node, para la lógica pura. Son 487 tests y arrancan en
 *                 milisegundos; meterlos en un DOM que no usan solo los frena.
 *   *.test.tsx  → jsdom, para los componentes.
 *
 * Hasta ahora solo existía el primero, así que la capa de interfaz era la única
 * sin red: el criterio de calidad estaba cubierto por los dos lados —TypeScript y
 * Python— y en cambio nada comprobaba que un botón siguiera siendo pulsable.
 *
 * La discriminación va por extensión y no por carpeta a propósito: un test de
 * componente lleva JSX, así que ya tiene que ser `.tsx`. No hay una segunda
 * convención que recordar ni que se pueda incumplir sin que falle la compilación.
 */
const alias = { '@': path.resolve(__dirname, 'src') };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
