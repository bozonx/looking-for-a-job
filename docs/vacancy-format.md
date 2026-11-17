# Формат вакансии

Одна вакансия = один markdown-файл в `data/vacancies/ГГГГ/ММ/`. Имя: `<collected_at>-<источник>-<компания>-<должность>-<id на площадке>.md` (кириллица транслитерируется; у старых файлов суффикса id нет). На группу дублей с разных площадок — **один** файл (каноническая запись), копии перечислены в `duplicates`.

```
---
<YAML front matter — всё, что собрали скрипты, агент и интерфейс>
---

<оригинальный текст вакансии, HTML → markdown>
```

Схема — `scripts/lib/schema.ts` (zod), общая для скриптов и UI. Проверка — `npm run validate`.
Две ступени строгости:
- `scores: null` (ещё не отскорена) — базовая схема `VacancySchema`;
- `scores` заполнены — `ScoredVacancySchema`: дополнительно обязательны `region` (вычисляется), `company_country` (код или `null`), `summary`, `best_resume`, `score_reasoning`, `scoring_version`, все частные оценки и посчитанный `scores.overall`.

## Кто что пишет

| Обозначение | Кто |
|---|---|
| **С** | скрипт сбора (`npm run collect`, провайдер `scripts/providers/<источник>.ts`, `scripts/lib/geoscreen.ts`, `prefilter.ts`) — факты с площадки |
| **А** | агент при скоринге (`playbooks/scoring.md`) |
| **Р** | расчёт `npm run score` / `rescore` / `derived.ts` — производные поля, руками не править |
| **СКР** | вспомогательные скрипты (`npm run check-alive`, `npm run resolve-urls`, `npm run channels`) |
| **UI** | пользователь через веб-интерфейс (`app/`) |
| **О** | агент на этапе отклика (`playbooks/apply.md`) |

Правило: чего нет в источнике и нельзя уверенно вывести — `null`, сомнение — в `score_reasoning`. Не додумывать.

## Полный пример

```yaml
---
id: remoteok-1137713
title: Senior Vue.js Developer
company: Acme AI
company_country: DE
ru_speaking_team: false
source: remoteok
prefilter_reason: null
source_url: https://remoteok.com/remote-jobs/1137713
real_url: https://jobs.ashbyhq.com/acme/abc
real_url_tried_at: 2026-11-13
apply_method: ats-ashby
apply_channels:
  - { type: ats, value: "https://jobs.ashbyhq.com/acme/abc", by: collect, note: null }
  - { type: email, value: jobs@acme.ai, by: text, note: "тема: Senior FE" }
duplicates:
  - { source: wellfound, url: "https://wellfound.com/jobs/123", seen_at: 2026-11-14, id: "wellfound-123" }
apply_target: ats-ashby
collected_at: 2026-11-13
collected_run: "2026-11-13T10:00:00.000Z"
posted_at: 2026-11-12
location: Remote (EU)
region: europe
employer_group: europe
salary: { min: 60000, max: 84000, currency: USD, period: year }
salary_usd_month: { min: 5000, max: 7000 }
hire_from_ar: likely
hire_from_ar_evidence: "Worldwide remote, часовой пояс CET ±3 ч подходит для LATAM"
timezone: "CET ±3"
seniority: senior
company_stage: early
employment: contract
vacancy_language: en
work_languages: [en]
role_tracks: [vue, ai_engineer]
best_track: vue
tags: [vue, nuxt, typescript]
summary: Стартап на seed-стадии, AI-ассистент для юристов. Нужен фронтенд на Vue 3 + Nuxt с LLM-интеграциями.
key_points: [Vue 3, Nuxt, TypeScript, Работа с LLM API, Таймзона CET ±3]
red_flags: []
scores:
  remote: 95
  startup: 80
  corporate: 10
  outsource: 0
  legitimacy: 85
  region: 85
  language: 100
  fit: { vue: 90, react: 20, angular: 0, fullstack: 55, ai_engineer: 70, automation: 10 }
  overall: 91
stop_flags: []
best_resume: vue
score_reasoning: Явно указана полная удалёнка в пределах EU-таймзон, команда 8 человек, есть сайт и Crunchbase …
resume_match:
  resume: vue
  required: [vue, nuxt, typescript]
  nice_to_have: [pinia, tailwindcss]
  in_resume_negative: []
  responsibilities: ["develop web application", "integrate api"]
  keyword_spellings: { vue: ["Vue 3"] }
  domain: legaltech
  product_type: b2b-saas
  soft_requirements: [ownership, async-communication]
  years_required: 5
requirements_special: []
status: null
attention_reason: null
attention_details: null
starred: false
flagged: false
notes: ""
possibly_closed: false
alive_checked_at: 2026-11-14
applied_at: null
applied_via: null
apply_log: null
outcome: null
outcome_at: null
scoring_version: 3
---
```

