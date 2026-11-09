# Rúbrica del Evaluador — CyLMetrics (L09)

> Calibrar 3–5 rondas contra juicio humano. Sin evidencia (logs/outputs), Verificación = 0.

| Categoría | Pregunta CyLMetrics | 0 | 2 | Score | Evidencia |
|---|---|---|---|---|---|
| Corrección | ¿Coincide con `user_visible_behavior` sin contradecir criterio publicado? | Contradice `quality.ts`/`availability.ts` o metodología | Coincide + `documented-*` verdes |  |  |
| Verificación | ¿lint + typecheck + vitest (+pytest si Python) + E2E/check correspondiente ejecutados? | Afirmado sin ejecutar | Full + check específico + output pegado |  |  |
| Alcance | ¿Una sola feature de `feature_list.json`? | Tocó portal + motor + docs sin justificar | Solo la feature |  |  |
| Fiabilidad | ¿Sobrevive a `init` + reinicio? ¿Despliegue con `reports/current` intacto? | 503 en `/api/quality` solo en prod / requiere pasos manuales | `init` 2/2 + build con tracing OK |  |  |
| Mantenibilidad | ¿Próxima sesión entiende sin chat? ¿“Una sola definición por pregunta” respetada? | Lógica duplicada fuera de `src/lib` | Reutiliza módulos + docs actualizados |  |  |
| Entrega | ¿Nueva sesión continúa solo con repo? | Necesita preguntar por checkpoint/venv/rutas | Solo repo + `docs/ANALISIS.md` basta |  |  |

Veredicto: Aceptar (11–12) / Revisar (7–10) / Bloquear (0–6).

Seguimiento: evidencia faltante · correcciones · próximo trigger.

## Historial de calibración

### Ronda 1 — YYYY-MM-DD — divergencia · cambio · resultado
### Ronda 2 — YYYY-MM-DD — divergencia · cambio · resultado
