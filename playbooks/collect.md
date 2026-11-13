# Playbook: сбор вакансий («собери»)

Сбор двухфазный: **скрипт** забирает список, применяет лимиты, предфильтр и дедупликацию → **агент** скорит
только новые вакансии. Так агент не тратит токены на рутину.

1. Прочитай `config/preferences.md`, `config/regions.yaml`, `playbooks/scoring.md`, `config/sources.md`.
2. Для каждого источника со статусом ✅ запусти его команду (сейчас: `npm run collect:remoteok`).
   Скрипт сам: применяет лимиты из `.env` (design.md §5.1), предфильтр (`config/prefilter.yaml`),
   дедупликацию (дубли дописываются в `duplicates` существующей записи, `apply_target` пересчитывается),
   сохраняет новые вакансии со `scores: null` и пишет лог в `data/runs/<дата>-collect.md`.
3. `npm run pending` — список вакансий, ждущих скоринга.
4. Для каждой:
   1. Прочитай файл, заполни поля по `playbooks/scoring.md` прямо в front matter
      (тело и остальные поля не трогай). Явно не по профилю — всё равно отскорь (низкий `fit`), не удаляй.
   2. **Реальная ссылка.** Если `real_url: null` или `apply_target` — агрегатор (remoteok, linkedin…), и
      `overall` вероятно будет заметным: найди вакансию на сайте компании / в её ATS (careers-страница,
      `boards.greenhouse.io/<company>`, `jobs.lever.co/<company>`, `jobs.ashbyhq.com/<company>`).
      Нашёл с уверенностью — запиши в `real_url`. Ничего не отправляй. Не нашёл — оставь `null`.
      `apply_method` и `apply_target` пересчитает `npm run score`.
5. `npm run score` — посчитает `overall`, `scores.region`, `apply_target`; `npm run validate` — исправь ошибки.
6. **Обязательно** допиши наблюдения в `data/insights.md` (формат — design.md §8.5; создай файл, если нет).
   Даже если наблюдений нет — строка `- [none] <источник>: без замечаний`.
7. Кратко отчитайся: сколько собрано/отсеяно/дублей, топ-5 по `overall` с id, что требует внимания.
