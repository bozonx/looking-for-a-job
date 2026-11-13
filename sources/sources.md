# Источники

| id | Площадка | Тип | Авторизация | Как собирать | Статус |
|---|---|---|---|---|---|
| remoteok | Remote OK — https://remoteok.com | api (JSON `https://remoteok.com/api`) | нет | `npm run collect:remoteok` | ✅ |
| getonbrd | Get on Board | api | нет | — | план |
| hh | hh.ru | api | нет | — | план |
| linkedin | LinkedIn | html (браузер Orca) | да | — | после стабилизации |

Remote OK: условия API требуют ссылку на Remote OK как источник — она есть в `source_url` и в теле каждой вакансии.
Лента API отдаёт ~100 последних вакансий одной страницей, поэтому `COLLECT_MAX_PAGES` здесь не применяется.
