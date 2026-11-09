# Coding Agent Startup Flow — CyLMetrics (L06)

```
1. Get-Location → raíz CyLMetrics
2. git log --oneline -5 + git status
3. Lee claude-progress.md → Estado + próxima feature
4. Lee feature_list.json → una not_started prioritaria → in_progress
5. Lee docs/quality-document.md → evita zonas D/C sin plan
6. .\init.ps1 (rápido: lint+typecheck+vitest+check-deps+contrast)
7. Smoke ANTES de tocar código (ruta afectada en dev)
8. Implementa con scope estrecho (una definición por pregunta en src/lib)
9. Verificación de la feature + E2E/check específico con evidencia
10. progress + handoff + checklist → commit
```

- Si tocaste `src/analysis`: añade `pytest` en paso 9.
- Si tocaste informe/rutas: verifica `outputFileTracingIncludes` + `reports/current/` antes del commit.
- `npm run build` pesado: solo cuando cambien rutas, informe o config de despliegue.
