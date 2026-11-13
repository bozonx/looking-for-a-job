# Playbook: сбор вакансий («собери»)

1. Прочитай `config/preferences.md`, `config/regions.yaml`, `playbooks/scoring.md`, `sources/sources.md`.
2. Для каждого источника со статусом ✅ запусти его команду (сейчас: `npm run collect:remoteok`).
   Скрипт сам: применяет лимиты из `.env` (§5.1), предфильтр (`config/prefilter.yaml`), дедупликацию,
   сохраняет новые вакансии со `scores: null` и пишет лог в `data/runs/<дата>-collect.md`.
3. `npm run pending` — список вакансий, ждущих скоринга.
4. Для каждой: прочитай файл, заполни поля по `playbooks/scoring.md` прямо в front matter
   (тело и остальные поля не трогай). Если по тексту вакансия явно не по профилю — всё равно отскорь
   (низкий `fit`), не удаляй.
5. `npm run score` — посчитает `overall`; `npm run validate` — исправь ошибки, если есть.
6. Допиши наблюдения в `data/insights.md` (формат — design.md §8.5).
7. Кратко отчитайся: сколько собрано/отсеяно/дублей, топ-5 по `overall` с id, что требует внимания.
