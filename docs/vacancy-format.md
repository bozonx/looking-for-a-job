# Формат вакансии

Одна вакансия = один markdown-файл в `data/vacancies/ГГГГ/ММ/`. Имя: `<collected_at>-<источник>-<компания>-<должность>-<id на площадке>.md` (кириллица транслитерируется; у старых файлов суффикса id нет). На группу дублей с разных площадок — **один** файл (каноническая запись), копии перечислены в `duplicates`.

```
---
<YAML front matter — всё, что посчитали скрипт и агент>
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
| **С** | скрипт сбора (`npm run collect`, провайдер `scripts/providers/<источник>.ts`) — факты с площадки |
| **А** | агент при скоринге (`playbooks/scoring.md`) |
| **Р** | расчёт `npm run score` / rescore — производные поля, руками не править |
| **UI** | вы через интерфейс |
| **О** | агент на этапе отклика (этап 3) |

Правило: чего нет в источнике и нельзя уверенно вывести — `null`, сомнение — в `score_reasoning`. Не додумывать.

## Полный пример

```yaml
---
id: remoteok-1137713
title: Senior Vue.js Developer
company: Acme AI
company_country: DE
source: remoteok
source_url: https://remoteok.com/remote-jobs/1137713
real_url: https://jobs.ashbyhq.com/acme/abc
apply_method: ats-ashby
duplicates:
  - { source: wellfound, url: https://wellfound.com/jobs/123, seen_at: 2026-11-14 }
apply_target: ats-ashby
collected_at: 2026-11-13
posted_at: 2026-11-12
location: Remote (EU)
region: europe
salary: { min: 60000, max: 84000, currency: USD, period: year }
employment: contract
vacancy_language: en
work_languages: [en]
role_tracks: [vue, ai_engineer]
tags: [vue, nuxt, typescript]
summary: Стартап на seed-стадии, AI-ассистент для юристов. Нужен фронтенд на Vue 3 + Nuxt с LLM-интеграциями.
key_points: [Vue 3, Nuxt, TypeScript, Работа с LLM API, Таймзона CET ±3]
red_flags: []
scores:
  remote: 95
  startup: 80
  corporate: 10
  outsource: 0
  end_client_corporate: null
  legitimacy: 85
  region: 85
  language: 100
  fit: { vue: 90, react: 20, angular: 0, fullstack: 55, ai_engineer: 70 }
  overall: 91
stop_flags: []
best_resume: vue
score_reasoning: Явно указана полная удалёнка в пределах EU-таймзон, команда 8 человек, есть сайт и Crunchbase …
requirements_special: []
status: new
attention_reason: null
attention_details: null
starred: false
notes: ""
possibly_closed: false
applied_at: null
apply_log: null
scoring_version: 1
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
`true`, если явно видно, что компания/команда русскоязычная (текст на русском, основатели из СНГ, «русскоязычная команда») — тогда высший приоритет региона, где бы ни была компания. Иначе `null`.

### `source`, `source_url` · С · обязательно
Площадка, откуда пришла каноническая запись, и ссылка на вакансию на ней. `source` должен совпадать с id площадки в `config/sources.md` и `config/source-priority.yaml`.

### `real_url` · С/А
Прямая ссылка на вакансию у работодателя — сайт компании или ATS (Greenhouse, Lever, Ashby…). Откуда берётся:
1. скрипт сбора — если площадка отдаёт ссылку отклика, и она не ведёт обратно на саму площадку;
2. агент — ищет на careers-странице / `boards.greenhouse.io/<company>` / `jobs.lever.co/<company>` / `jobs.ashbyhq.com/<company>`, если ссылки нет или она ведёт на агрегатор, а вакансия выглядит интересной.

Записывается только при уверенности, что это та же вакансия. Ничего не отправляется. Важна, потому что даёт место отклика с высоким приоритетом (см. `apply_target`) и уводит отклики с LinkedIn.

### `apply_channels` · С/А/Р
Все известные способы отклика — куда физически слать резюме:
```yaml
apply_channels:
  - { type: ats, value: https://jobs.ashbyhq.com/acme/…, by: collect }
  - { type: email, value: jobs@acme.com, by: text, note: "тема: Senior FE — Имя" }
```
`type`: `ats` · `form` (форма на сайте компании) · `email` · `telegram` (`@handle`) · `whatsapp` (ссылка/номер) · `facebook` (страница, пост, Messenger) · `linkedin` · `platform` (отклик на hh/habr/djinni/getonbrd… — нужен аккаунт) · `dm` (личка: `x @handle`) · `other`.
`by`: `collect` (API площадки, `real_url`, дубли), `resolve` (`npm run resolve-urls` со страницы площадки), `text` (извлечено из текста, `scripts/lib/channels.ts`), `agent` (агент при скоринге). `note` — требования к отклику.
Заполняется при сборе и `npm run channels` (без сети: ссылки + текст; извлечение из текста консервативное — служебные адреса отбрасываются), дополняется `resolve-urls` и агентом. Агент правит список руками; скрипты существующие каналы не удаляют.

### `apply_method` · Р
Тип основного канала (того, что выбран в `apply_target`): `ats-<name>` | `external` (форма на сайте) | `email` | `telegram` | `whatsapp` | `facebook` | `linkedin` | `platform` | `dm` | `other` | `unknown` (только витрина-агрегатор, канал не найден). Пересчитывается из `apply_channels` при сборе, в `score`/`rescore`, `resolve-urls`, `npm run channels`. Руками не править.

### `duplicates` · С
Та же вакансия на других площадках: `{ source, url, seen_at? }`. Пополняется скриптом сбора, когда находит совпадение (по id, по любому известному URL или по `company+title`). Все URL отсюда тоже участвуют в дедупликации. Дубль повторно не скорится. UI показывает число дублей.

### `apply_target` · Р
Куда откликаться. Выбирается среди `apply_channels`, `real_url`, `source` и всех `duplicates` по порядку из `config/source-priority.yaml`: сайт компании и ATS > email/Telegram/WhatsApp/личка/Facebook > нишевые площадки > агрегаторы > LinkedIn. Хранит конкретное значение (`ats-ashby`, `company-site`, `wellfound`, `linkedin`…); ATS, которой нет в списке, ранжируется как `ats-other`. Пересчитывается при сборе, при добавлении дубля и в `score`/`rescore`. Руками не править — правьте приоритеты или `real_url`.

## Даты

| Поле | Кто | Смысл |
|---|---|---|
| `collected_at` | С | когда собрана (`YYYY-MM-DD`), обязательно |
| `posted_at` | С | дата публикации на площадке; по ней работают окно сбора и `freshness_days` (очередь скоринга) |
| `applied_at` | О | когда откликнулись; по нему считается `LINKEDIN_APPLY_MAX_PER_DAY` |

## Условия работы

### `location` · С
Строка с площадки как есть («Remote (EU)», «Worldwide», «Buenos Aires, hybrid»). Сырьё для `scores.remote` и стоп-флагов `office_outside_ar` / `location_restricted`.

### `region` · Р
Группа работодателя: `argentina | ru_speaking_team | ru_speaking | anglo | spanish | europe | uae | asia | other | unknown`. Вычисляет `score.ts` по `config/regions.yaml`: `ru_speaking_team: true` → `ru_speaking_team`; иначе по списку стран группы; страна не в списках → `other`; `company_country: null` → `unknown`. Числовой `scores.region` — оттуда же.

### `salary` · С/А
`{ min, max, currency, period }`, `period ∈ year | month | hour`; любая граница может быть `null`. Нет данных — весь объект `null` (и это обычно `red_flags`). У RemoteOK зарплата всегда годовая в USD. В скоринг не входит — показывается для решения.

### `employment` · С/А
`full-time | contract | b2b | eor | unknown`. Скрипт угадывает по тегам, агент уточняет по тексту. EOR (Deel, Remote.com) — допустимо, не стоп-фактор.

### `vacancy_language` · А
Язык **текста** вакансии (`en`, `ru`, `es`…). На нём будут резюме и письмо при отклике.

### `work_languages` · А
Требуемый язык **общения** — **только если указан явно** («fluent German required»). Не указан → `null`, а не догадка по языку текста. Иначе агент начнёт штрафовать вакансии за язык, который никто не требовал.

### `role_tracks` · А
Подмножество `vue | react | angular | fullstack | ai_engineer` — к каким направлениям относится вакансия. Для фильтров в UI; в балл не входит (там `scores.fit`).

### `tags` · С
Теги площадки как есть. Используются предфильтром и поиском.

## Описание (для человека, по-русски)

| Поле | Что писать |
|---|---|
| `summary` | 1–3 предложения: что за компания и какая роль. Обязательно после скоринга |
| `key_points` | 3–6 пунктов: стек, формат, таймзона, зарплата |
| `red_flags` | что настораживает: нет зарплаты, «only US», «our client», размытые обязанности. Пустой список, если ничего |

## Оценки — `scores`

`null` = ещё не отскорена (такие выдаёт `npm run pending`). Частные оценки 0–100, точность до единицы не важна — шаг 5–10. Как из них получается итог — [how-it-works.md](how-it-works.md#скоринг).

| Поле | Кто | Что значит | Ориентиры |
|---|---|---|---|
| `remote` | А | насколько работа реально удалённая | «remote, anywhere» 95–100; remote с жёсткой страной/таймзоной 60–80; гибрид/офис 0–20 |
| `startup` | А | признаки стартапа | seed/Series A, команда до ~50, основатели в описании → высоко |
| `corporate` | А | крупный бизнес у **нанимающей** стороны — с кем договор | крупная компания напрямую → 80–100. Аутстаф, работающий на крупного клиента, → низко (договор с аутстафом) |
| `outsource` | А | наниматель — аутсорс/аутстаф/body-shop/агентство «our client» | EPAM-подобные и мелкие конторы 80–100 |
| `end_client_corporate` | А | **только при `outsource ≥ 50`**: крупный ли конечный клиент. Иначе `null` | аутстаф на проект банка → 90 |
| `legitimacy` | А | реальность компании и вакансии (обратное к скаму) | сайт, LinkedIn-страница, внятное описание → высоко. **< 30 автоматически ставит `scam`** |
| `region` | Р | из `config/regions.yaml` по `company_country` / `ru_speaking_team` | агент не заполняет |
| `language` | А | подходит ли язык общения | ru/en/es → 100; требуется другой → 0–40 |
| `fit.vue/react/angular/fullstack/ai_engineer` | А | соответствие **каждому** треку; все пять ключей обязательны | см. ниже |
| `overall` | Р | итоговый балл | только `npm run score` |

**Почему три оценки вместо одной «корпоративности».** В аутстафе две организации: та, с кем подписываешь договор, и конечный клиент. «Аутстаф на банк» = `corporate` низкий, `outsource` высокий, `end_client_corporate` высокий — не противоречие. Крупная аутсорс-компания (EPAM) может получить и высокий `corporate`, и высокий `outsource` — тоже корректно. Как это комбинировать, решают веса.

**Треки `fit`:**
- `vue`, `react`, `angular` — фронтенд с явным фреймворком;
- `fullstack` — фронт + бэк с конкретным стеком;
- `automation` — бизнес-автоматизация: n8n/Make/Zapier, ИИ-агенты для бизнеса, интеграции, VPS, IoT; не QA-автоматизация и не RPA.
- `ai_engineer` — «Software / AI engineer» без жёсткой привязки к фреймворку, база Node.js; сюда же JavaScript/Node.js developer и вакансии, где суть — разработка с LLM/агентами. Из других языков — Rust, Python, Go.

Вакансия явно не по профилю всё равно скорится (низкий `fit`), а не удаляется — это материал для настройки предфильтра.

### `stop_flags` · А/Р
Любой флаг из `config/weights.yaml → stop_flags` обнуляет `overall`. Ставить только при явных признаках, с обоснованием в `score_reasoning`.

| Флаг | Когда |
|---|---|
| `office_outside_ar` | офис/гибрид без варианта удалёнки **вне** AMBA (Буэнос-Айрес, Ла-Плата и др. спутники) и Мар-дель-Платы. «Hybrid/remote» и «сначала удалённо, потом релокация» — удалёнка |
| `location_restricted` | **обязательная** авторизация на работу / проживание в стране без Аргентины (US only, EU work permit). «Preferred» — не флаг |
| `nationality_excluded` | явный запрет на кандидатов из Аргентины или с гражданством РФ |
| `ru_corporate` | российская госкомпания, компания с госкапиталом (Газпром, Ростех, РЖД, Росатом и т.п.) или любой российский банк — нанимателем **или** конечным клиентом аутсорса/аутстафа. Частный российский бизнес — не флаг |
| `inadequate` | общий созвон со всеми кандидатами, платное «обучение», многодневное бесплатное тестовое, неуважение к кандидату |
| `scam` | `legitimacy < 30` — ставит расчёт автоматически |

### `best_resume` · А · обязательно после скоринга
Трек с лучшим `fit` → какое резюме из `profile/resumes/` брать за основу при отклике.

### `score_reasoning` · А · обязательно после скоринга
2–4 предложения по-русски: на чём основаны ключевые оценки и флаги, что было неоднозначно. Главный инструмент проверки агента — читайте его, когда балл кажется странным.

### `resume_match` · А · обязательно при `scoring_version` ≥ 2
Сравнение вакансии с резюме `best_resume`: `resume`, `required`, `nice_to_have`, `missing_required`, `missing_nice`,
`in_resume_negative` (`{ skill, evidence }` — только с цитатой), `ats_keywords_missing`. Навыки — канонические имена из
`config/skills.yaml` (синоним — ошибка `validate`, неизвестный навык — предупреждение). Правила — `playbooks/scoring.md`.
Агрегирует `npm run insights`: какие навыки массово требуют, а в резюме их нет.

### `scoring_version` · А
Версия методики (сейчас `2`: добавлен `resume_match`; у версии `1` его нет — `validate` предупреждает). Если поменяется сама методика частных оценок (а не веса), по ней можно найти вакансии для повторного скоринга агентом. Смена весов — это не новая версия, а `npm run rescore`.

### `requirements_special` · А
Нестандартные требования к отклику: `{ type, standard, details }`.
- `type` — `video`, `audio`, `test`, `codeword`, …
- `standard: true` — закрывается заготовкой («приложите видео-визитку» → `profile/media/`).
- `standard: false` — нужно делать под вакансию («видео 2 мин про проект с LLM, назовите кодовое слово BLUE»). На этапе отклика такие вакансии уйдут в `needs_attention: special_media`.

Пустой список, если ничего.

## Статус и ваша разметка

### `status`
```
new ──▶ selected ──▶ applied
 │          │   └──▶ needs_attention ──(дополнил answers.md / разобрался)──▶ selected / applied
 │          └──────▶ apply_failed   (техническая ошибка — можно повторить)
 └──▶ rejected
```

| Значение | Кто ставит | Смысл |
|---|---|---|
| `new` | С (и UI — «вернуть») | собрана, не разобрана |
| `selected` | UI | хочу откликнуться |
| `rejected` | UI | не интересно |
| `needs_attention` | О | нужно моё решение (см. `attention_reason`) |
| `applied` | О | отклик отправлен |
| `apply_failed` | О | техническая ошибка, можно повторить |

### `attention_reason`, `attention_details` · О
Почему нужен человек: `unknown_question` (вопрос формы, на который нет ответа в `answers.md`) | `special_media` | `captcha` | `login` | `ambiguous` | `other`. В `attention_details` — конкретика: полный текст вопроса, что именно не получилось. Иначе `null`.

### `starred`, `notes` · UI
Звезда (отмеченные — сверху списка) и ваши заметки (сохраняются при потере фокуса).

### `possibly_closed` · А/О
Агент случайно увидел, что вакансия закрыта. Ненадёжный признак — специально не отслеживается. Такие исключаются из отклика.

### `apply_log` · О
Ссылка на `data/runs/<дата>-apply.md` и краткий итог отклика.

## Тело файла

После front matter — оригинальный текст вакансии, сконвертированный из HTML в markdown, плюс строка со ссылкой на источник (RemoteOK требует указывать его по условиям API). Агент тело не меняет. UI показывает его как чужой контент: сырой HTML экранируется, картинки не грузятся.