## Идентификация и источник

### `id` · С · обязательно
`<источник>-<внешний id>`, например `remoteok-1137713`. Формат: `^[a-z0-9-]+-[A-Za-z0-9_-]+$`. Уникален по всем файлам (validate проверяет). Первый ключ дедупликации. UI адресует вакансию по нему.

### `title`, `company` · С · обязательно
Как на площадке, с исправленной кодировкой и HTML-сущностями. Если площадка не отдала компанию — `Unknown`. Пара нормализованных `company + title` — третий ключ дедупликации: из компании убираются `Inc/LLC/GmbH…`, из заголовка — `senior/junior/lead/remote…` и скобки. Поэтому «Senior Vue Developer (Remote)» и «Vue Developer» у одной компании считаются дублями.

### `company_country` · А · обязательно после скоринга (код или `null`)
ISO 3166-1 alpha-2 заглавными (`US`, `CY`) — страна **регистрации нанимающей стороны** (не кандидата, не локация вакансии, не офис клиента; для аутстафа — аутстаф-компания). `null`, если неясно. Из него `score.ts` вычисляет `region`; помогает определить `ru_corporate`.

### `ru_speaking_team` · А
`true`, если явно видно, что компания/команда русскоязычная (текст на русском, основатели из СНГ, «русскоязычная команда») — тогда высший приоритет региона, где бы ни была компания. Иначе `null` или `false`.

### `source`, `source_url` · С · обязательно
Площадка, откуда пришла каноническая запись, и ссылка на вакансию на ней. `source` должен совпадать с id площадки в `config/sources.md` и `config/apply-priority.yaml`.

### `prefilter_reason` · С
Причина отсева вакансии на этапе сбора (предфильтр `config/prefilter.yaml` или геоскрининг `hire_from_ar: no`). Если вакансия не отсеяна, значение `null`. В UI отсеянные вакансии доступны на отдельной вкладке с возможностью возврата в очередь скоринга.

### `real_url` · С/А
Прямая ссылка на вакансию у работодателя — сайт компании или ATS (Greenhouse, Lever, Ashby…). Откуда берётся:
1. скрипт сбора — если площадка отдаёт ссылку отклика, и она не ведёт обратно на саму площадку;
2. скрипт `npm run resolve-urls` — ищет прямую ссылку со страницы агрегатора;
3. агент — ищет на careers-странице компании или ATS-доменах.

### `real_url_tried_at` · СКР
Дата (`YYYY-MM-DD`), когда скрипт `npm run resolve-urls` последний раз пытался найти прямую ссылку на странице источника.

### `apply_channels` · С/А/Р/СКР
Все известные способы отклика — куда физически слать резюме:
```yaml
apply_channels:
  - { type: ats, value: "https://jobs.ashbyhq.com/acme/…", by: collect }
  - { type: email, value: jobs@acme.com, by: text, note: "тема: Senior FE — Имя" }
```
`type`: `ats` · `form` (форма на сайте компании) · `email` · `telegram` (`@handle`) · `whatsapp` (ссылка/номер) · `facebook` (страница, пост, Messenger) · `linkedin` · `platform` (отклик на hh/habr/djinni/getonbrd… — нужен аккаунт) · `dm` (личка: `x @handle`) · `other`.
`by`: `collect` (API площадки, `real_url`, дубли), `resolve` (`npm run resolve-urls` со страницы площадки), `text` (извлечено из текста, `scripts/lib/channels.ts`), `agent` (агент при скоринге). `note` — требования к отклику.

