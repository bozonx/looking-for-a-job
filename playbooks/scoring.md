# Playbook: скоринг вакансии

Заполняешь в front matter (остальное уже заполнил скрипт сбора). Оценки 0–100, шаг 5–10.

| Поле | Как заполнять |
|---|---|
| `company_country` | ISO 3166-1 alpha-2 (заглавными: `US`, `CY`) страны **регистрации нанимающей стороны** (для аутстафа — аутстаф-компании, не клиента). Не путать с локацией вакансии. Не нашёл — `null` |
| `ru_speaking_team` | `true`, если явно видно, что компания/команда русскоязычная (текст на русском, основатели из СНГ, «русскоязычная команда»); иначе `null` |
| `region` | не заполняй — `npm run score` вычислит группу из `company_country` / `ru_speaking_team` |
| `employment` | уточни: full-time / contract / b2b / eor / unknown |
| `vacancy_language` | язык текста (en/ru/es/…) |
| `work_languages` | только если язык общения указан ЯВНО; иначе null |
| `role_tracks` | подмножество vue, react, angular, fullstack, ai_engineer |
| `summary` | 1–3 предложения по-русски: что за компания и роль |
| `key_points` | 3–6 пунктов: стек, формат, таймзона, зарплата |
| `red_flags` | что настораживает (пустой список, если ничего) |
| `scores.remote` | реальная удалёнка: «remote, anywhere» ≈ 95–100; remote с жёсткой таймзоной/регионом, включающим Аргентину ≈ 60–80; гибрид/офис ≈ 0–20. Удалёнка как один из вариантов («hybrid/remote») или «сначала удалённо, потом релокация» — это удалёнка (≈ 70–90). Обязательный переезд до начала работы — `office_outside_ar` |
| `scores.startup` | признаки стартапа (seed/Series A, маленькая команда) |
| `scores.corporate` | крупный бизнес у НАНИМАЮЩЕЙ стороны (design.md §8.2) |
| `scores.outsource` | наниматель — аутсорс/аутстаф/body-shop/рекрутинговое агентство «our client» |
| `scores.end_client_corporate` | только при outsource ≥ 50: крупный ли конечный клиент; иначе null |
| `scores.legitimacy` | реальность компании и вакансии; < 30 = скам |
| `scores.region` | не заполняй — `npm run score` проставит из `config/regions.yaml` |
| `scores.language` | ru/en/es → 100; требуется другой язык → 0–40 |
| `scores.fit.*` | соответствие каждому треку (design.md §8.3), все пять ключей обязательны. `ai_engineer` высокий только для ролевых вакансий, где язык вторичен; Python/Go/Rust как основной язык или в заголовке → `ai_engineer` ≤ 30 (коммерческого опыта нет), отметь в `score_reasoning`. Слова «AI» или «LLM» сами по себе fit не поднимают. Node.js/TS в стеке не делает роль fullstack: узкий бэкенд-домен без фронтенда (игровые движки и игровая математика, RTP/симуляции, C++/низкоуровневое, data/ML-инфраструктура) → все треки ≤ 30. Индустрия (iGaming, беттинг и т.п.) сама по себе fit не снижает — оценивай роль **Уровень ниже middle** (junior, Jr., entry-level, early-career, intern, «1–2 years» как основное требование) → все треки ≤ 30, пункт в `red_flags` — даже если «junior» есть только в тексте, а не в заголовке |
| `stop_flags` | только при явных признаках, обоснуй в `score_reasoning`: |
| ↳ `office_outside_ar` | офис/гибрид без варианта удалёнки, и место — не AMBA (Буэнос-Айрес, Ла-Плата и др. спутники) и не Мар-дель-Плата; а также обязательный переезд до начала работы (даже с помощью в релокации) |
| ↳ `location_restricted` | **обязательная** авторизация на работу / проживание в стране или регионе без Аргентины (US only, EU work permit required). Сюда же неявный найм только из США: «Any State», «US remote», «remote (US)», список штатов, 401k/US benefits как единственный вариант — без упоминания найма из других стран (contractor/EOR) это US only. «Preferred» или «nice to have» — не флаг, а минус в `scores.remote` и пункт в `red_flags` |
| ↳ `nationality_excluded` | явный запрет на кандидатов из Аргентины или с российским гражданством |
| ↳ `ru_corporate` | российская госкомпания, компания с госкапиталом (Газпром, Ростех, РЖД, Росатом и т.п.) или любой российский банк — нанимателем **или** конечным клиентом аутсорса/аутстафа. Частный крупный российский бизнес — не флаг, только `corporate` |
| ↳ `inadequate` / `scam` | см. design.md §8.1 |
| `best_resume` | трек с лучшим fit |
| `score_reasoning` | 2–4 предложения: на чём основаны ключевые оценки и флаги |
| `requirements_special` | нестандартные требования отклика (видео, кодовое слово, тест в форме) |
| `resume_match` | сравнение с резюме `best_resume` — см. раздел ниже |
| `scoring_version` | 3 |

