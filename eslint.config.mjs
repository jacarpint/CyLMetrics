import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Python analysis
    ".pytest_cache/**",
    ".venv-analysis/**",
    "__pycache__/**",
    "src/analysis/__pycache__/**",
    // Generated reports
    "reports/**",
    // Scripts
    "scripts/**",
  ]),
]);

export default eslintConfig;