### `apply_method` · Р
Тип основного канала (того, что выбран в `apply_target`): `ats-<name>` | `external` (форма на сайте) | `email` | `telegram` | `whatsapp` | `facebook` | `linkedin` | `platform` | `dm` | `other` | `unknown` (только витрина-агрегатор, канал не найден). Пересчитывается из `apply_channels` при сборе, в `score`/`rescore`, `resolve-urls`, `npm run channels`. Руками не править.

### `duplicates` · С
Та же вакансия на других площадках: `{ source, url, seen_at?, id? }`. Пополняется скриптом сбора, когда находит совпадение (по id, по любому известному URL или по `company+title`). Все URL отсюда тоже участвуют в дедупликации. Дубль повторно не скорится.

### `apply_target` · Р
Куда откликаться. Выбирается среди `apply_channels`, `real_url`, `source` и всех `duplicates` по порядку из `config/apply-priority.yaml`: сайт компании и ATS > email/Telegram/WhatsApp/личка/Facebook > нишевые площадки > агрегаторы > LinkedIn. Хранит конкретное значение (`ats-ashby`, `company-site`, `wellfound`, `linkedin`…); ATS, которой нет в списке, ранжируется как `ats-other`. Пересчитывается автоматически.

## Даты и мониторинг активности

| Поле | Кто | Смысл |
|---|---|---|
| `collected_at` | С | Дата сбора вакансии (`YYYY-MM-DD`), обязательно |
| `collected_run` | С | Точный ISO timestamp запуска `npm run collect`, который собрал вакансию; используется в UI для бейджа «новая» |
| `posted_at` | С | Дата публикации на площадке; по ней работают окно сбора и `freshness_days` (очередь скоринга) |
| `alive_checked_at` | СКР | Дата (`YYYY-MM-DD`), когда `npm run check-alive` проверял доступность `real_url` |
| `possibly_closed` | С/СКР/А/О | `true`, если вакансия, возможно, закрыта (пропала из ATS или `check-alive` получил 404) |
| `applied_at` | О/UI | Дата или ISO timestamp отправки отклика |

## Условия работы, локация и грейд

### `location` · С
Строка с площадки как есть («Remote (EU)», «Worldwide», «Buenos Aires, hybrid»). Сырьё для геоскрининга, `scores.remote` и стоп-флагов `office_outside_ar` / `location_restricted`.

### `region` · Р
Группа работодателя: `argentina | ru_speaking_team | ru_speaking | anglo | spanish | europe | uae | asia | other | unknown`. Вычисляет `score.ts` по `config/regions.yaml`: `ru_speaking_team: true` → `ru_speaking_team`; иначе по списку стран группы; страна не в списках → `other`; `company_country: null` → `unknown`. Числовой `scores.region` — оттуда же.

### `employer_group` · Р
Группа работодателя (псевдоним `region`), автоматически вычисляется при скоринге и `rescore`. Отображается бейджем в UI и используется в фильтрах.

### `hire_from_ar`, `hire_from_ar_evidence` · С/А
Статус возможности найма кандидата из Аргентины:
- `yes` — явно разрешён найм из Аргентины (или указана в разрешённых странах);
- `likely` — Worldwide / LATAM remote, часовой пояс совместим;
- `unknown` — данных в тексте недостаточно для однозначного вывода (не является запретом!);
- `no` — явное ограничение, исключающее Аргентину (US only, EU work permit required, обязательный офис вне AR).

`hire_from_ar_evidence` — текстовое обоснование статуса на русском языке (цитата или указание правила). Вакансии с `hire_from_ar: no` исключаются из очереди скоринга.

### `timezone` · С/А
Требуемый рабочий часовой пояс или коридор рабочего времени (например, «CET ±3», «EST / UTC-5», «anywhere»). Заполняется из описания или полей площадки.

### `seniority` · С/А
Уровень/грейд позиции: `junior | mid | senior | staff | lead | unknown`. Для уровней junior применяется `seniority_cap` из `config/weights.yaml` (ограничивает максимальный итоговый `overall`, не штрафуя частный `fit` по стеку).

### `company_stage` · А
Стадия зрелости компании: `early | growth | enterprise | agency | unknown`. Заполняется агентом при скоринге.

### `salary` · С/А
`{ min, max, currency, period }`, `period ∈ year | month | hour`; любая граница может быть `null`. Нет данных — весь объект `null` (обычно отмечается в `red_flags`).

