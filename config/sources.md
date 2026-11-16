# Источники

Только открытые API, стандартные ленты и HTML без защиты от ботов (без браузера, ключей и логина). Настройки провайдеров — `config/sources.yaml`.

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
| habr | Хабр Карьера — https://career.habr.com | rss + страница вакансии | русскоязычные компании, «можно удалённо» | ✅ |
| vuejobs | VueJobs — https://vuejobs.com | rss + страница вакансии | Vue/Nuxt, ~900 активных | ✅ |
| nodesk | NoDesk — https://nodesk.co | rss | удалёнка, ~10 последних | ✅ |
| workingnomads | Working Nomads — https://www.workingnomads.com | api (JSON) | удалёнка, последние ~30–50 | ✅ |
| landingjobs | Landing.jobs — https://landing.jobs | api (JSON, snapshot) | Европа; берутся только удалённые | ✅ |
| yc | Y Combinator Jobs — https://www.ycombinator.com/jobs | html (JSON в `data-page`, snapshot) | стартапы YC, удалёнка | ✅ |
| euremotejobs, dailyremote, remoterocketship, wellfound, startup.jobs, 4dayweek, getmanfred | — | — | Cloudflare/403 или лента без вакансий | ✗ |
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
- **habr, vuejobs** — в ленте описание обрезано (`full_page: true`): для прошедших предфильтр скрипт открывает страницу
  вакансии и берёт полный текст из schema.org JobPosting. Хабр: компания — `author`, город и зарплата — из заголовка.
- **yc** — список с `ycombinator.com/jobs/role/...` (страницы — `yc.pages`), описание — со страницы вакансии.
  Даты нет, только «N months ago» → примерный `posted_at`. Отклик — через аккаунт Work at a Startup.
- **landingjobs** — офисные вакансии отсеиваются до предфильтра (кроме `office_countries`).
- **Склейка внутри источника:** одна роль в нескольких локациях (vuejobs, ats, himalayas) — одна запись, локации через `;`.
- **Окно сбора и свежесть** — `docs/env.md`: окно у каждого источника от прошлого сбора; в скоринг идут только
  вакансии моложе `freshness_days` источника (`config/sources.yaml`).
- **Условия площадок:** Remote OK, Remotive, Jobicy требуют ссылку на площадку как источник — она есть в `source_url` и в теле.
  Remotive просит не чаще 4 запросов в день — скрипт пропускает его, если с прошлого сбора < 6 ч.

## Как добавить источник

- **RSS / Atom / JSON Feed** — без кода: блок в секции `feeds` в `config/sources.yaml` (`id`, `name`, `urls`, `title_format`,
  при необходимости `location_field` / `tags_field` / `employment_field`, `title_regex` / `description_regex`, `full_page`).
  Добавь срок в `freshness_days`.
- **HTML-площадка** — сначала поищи машиночитаемое: RSS (`/feed`, `/rss`, `index.xml`), JSON в странице (`__NEXT_DATA__`,
  `data-page`), schema.org JobPosting (`scripts/lib/jsonld.ts`). Проверка доступности: `curl` без cookies → 200 и нет
  `challenge-platform`/«Just a moment». Площадки за Cloudflare/логином не подключаем. `id` — в `config/source-priority.yaml`.
- **Компания с Greenhouse / Lever / Ashby** — слаг в секцию `ats`.
- **Своё API** — `scripts/providers/<id>.ts` (интерфейс `Provider` из `scripts/lib/collect.ts`, построитель `makeJob` из
  `scripts/lib/job.ts`), строка в `scripts/providers/index.ts`, здесь и в `config/source-priority.yaml`.
  Если площадка — агрегатор, добавь домен в `BOARDS` (`scripts/lib/target.ts`).
