# Lista de Verificación de Estado Limpio — CyLMetrics (L12)

- [ ] `.\init.ps1` funciona desde cero (lint + typecheck + vitest + --check-deps + contrast).
- [ ] Si toqué `src/analysis`: `python -m pytest src/analysis/tests -q` verde.
- [ ] Si toqué topes/fórmulas/comandos: tests `pipeline-limits`, `content-scoring`, `documented-commands` verdes + docs al día.
- [ ] `claude-progress.md` actualizado (estado + sesión + next best action).
- [ ] `feature_list.json`: estados reales, un solo `in_progress`, ningún `passing` sin `evidence[]`, `last_updated` al día.
- [ ] `reports/current/` intacto o cambiado a propósito (index + d/*.json coherentes; sin `verification.json` huérfano sin `generated_at`).
- [ ] Sin secretos/`.env`, sin checkpoint (~100 MB), sin bundle `--legacy-output` (~164 MB) en el commit.
- [ ] `git status` revisado; commit descriptivo hecho.
- [ ] Próxima sesión arranca con `.\init.ps1` sin reparación manual.