### `salary_usd_month` · Р
Нормализованный диапазон зарплаты в USD в месяц: `{ min, max }`. Рассчитывается `derived.ts` при скоринге и `rescore` для вакансий с зарплатой в USD (`year` делится на 12). Для других валют или почасовой оплаты — `null`. Используется фильтром минимальной зарплаты в UI.

### `employment` · С/А
`full-time | contract | b2b | eor | unknown`. Скрипт угадывает по тегам/метаданным, агент уточняет по тексту. EOR (Deel, Remote.com) — допустимо, не стоп-фактор.

### `vacancy_language` · А
Язык **текста** вакансии (`en`, `ru`, `es`…). На нём готовятся резюме и сопроводительное письмо при отклике.

### `work_languages` · А
Требуемый язык **общения** команды — **только если указан явно** («fluent German required»). Не указан → `null` (не догадываться по языку текста, чтобы не штрафовать за неуказанный язык).

### `role_tracks` · А
Подмножество `vue | react | angular | fullstack | ai_engineer | automation` — к каким направлениям относится вакансия. Используется для фильтров в UI.

### `best_track` · Р
Трек с наибольшим взвешенным баллом `scores.fit` с учётом весов треков в `weights.yaml`. Вычисляется автоматически `derived.ts` при скоринге и `rescore`.

### `tags` · С
Теги площадки как есть. Используются предфильтром и поиском.

## Описание (для человека, по-русски)

| Поле | Что писать |
|---|---|
| `summary` | 1–3 предложения: что за компания и какая роль. Обязательно после скоринга |
| `key_points` | 3–6 пунктов: стек, формат, таймзона, зарплата |
| `red_flags` | что настораживает: нет зарплаты, «only US», «our client», размытые обязанности. Пустой список, если ничего |

## Оценки — `scores`

