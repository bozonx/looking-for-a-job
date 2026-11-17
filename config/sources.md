# Источники

Только открытые API, стандартные ленты и HTML без защиты от ботов (без браузера, ключей и логина).

Три файла — три разные вещи:
- `config/sources.md` (этот) — что за площадки, почему подключены или отклонены, их особенности; для человека и агента.
- `config/sources.yaml` — настройки сбора для скриптов: ленты, компании ATS, запросы, фильтры, `freshness_days`.
- `config/apply-priority.yaml` — порядок мест **отклика** (сайт компании, ATS, email/Telegram, площадки); к сбору не относится.

Согласованность id между ними, `BOARDS` (`scripts/lib/target.ts`) и `freshness_days` проверяет `npm test` (`scripts/lib/sources.test.ts`).

| id | Площадка | Тип | Что это даёт | Статус |
|---|---|---|---|---|
| ats | Greenhouse / Lever / Ashby — сайты найма компаний (сбор; распознавание ссылок для отклика шире — workable, workday…) | api (JSON, по компании) | первоисточник: прямой `real_url`, закрытые вакансии → `possibly_closed` | ✅ |
| getonbrd | Get on Board — https://www.getonbrd.com | api (JSON) | ЛатАм; удалёнка + офис/гибрид в Аргентине | ✅ |
| hn | Hacker News «Who is hiring» — через https://hn.algolia.com/api | api (JSON) | посты самих компаний, много стартапов | ✅ |
| remoteok | Remote OK — https://remoteok.com | api (JSON) | удалёнка | ✅ |
| himalayas | Himalayas — https://himalayas.app | api (JSON, поиск) | удалёнка, ограничения по стране/часовому поясу | ✅ |
| weworkremotely | We Work Remotely — https://weworkremotely.com | rss | удалёнка, платные размещения | ✅ |
| jobicy | Jobicy — https://jobicy.com | api (JSON) | удалёнка | ✅ |
| remotive | Remotive — https://remotive.com | api (JSON) | удалёнка; данные с задержкой ~24 ч, одна категория | ✅ |
| habr | Хабр Карьера — https://career.habr.com | rss + страница вакансии | русскоязычные компании, «можно удалённо» | ✅ |
| vuejobs | VueJobs — https://vuejobs.com | rss + страница вакансии | Vue/Nuxt, ~900 активных | ✅ |
| nodesk | NoDesk — https://nodesk.co | rss | удалёнка, только ~10 последних — собирать часто | ✅ |
| workingnomads | Working Nomads — https://www.workingnomads.com | api (JSON) | удалёнка, только последние ~30–50 | ✅ |
| landingjobs | Landing.jobs — https://landing.jobs | api (JSON, snapshot) | Европа; берутся только удалённые | ✅ |
| yc | Y Combinator Jobs — https://www.ycombinator.com/jobs | html (JSON в `data-page`, snapshot) | стартапы YC, удалёнка | ✅ |
| bumeran | Bumeran — https://www.bumeran.com.ar | api (JSON, POST, `x-site-id: BMAR`) | Аргентина: офис/гибрид/удалёнка, IT-рубрика | ✅ |
| zonajobs | ZonaJobs — https://www.zonajobs.com.ar | api (JSON, та же платформа, `x-site-id: ZJAR`) | Аргентина, свой пул вакансий (не копия Bumeran) | ✅ |
| computrabajo | Computrabajo — https://ar.computrabajo.com | html + JobPosting на странице вакансии | Аргентина, рубрика «Informática y Telecom» | ✅ |
| djinni | Djinni — https://djinni.co | rss + страница вакансии | Украина/международные, удалёнка; компания — из JobPosting | ✅ |
| hh | HeadHunter СНГ — hh.kz, hh.uz, rabota.by, hh.kg, hh.az | html (JSON в `HH-Lux-InitialState`) + страница вакансии | Казахстан, Узбекистан, Беларусь, Кыргызстан, Азербайджан, Грузия; только «удалённо» | ✅ |
| getmatch | getmatch — https://getmatch.ru | api (JSON) | русскоязычные IT-компании, с зарплатами; только удалённые | ✅ |
| geekjob | GeekJob — https://geekjob.ru | api (JSON) + страница вакансии | русскоязычные IT-компании; только удалённые | ✅ |
| indeed, jooble, talent, empleosit | — | — | Аргентина: 403/капча или нет машиночитаемых данных | ✗ |
| euremotejobs, dailyremote, remoterocketship, wellfound, startup.jobs, 4dayweek, getmanfred, devby | — | — | Cloudflare/403 или лента без вакансий | ✗ |
| hh (api) | api.hh.ru | api | анонимный доступ закрыт (403) — поэтому `hh` разбирает HTML страницы поиска | ✗ |
| turing, toptal (платформа), lemon.io, arc.dev | — | — | вакансии только после регистрации/входа (Toptal как работодатель — в `ats`) | ✗ |
| relocate.me | — | html | только вакансии с переездом — противоречит `preferences.md` | ✗ не подключаем |
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
- **habr, vuejobs, djinni** — в ленте описание обрезано (`full_page: true`): для прошедших предфильтр скрипт открывает
  страницу вакансии и берёт полный текст из schema.org JobPosting. Локация из ленты важнее локации из JobPosting.
  Хабр: компания — `author`; из скобок заголовка `(Город, от N до M ₽)` город идёт в `location`, вилка — в `salary`
  (месячная; любая часть может отсутствовать). VueJobs: компания и локация — из начала описания (`description_regex`).
  Djinni: компании в ленте нет — берётся из JobPosting.