`scores.overall` не трогай — его считает `npm run score`.
Неоднозначное (например, «remote, US timezone» без требования резидентства) отражай в оценках и `red_flags`, не додумывай.

## `resume_match` — сравнение с резюме

Сырьё для `npm run insights`: какие навыки массово требуют, а в резюме их нет. Прочитай `profile/resumes/<best_resume>.md`
(одно резюме на вакансию) и заполни:

```yaml
resume_match:
  resume: angular                 # = best_resume
  required: [angular, rxjs, ngrx, typescript, aws]   # must-have из вакансии
  nice_to_have: [graphql]         # «plus», «nice to have», «bonus»
  missing_required: [ngrx, aws]   # из required, чего нет в резюме
  missing_nice: []                # из nice_to_have, чего нет в резюме
  in_resume_negative: []          # [{ skill, evidence }] — см. ниже
  ats_keywords_missing: [state management]
  # --- v3: сырьё для блока опыта и формулировок резюме ---
  responsibilities: [build design system, migrate angularjs to angular, own frontend architecture]
  keyword_spellings: { ngrx: [NgRx], aws: [Amazon Web Services] }
  domain: fintech                 # null, если неясно
  product_type: b2b-saas          # null, если неясно
  soft_requirements: [ownership, cross-functional collaboration]
  years_required: 5               # null, если не указано
```

- **Навыки — только канонические имена из `config/skills.yaml`** (`golang` → `go`, `k8s` → `kubernetes`).
  Нет в словаре — добавь туда ключ (или синоним существующего), а не выдумывай написание.
- Навык — технология, практика или домен (`fintech`, `accessibility`), не soft skills и не «5+ years».
  Языки общения и опыт в годах сюда не пиши. Только реальные требования из текста, а не теги агрегатора.
- `missing_*` — честно: навык считается «есть», если он упомянут в резюме (в Skills или опыте), в том числе синонимом.
- `ats_keywords_missing` — 0–5 **формулировок** из вакансии, которых нет дословно в тексте резюме, хотя
  по смыслу опыт есть или близок («state management», «design system», «cross-functional»). Это то, что ATS не найдёт.
- `in_resume_negative` — только при **явной цитате**: вакансия называет минусом или нежелательным то, что есть
  в резюме («no agencies», «not looking for AngularJS-only devs», «job hoppers»). `evidence` — цитата на языке вакансии.
  Локацию, гражданство, возраст сюда не пиши — это `stop_flags`.
- `responsibilities` — 3–8 обязанностей из блока «what you'll do / responsibilities / задачи» (если его нет —
  из описания роли). Каждая — короткая фраза «глагол + объект» **на английском, нижним регистром**, без названий
  компаний и цифр: `build reusable ui components`, `integrate rest apis`, `mentor junior developers`.
  Формулируй единообразно, чтобы одинаковые задачи из разных вакансий склеивались при подсчёте (не
  «create components» в одной и «build components» в другой — выбирай `build`). Требования к навыкам сюда не пиши.
- `keyword_spellings` — только для навыков из `required`/`nice_to_have`, которые в тексте написаны **не так**, как
  каноническое имя (`Vue.js`, `Node.js`, `K8s`, `Postgres`). Значение — написания дословно, как в тексте. Совпадает — не пиши.
- `domain` — предметная область продукта одним-двумя словами (`fintech`, `e-commerce`, `healthtech`, `edtech`,
  `devtools`, `adtech`, `gaming`, `logistics`, `crypto`, `ai`); для аутсорса — домен проекта, если назван.
- `product_type` — `b2b-saas`, `b2c`, `marketplace`, `platform`, `internal-tools`, `agency`, `outsourcing`.
- `soft_requirements` — 0–5 нетехнических ожиданий, явно названных в тексте: `ownership`, `cross-functional collaboration`,
  `mentoring`, `async communication`, `product mindset`, `stakeholder communication`. Языки сюда не пиши.
- `years_required` — минимальное число лет из текста («5+ years» → 5, «3–5 years» → 3); не указано — null.
- Вакансия с трудом читается или требований нет — пустые списки и пометка в `score_reasoning`.

## Дозаполнение v3 у уже отскоренных

`npm run pending -- --upgrade [--limit N | --all]` — релевантные вакансии со `scoring_version` < 3 (по убыванию overall).
Для каждой: прочитай текст, допиши в `resume_match` только поля v3, поставь `scoring_version: 3`. Остальные оценки
не меняй, `npm run score` не нужен. Потом `npm run validate`.