`null` = ещё не отскорена (такие выдаёт `npm run pending`). Частные оценки 0–100, шаг 5–10. Как из них получается итог — [how-it-works.md](how-it-works.md#скоринг).

| Поле | Кто | Что значит | Ориентиры |
|---|---|---|---|
| `remote` | А | насколько работа реально удалённая | «remote, anywhere» 95–100; remote с жёсткой страной/таймзоной 60–80; гибрид/офис 0–20 |
| `startup` | А | признаки стартапа | seed/Series A, команда до ~50, основатели в описании → высоко |
| `corporate` | А | крупный бизнес у **нанимающей** стороны — с кем договор | крупная компания напрямую → 80–100. Аутстаф, работающий на крупного клиента, → низко (договор с аутстафом) |
| `outsource` | А | наниматель — аутсорс/аутстаф/body-shop/агентство «our client» | EPAM-подобные и мелкие конторы 80–100 |
| `end_client_corporate` | — | **устарело** (weights v3): не заполняется; в старых файлах может остаться | — |
| `legitimacy` | А | реальность компании и вакансии (обратное к скаму) | сайт, LinkedIn-страница, внятное описание → высоко. **< 30 автоматически ставит `scam`** |
| `region` | Р | из `config/regions.yaml` по `company_country` / `ru_speaking_team` | агент не заполняет |
| `language` | А | подходит ли язык общения | ru/en/es → 100; требуется другой → 0–40 |
| `fit.<трек>` (`vue`, `react`, `angular`, `fullstack`, `ai_engineer`, `automation`) | А | соответствие **каждому** треку; все шесть ключей обязательны | см. ниже |
| `overall` | Р | итоговый балл (0–100) | только `npm run score` / `rescore` |

**Треки `fit`:**
- `vue`, `react`, `angular` — фронтенд с явным фреймворком;
- `fullstack` — фронт + бэк с конкретным стеком;
- `automation` — бизнес-автоматизация: n8n/Make/Zapier, ИИ-агенты для бизнеса, интеграции, VPS, IoT; не QA-автоматизация и не RPA;
- `ai_engineer` — «Software / AI engineer» без жёсткой привязки к фреймворку, база Node.js; разработка с LLM/агентами.

### `stop_flags` · А/Р
Любой флаг из `config/weights.yaml → stop_flags` обнуляет `overall`. Ставить только при явных признаках, с обоснованием в `score_reasoning`.

| Флаг | Когда |
|---|---|
| `office_outside_ar` | офис/гибрид без варианта удалёнки **вне** AMBA (Буэнос-Айрес и спутники) и Мар-дель-Платы |
| `location_restricted` | **обязательная** авторизация на работу / проживание в стране без Аргентины (US only, EU work permit) |
| `nationality_excluded` | явный запрет на кандидатов из Аргентины или с гражданством РФ |
| `ru_corporate` | российская госкомпания, компания с госкапиталом или российский банк (нанимателем или клиентом) |
| `inadequate` | общий созвон со всеми кандидатами, платное «обучение», многодневное бесплатное тестовое |
| `scam` | `legitimacy < 30` — ставит расчёт автоматически |

### `best_resume` · А · обязательно после скоринга
Трек, резюме которого (`profile/resumes/<трек>.md`) лучше всего подходит для отклика.

### `score_reasoning` · А · обязательно после скоринга
2–4 предложения по-русски: на чём основаны ключевые оценки и флаги, что было неоднозначно.

### `resume_match` · А · обязательно при `scoring_version` ≥ 2
Детальное сопоставление требований вакансии с базой опыта и профилем. С версии `scoring_version: 3` включает расширенные поля для адаптации резюме:
- `resume`: трек резюме (`vue | react | angular | fullstack | ai_engineer | automation`);
- `required`: обязательные навыки (канонические имена из `config/skills.yaml`);
- `nice_to_have`: желательные навыки (из `config/skills.yaml`);
- `in_resume_negative`: `[{ skill, evidence }]` — навыки/факты, которые упомянуты в резюме, но вакансия явно против них;
- `responsibilities`: обязанности роли (короткие фразы на английском в нижнем регистре из `config/responsibilities.yaml`, например `"develop web application"`);
- `keyword_spellings`: объект `{ канонический_навык: [написания из текста] }`, если они отличаются (например, `vue: ["Vue 3", "Vue.js"]`);
- `domain`: предметная область из `config/domains.yaml` (`fintech`, `legaltech`, `ecommerce`, `devtools`…);
- `product_type`: тип продукта из `config/product-types.yaml` (`b2b-saas`, `b2c`, `marketplace`, `platform`…);
- `soft_requirements`: софт-скиллы из `config/soft-requirements.yaml` (`ownership`, `async-communication`, `mentoring`…);
- `years_required`: минимальный требуемый опыт в годах (число) или `null`.

Пробелы в резюме (`missing_required`, `missing_nice`) динамически вычисляет `npm run insights` и UI по текущему резюме и `profile/facts.md`.

### `scoring_version` · А
Версия скоринга (актуальная — `3`). Позволяет отслеживать методику скоринга и обновлять старые записи батчами (`npm run pending -- --upgrade`).

### `requirements_special` · А
Нестандартные требования к отклику: `{ type, standard, details }`.
- `type`: `keyword | video | note | other | cover_letter | test` (также допустим синоним `custom_cover_letter`);
- `standard: true`: закрывается стандартной заготовкой из `profile/media/`;
- `standard: false`: требует подготовки под конкретную вакансию. На этапе отклика уходит в `needs_attention: special_media`.

## Статус, отклики и пользовательская разметка

### `status`
```
null ◀──▶ selected ──▶ applied
 │          │   └──▶ needs_attention ──(дополнил answers.md / разобрался)──▶ selected / applied
 │          └──────▶ apply_failed   (техническая ошибка — можно повторить)
```

| Значение | Кто ставит | Смысл |
|---|---|---|
| `null` | С / UI | решение не принято; отсутствие скоринга определяется по `scores: null` |
| `selected` | UI | выбрана для отклика |
| `needs_attention` | О | требуется решение человека (см. `attention_reason`) |
| `applied` | О / UI | отклик отправлен (агентом или вручную) |
| `apply_failed` | О | ошибка при отправке отклика, можно повторить |

### `attention_reason`, `attention_details` · О
Причина передачи человеку: `unknown_question` | `special_media` | `captcha` | `login` | `ambiguous` | `other`. В `attention_details` — конкретный вопрос или описание проблемы.

### `applied_via` · О/UI
Способ отправки отклика: `agent` (откликнулся скрипт/агент) или `manual` (пользователь откликнулся сам и нажал «Откликнулся сам» в UI).

### `outcome`, `outcome_at` · UI
Результат отклика (только при `status: applied`). Заполняется пользователем в UI:
- `no_reply` — нет ответа;
- `rejected` — отказ;
- `screen` — скрининг / эйчар-интервью;
- `interview` — техническое интервью;
- `offer` — оффер.

`outcome_at` — дата фиксации результата. По этим полям `npm run insights` строит конверсию откликов.

### `starred`, `flagged`, `notes` · UI
- `starred`: отметка ★ («избранное»), закрепляет вакансию сверху списка;
- `flagged`: отметка ⚑ («проблемная»), сигнализирует о неверном скоринге/данных для разбора агентом (`playbooks/flagged.md`);
- `notes`: личные заметки пользователя, автосохраняются при потере фокуса.

### `apply_log` · О
Ссылка на лог отклика `data/runs/<дата>-apply.md` и краткий результат.

## Отображение полей в UI

В интерфейсе (`app/`, `VacancyCard.vue`, `VacancyTable.vue`) данные распределены по зонам:

| Зона UI | Поля вакансии |
|---|---|
| **Таблица вакансий** (`VacancyTable.vue`) | `scores.overall`, `best_track` / `best_resume`, `posted_at` / `collected_at`, `status`, `starred`, `flagged`, `possibly_closed`, `title`, `company`, `source`, `duplicates`, `apply_method`, `apply_channels`, `region`, `vacancy_language`, `work_languages`, `scores.remote`, `scores.startup`, `scores.corporate`, `scores.outsource`, `scores.legitimacy`, `stop_flags` |
| **Шапка карточки** (`VacancyCard.vue`) | `best_resume`, `title`, `scores.overall`, `scores.fit[best_resume]`, `company`, `company_country`, `location`, `salary`, `employment` |
| **Бейджи карточки** | `region`, `employer_group`, `work_languages`, `ru_speaking_team`, `tags` |
| **Плашка критериев** | `scores.remote`, `scores.startup`, `scores.legitimacy`, `scores.corporate`, `scores.outsource` |
| **Панель действий** | `status` (кнопки «Откликнуться», «Откликнулся сам»), `starred` (★), `flagged` (⚑), `applied_via`, `applied_at`, `outcome` (селект результата) |
| **Блоки предупреждений** | `attention_reason` + `attention_details` (при `needs_attention` / `apply_failed`), `stop_flags`, `possibly_closed` + `alive_checked_at` |
| **Вердикт и описание** | `score_reasoning` (AI-вердикт), `summary`, `key_points`, `red_flags` |
| **Сравнение с резюме** (`ResumeMatch.vue`) | `resume_match.*`: `resume`, `years_required`, `domain`, `product_type`, `required`, `nice_to_have`, `soft_requirements`, `responsibilities`, `in_resume_negative`, `keyword_spellings` |
| **Особые требования** | `requirements_special` (`type`, `standard`, `details`) |
| **Каналы отклика** (`ApplyChannels.vue`) | `apply_channels` (`type`, `value`, `note`, `by`), `apply_method` |
| **Ссылки и заметки** | `source_url`, `source`, `real_url`, `real_url_tried_at`, `duplicates` (`source`, `url`, `seen_at`, `id`), `notes`, `applied_at`, `apply_log` |
| **Свернутый блок деталей** (`tech-details`) | `id`, все оценки `scores.fit.*`, `scores.region`, `scores.language`, файл на диске, `source`, `apply_method` → `apply_target`, `collected_at`, `collected_run`, `posted_at`, `alive_checked_at`, `possibly_closed`, `real_url_tried_at`, `scoring_version`, `seniority`, `company_stage`, `hire_from_ar` + `hire_from_ar_evidence`, `timezone`, `salary_usd_month`, `scores.end_client_corporate`, `prefilter_reason`, `applied_via`, `outcome` + `outcome_at`, `resume_match.keyword_spellings`, сырые `stop_flags` |
| **Тело вакансии** (`VacancyBody.vue`) | Исходный markdown-текст описания вакансии |

## Тело файла

После front matter — оригинальный текст вакансии, сконвертированный из HTML в markdown, плюс строка со ссылкой на источник (RemoteOK требует указывать его по условиям API). Агент тело не меняет. UI показывает его как чужой контент: сырой HTML экранируется, картинки не грузятся.
