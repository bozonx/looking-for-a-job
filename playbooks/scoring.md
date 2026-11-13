# Playbook: скоринг вакансии

Заполняешь в front matter (остальное уже заполнил скрипт сбора). Оценки 0–100, шаг 5–10.

| Поле | Как заполнять |
|---|---|
| `region` | argentina / cyprus / cis / europe / asia / other / global (работа из любой точки) |
| `company_country` | ISO-код страны работодателя, если понятно; иначе null |
| `employment` | уточни: full-time / contract / b2b / eor / unknown |
| `vacancy_language` | язык текста (en/ru/es/…) |
| `work_languages` | только если язык общения указан ЯВНО; иначе null |
| `role_tracks` | подмножество vue, react, angular, fullstack, ai_engineer |
| `summary` | 1–3 предложения по-русски: что за компания и роль |
| `key_points` | 3–6 пунктов: стек, формат, таймзона, зарплата |
| `red_flags` | что настораживает (пустой список, если ничего) |
| `scores.remote` | реальная удалёнка: «remote, anywhere» ≈ 95–100; remote с жёсткой таймзоной/страной ≈ 60–80; гибрид/офис ≈ 0–20 |
| `scores.startup` | признаки стартапа (seed/Series A, маленькая команда) |
| `scores.corporate` | крупный бизнес у НАНИМАЮЩЕЙ стороны (design.md §8.2) |
| `scores.outsource` | наниматель — аутсорс/аутстаф/body-shop/рекрутинговое агентство «our client» |
| `scores.end_client_corporate` | только при outsource ≥ 50: крупный ли конечный клиент; иначе null |
| `scores.legitimacy` | реальность компании и вакансии; < 30 = скам |
| `scores.region` | не заполняй — `npm run score` проставит из `config/regions.yaml` по полю `region` |
| `scores.language` | ru/en/es → 100; требуется другой язык → 0–40 |
| `scores.fit.*` | соответствие каждому треку (design.md §8.3), все пять ключей обязательны |
| `stop_flags` | office_outside_ar / ru_corporate / inadequate / scam — только при явных признаках |
| `best_resume` | трек с лучшим fit |
| `score_reasoning` | 2–4 предложения: на чём основаны ключевые оценки и флаги |
| `requirements_special` | нестандартные требования отклика (видео, кодовое слово, тест в форме) |
| `scoring_version` | 1 |

`scores.overall` не трогай — его считает `npm run score`.
Неоднозначное (например, «remote, но только US») отражай в оценках и `red_flags`, не додумывай.
