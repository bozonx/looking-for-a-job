# Источники

Только открытые API и стандартные ленты (без браузера и без ключей). Настройки провайдеров — `config/sources.yaml`.

| id | Площадка | Тип | Что это даёт | Статус |
|---|---|---|---|---|
| ats | Greenhouse / Lever / Ashby — сайты найма компаний | api (JSON, по компании) | первоисточник: прямой `real_url`, закрытые вакансии → `possibly_closed` | ✅ |
| getonbrd | Get on Board — https://www.getonbrd.com | api (JSON) | ЛатАм; удалёнка + офис/гибрид в Аргентине | ✅ |
| hn | Hacker News «Who is hiring» — через https://hn.algolia.com/api | api (JSON) | посты самих компаний, много стартапов | ✅ |
| remoteok | Remote OK — https://remoteok.com | api (JSON) | удалёнка | ✅ |
| himalayas | Himalayas — https://himalayas.app | api (JSON, поиск) | удалёнка, ограничения по стране/часовому поясу | ✅ |
| weworkremotely | We Work Remotely — https://weworkremotely.com | rss | удалёнка, платные размещения | ✅ |
| jobicy | Jobicy — https://jobicy.com | api (JSON) | удалёнка | ✅ |
| remotive | Remotive — https://remotive.com | api (JSON) | удалёнка; данные с задержкой ~24 ч | ✅ |
| hh | hh.ru | api | анонимный доступ закрыт (403), нужна регистрация приложения с модерацией | ✗ не подключаем |
| linkedin | LinkedIn | html (браузер Orca) | — | после стабилизации |

Собрать все: `npm run collect`; один: `npm run collect -- <id>`; проверить без записи: `--dry-run`.

## Особенности

- **ats** — не лента «новые сверху», а снимок всех открытых вакансий компании (`snapshot`): нет отсечки по
  `COLLECT_MAX_AGE_DAYS` (давно открытая вакансия всё ещё реальна) и нет остановки на известных. Вакансия пропала
  из списка → `possibly_closed: true`, вернулась → `false`. Компания, чей API не ответил, не трогается (предупреждение в логе).
  Первый сбор по новой компании может дать много вакансий — очередь скоринга всё равно ограничена `SCORE_MAX_PER_RUN`.
  Компании — секция `ats` в `config/sources.yaml`; слаг берётся из адреса страницы вакансий.
- **getonbrd** — не-удалённые вакансии вне `office_countries` отсеиваются до предфильтра (в логе — «формат …»).
- **hn** — два последних треда; заголовок — роль из первой строки поста «Компания | Роль | Локация | …».
  Посты без такой строки («SEEKING …») отсеиваются.
- **Условия площадок:** Remote OK, Remotive, Jobicy требуют ссылку на площадку как источник — она есть в `source_url` и в теле.
  Remotive просит не чаще 4 запросов в день.

## Как добавить источник

- **RSS / Atom / JSON Feed** — без кода: блок в секции `feeds` в `config/sources.yaml` (`id`, `name`, `urls`, `title_format`,
  при необходимости `location_field` / `tags_field` / `employment_field`). `id` — в `config/source-priority.yaml`.
- **Компания с Greenhouse / Lever / Ashby** — слаг в секцию `ats`.
- **Своё API** — `scripts/providers/<id>.ts` (интерфейс `Provider` из `scripts/lib/collect.ts`, построитель `makeJob` из
  `scripts/lib/job.ts`), строка в `scripts/providers/index.ts`, здесь и в `config/source-priority.yaml`.
  Если площадка — агрегатор, добавь домен в `BOARDS` (`scripts/lib/target.ts`).
