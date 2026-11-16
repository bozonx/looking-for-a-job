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
| `scores.remote` | реальная удалёнка: «remote, anywhere» ≈ 95–100; remote с жёсткой таймзоной/регионом, включающим Аргентину ≈ 60–80; гибрид/офис ≈ 0–20. Удалёнка как один из вариантов («hybrid/remote») или «сначала удалённо, потом релокация» — это удалёнка (≈ 70–90) |
| `scores.startup` | признаки стартапа (seed/Series A, маленькая команда) |
| `scores.corporate` | крупный бизнес у НАНИМАЮЩЕЙ стороны (design.md §8.2) |
| `scores.outsource` | наниматель — аутсорс/аутстаф/body-shop/рекрутинговое агентство «our client» |
| `scores.end_client_corporate` | только при outsource ≥ 50: крупный ли конечный клиент; иначе null |
| `scores.legitimacy` | реальность компании и вакансии; < 30 = скам |
| `scores.region` | не заполняй — `npm run score` проставит из `config/regions.yaml` |
| `scores.language` | ru/en/es → 100; требуется другой язык → 0–40 |
| `scores.fit.*` | соответствие каждому треку (design.md §8.3), все пять ключей обязательны |
| `stop_flags` | только при явных признаках, обоснуй в `score_reasoning`: |
| ↳ `office_outside_ar` | офис/гибрид без варианта удалёнки, и место — не AMBA (Буэнос-Айрес, Ла-Плата и др. спутники) и не Мар-дель-Плата |
| ↳ `location_restricted` | **обязательная** авторизация на работу / проживание в стране или регионе без Аргентины (US only, EU work permit required). «Preferred» или «nice to have» — не флаг, а минус в `scores.remote` и пункт в `red_flags` |
| ↳ `nationality_excluded` | явный запрет на кандидатов из Аргентины или с российским гражданством |
| ↳ `ru_corporate` / `inadequate` / `scam` | см. design.md §8.1 |
| `best_resume` | трек с лучшим fit |
| `score_reasoning` | 2–4 предложения: на чём основаны ключевые оценки и флаги |
| `requirements_special` | нестандартные требования отклика (видео, кодовое слово, тест в форме) |
| `scoring_version` | 1 |

`scores.overall` не трогай — его считает `npm run score`.
Неоднозначное (например, «remote, US timezone» без требования резидентства) отражай в оценках и `red_flags`, не додумывай.