- **yc** — список с `ycombinator.com/jobs/role/...` (страницы — `yc.pages`), описание — со страницы вакансии.
  Даты нет, только «N months ago» → примерный `posted_at`. Отклик — через аккаунт Work at a Startup.
- **bumeran, zonajobs** — фильтры `filters` в `config/sources.yaml`; описание — простой текст из выдачи. Компания часто
  скрыта («Confidencial» / «Importante compañía…») → `company_country: null`. Много объявлений кадровых агентств.
- **computrabajo** — дата в списке только «Hace N horas»; точная — из JobPosting на странице вакансии (грузится после предфильтра).
- **hh** — hh.kz/hh.uz/rabota.by/hh.kg/hh.az — одна база: один источник, страна задаётся `areas`. Пагинация
  по 50, `COLLECT_MAX_PAGES` действует на каждый запрос. Описание — JobPosting страницы вакансии (после предфильтра).
- **djinni** — неизвестный `primary_keyword` молча отдаёт всю ленту (продажи, финансы…) — проверяй значение на сайте
  (после правки — `npm run collect -- djinni --dry-run` и глазами по заголовкам).
- **getmatch, geekjob** — поиска нет, берётся весь поток; не удалённые отсеиваются до предфильтра (`remote_only`).
  GeekJob: дата в списке без года («16 ноября»), точная — в JobPosting.
- **landingjobs** — офисные вакансии отсеиваются до предфильтра (кроме `office_countries`).
- **Склейка внутри источника:** одна роль в нескольких локациях (vuejobs, ats, himalayas) — одна запись, локации через `;`.
- **Окно сбора и свежесть** — `docs/env.md`: окно у каждого источника от прошлого сбора, но не глубже
  `min(COLLECT_MAX_AGE_DAYS, freshness_days)` — старее не загружается вовсе; в скоринг идут только вакансии моложе
  `freshness_days`. Snapshot-источники (`ats`, `yc`, `landingjobs`) окна не имеют.
- **Короткие ленты** — NoDesk (~10), Working Nomads (~30–50), Djinni (100 на категорию): при редком сборе вакансии
  теряются, окно этого не компенсирует.
- **Условия площадок:** Remote OK, Remotive, Jobicy требуют ссылку на площадку как источник — она есть в `source_url` и в теле.
  Remotive просит не чаще 4 запросов в день — скрипт пропускает его, если с прошлого сбора < 6 ч; поэтому категория
  ровно одна (каждая — отдельный запрос), больше — ошибка конфигурации.

## Как добавить источник

- **RSS / Atom / JSON Feed** — без кода: блок в секции `feeds` в `config/sources.yaml` (`id`, `name`, `urls`, `title_format`,
  при необходимости `location_field` / `company_field` / `tags_field` / `employment_field`, `title_regex` /
  `description_regex`, `full_page`). Затем — шаги «Везде» ниже.
- **HTML-площадка** — сначала поищи машиночитаемое: RSS (`/feed`, `/rss`, `index.xml`), JSON в странице (`__NEXT_DATA__`,
  `data-page`), schema.org JobPosting (`scripts/lib/jsonld.ts`). Проверка доступности: `curl` без cookies → 200 и нет
  `challenge-platform`/«Just a moment». Площадки за Cloudflare/логином не подключаем.
- **Компания с Greenhouse / Lever / Ashby** — слаг в секцию `ats`.
- **Своё API** — `scripts/providers/<id>.ts` (интерфейс `Provider` из `scripts/lib/collect.ts`, построитель `makeJob` из
  `scripts/lib/job.ts`), строка в `scripts/providers/index.ts`, затем — шаги «Везде».
- **Везде** (для любого нового id): строка в таблице выше, место в `config/apply-priority.yaml`, домен(ы) в `BOARDS`
  (`scripts/lib/target.ts`), срок в `freshness_days`. Проверка — `npm test` (`scripts/lib/sources.test.ts`).
