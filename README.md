# looking-for-a-job

Система полуавтоматического поиска работы. Скрипты собирают вакансии с площадок, AI-агент (Claude Code или любой
агент, читающий `AGENTS.md`) оценивает их по личным предпочтениям, а локальный UI позволяет просматривать и отбирать.
Всё хранится локально в markdown-файлах, без базы данных. Следующий этап — отклик агентом с адаптацией резюме.

- Документация: [docs/README.md](docs/README.md) — начните с [docs/getting-started.md](docs/getting-started.md),
  команды и запуск — [docs/running.md](docs/running.md).
- Дизайн, статус и план: [dev_docs/design.md](dev_docs/design.md).
- Инструкции агенту: [AGENTS.md](AGENTS.md), `playbooks/`.
