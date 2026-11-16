# AGENTS.md — точка входа для любого агента

Система полуавтоматического поиска работы. Дизайн: `dev_docs/design.md`.
Все скрипты — TypeScript, запускаются через `npm run …` (Node ≥ 23.6 исполняет `.ts` нативно).

## Маршрутизация команд

| Фраза пользователя | Что делать |
|---|---|
| «собери», «собери вакансии» | `playbooks/collect.md` |
| «открой UI», «покажи вакансии» | `npm run dev` → http://localhost:3000 (этап 2, `app/`) |
| «проанализируй журнал», «что улучшить в резюме / поиске» | `playbooks/analyze.md` |
| «проверь проблемные» | `playbooks/flagged.md` (вакансии с `flagged: true`) |
| «проверь, живы ли вакансии» | `npm run check-alive` (по real_url, пишет `possibly_closed`) |
| «найди прямые ссылки» | `npm run resolve-urls` (real_url со страниц агрегаторов) |
| «откликнись», «откликнись выбранным», «откликнись по скорингу», «повтори отклики» | пока не реализовано (этап 3, `dev_docs/design.md`) — сообщи об этом |

## Общие правила

- **Язык проекта — русский**: документация, комментарии, коммиты, отчёты агента.
- Генерируемые данные тоже на русском: `summary`, `score_reasoning`, `attention_details`, заметки, `data/insights.md`, логи.
  Исключение — то, что уходит работодателю (резюме, письмо, ответы в формах): на языке вакансии.
- Файлы — источник истины. Вакансии: `data/vacancies/**/*.md` (YAML front matter + текст).
- Не выдумывай. Не уверен — оставь `null` и опиши сомнение в `score_reasoning` / `attention_details`.
- `scores.overall` считает только `npm run score`, не агент.
- После любых правок вакансий — `npm run validate`.
- Код скриптов — только TypeScript; после изменений — `npm run typecheck`.
- `data/` и `profile/` — личное, в git не коммитить.
- `status` — решение: `null` (нет решения), `selected` (на отклик), `applied`/`needs_attention`/`apply_failed` (агент). Неотскоренная = `scores: null`.
- Новизна — `collected_run` == `data/state/last-collect.json`. ★ — личная пометка, в скоринге и анализе не учитывается.
- Чистка (`cleanup`; автоматически после `collect` при `CLEANUP_ON_COLLECT`): `status: null` без ★/⚑ старше `CLEANUP_DEFAULT_DAYS`. Закрытые (`possibly_closed`) только помечаются и удаляются по тому же правилу.
- Жизненный цикл вакансии — `dev_docs/design.md`.
- UI (`app/`) пишет в front matter только `status` (`null`/`selected`), `starred`, `flagged`, `notes`; остальные поля — агент и скрипты. Устройство UI — `docs/running.md`.
