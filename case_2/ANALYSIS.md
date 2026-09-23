# Voice Router — анализ стартового кита (кейс 2)

Источник: `case_2/voice_router_dataset/` (README.md / README.ru.md / README.kz.md, 7 JSON, evaluate.py), `AGENTS.md`, `README.md` репо.
Все подсчёты сделаны скриптами по JSON, не на глаз. Файлы датасета не менялись.

> **Главное расхождение с постановкой:** в датасете кейс не Halyk Bank, а вымышленная страховая **Saqta Insurance** (общее страхование, не жизнь). Банк нигде не упоминается. Ориентира «выбор сценария ≤ 500 мс» в README тоже нет, есть только бонус за медиану `latency_ms.total` (см. §1).

---

## 1. Ключевое из README и AGENTS.md

### Кейс (README датасета; три языковые версии совпадают по смыслу)
- Агент контакт-центра Saqta Insurance, языки kk/ru. «Агент выбирает подходящий сценарий с помощью LLM-слоя (без классификатора намерений)».
- **Запрет:** «Классификаторы намерений — модели на основе энкодеров, обученные сопоставлять высказывания с намерениями, — нельзя использовать для выбора сценария». Любые облачные LLM/STT/TTS **разрешены**.
- **«Сегодня» = `2026-10-01`** (четверг). Все относительные даты («ертең», «три дня назад») считать от него, а не от системных часов.
- Продукты: ОГПО, КАСКО, ДМС (в основном корпоративное), travel, жильё, НС. **Не оказываются:** страхование жизни, пенсионные аннуитеты, кредиты (в KB ещё депозиты и ипотека) → `SYS_OUT_OF_SCOPE`.
- Часы: продажи пн–сб 08:00–20:00, урегулирование и медпомощь 24/7.
- Сложности, заявленные авторами: одно слово ведёт в разные сценарии («авария» → SC11/SC12/SC13); статус ≠ несогласие («одобрили, но мало» = SC19); срочные случаи (ДТП сейчас, болезнь за границей, мошенничество) идут первыми; смена темы и языка посреди фразы; необратимые действия требуют явного «да».

### Оценка на живом демо (решающее)
- «Жюри в реальном времени зачитывает **10 скрытых высказываний**: простые запросы, смена темы, пограничные случаи, смешанная речь, казахский язык и запросы, которые не должны направляться в бизнес-сценарий».
- **До 3 баллов за высказывание:** (1) правильный основной сценарий; (2) все сценарии для мультиинтента, **в остальных случаях правильный язык ответа**; (3) качество ответа относительно данных. Итого максимум 30.
- **Задержка:** «необязательный показатель, который даёт только бонусные баллы: медленное решение не штрафуется». Метрика: от конца речи клиента до начала воспроизведения ответа (`latency_ms.total`), **медиана по набору**: ≤ 1,5 с → +2, ≤ 3 с → +1, > 3 с → 0. «Жюри выборочно проверяет задержку секундомером».
- «Персоны в скрытом наборе используют клиентов из `mock_backend.json`. **Агент должен идентифицировать их по номеру телефона** и использовать их данные».
- Трассировку нужно **показывать после каждой реплики клиента** (формат в §7).

### Референсная архитектура (рекомендация, но задаёт контракты)
STT (потоковый) → Триаж (язык, нормализация, срочность, разбиение мультиинтента) → LLM-роутер → Политика решений → Исполнитель сценария (FSM) → Ответ (LLM в рамках данных) → TTS; общее состояние диалога: язык, клиент, активный сценарий, **стек**, слоты.

Политика решений (дословно по смыслу):
- `confidence ≥ 0.75` → запустить сценарий; `0.45–0.75` → `SYS_UNCLEAR`, один вопрос с двумя вариантами; `< 0.45` два раза подряд или по просьбе → оператор с контекстом.
- Несколько сценариев → сначала `urgent`, затем в порядке упоминания; подтвердить, что остальные тоже будут обработаны.
- Продолжение активного сценария → заполнить слоты, **повторно не маршрутизировать**.
- Смена темы → текущий сценарий в стек, после нового предложить вернуться.

### Правила речи
1–2 коротких предложения, один вопрос за раз; сначала эмпатия, потом действие; числа словами («тридцать восемь тысяч тенге»); маскировать ПДн при зачитывании (`r***@mail.example`); перед необратимым действием зачитать данные и получить явное «да»; на «вы робот?» отвечать честно; при переводе передавать оператору резюме. «Не сообщайте факты, которых нет в данных».

### AGENTS.md (правила хакатона): что влияет на работу
- Работа только в этом репо и только с 23.09; **почасовой видимый прогресс** (иначе основание для дисквалификации); честная история коммитов.
- **Codex обязателен**, его использование должно быть видно.
- **Рабочий деплой + активная ссылка + доступ** обязательны: «Не запускается = отклонён».
- Раскрыть в README любые ранее созданные наработки (п.6.4).
- Техотбор: функциональность 25, проблема/ценность 15, техреализация 15, применимость 15, потенциал 20, **README и воспроизводимость 10** (проблема, решение, функции, стек, запуск).
- Коммиты от участников, «без служебных подписей сторонних инструментов».

---

## 2. Схемы данных

Во всех JSON есть `meta: {dataset, version: "1.0", as_of_date: "2026-10-01"}`. Все поля ниже присутствуют в 100 % записей, если не сказано иное.

### scenarios.json: `{meta, scenarios[40], system_intents[3]}`
| Поле | Тип | Примечание |
|---|---|---|
| scenario_id | str | `SC01`…`SC40` |
| slug, name | str | name на английском |
| domain | enum | auto, health, travel, property, accident, corporate, general |
| category | enum | sales, claims, servicing, info, feedback, contact, security |
| description | str (en) | главный вход роутера |
| not_this_if | `[{condition: str, use_instead: SCxx\|SYS_*}]` | 1–2 правила у каждого |
| priority | enum | normal / high / urgent |
| fast_path_eligible, requires_identification, requires_confirmation | bool | |
| slots | `{required: [slot], optional: [slot]}` | имена из slots.json |
| actions | [action] | имена из actions.json |
| handoff | `{when: str, queue: queue}` \| null | |
| examples | `{ru: [4], kk: [3]}` | всего 280 примеров |
| responses | `{ru\|kk: {opening, closing}}` | с `{placeholders}`, ориентир стиля |

`system_intents[]`: `{id, description, behavior, response: {ru, kk}}` для `SYS_OUT_OF_SCOPE`, `SYS_UNCLEAR` (шаблон `{option_a}/{option_b}`), `SYS_GOODBYE`.

Пример (сокращён): `{"scenario_id":"SC01","slug":"ogpo_quote","priority":"normal","fast_path_eligible":false,"requires_identification":false,"slots":{"required":["region","vehicle_type","drivers_iin"],"optional":["vehicle_plate"]},"actions":["get_bm_class","calc_ogpo_price"],"requires_confirmation":false,"handoff":null,"not_this_if":[{"condition":"Client already decided and asks to issue or buy the policy","use_instead":"SC02"}, …]}`

### slots.json: `{meta, slots[43]}`
`name`, `type` ∈ {string, enum, integer, date, boolean, list, text}, `description` (en), `prompt: {ru, kk}`; `pattern` у 9 слотов, `values` у 9.
Пример: `{"name":"phone","type":"string","pattern":"^\\+7\\d{10}$","prompt":{"ru":"Подскажите, пожалуйста, ваш номер телефона.","kk":"Телефон нөміріңізді айтып жіберіңізші."}}`

Ключевые форматы: `phone ^\+7\d{10}$`, `iin ^\d{12}$`, `policy_number ^SQ-(OGPO|CASCO|TRVL|PROP|NS|DMS)-\d{6}$`, `claim_number ^CL-\d{6}$`, `vehicle_plate ^\d{3}[A-Z]{2,3}\d{2}$` (латиница, код региона в конце: 02 = Алматы, 01 = Астана).
Enum: `region` {almaty, astana, other}; `city` (8 городов с офисами); `vehicle_type` {car, truck, motorcycle}; `franchise` {0, 50000, 100000}; `sum_insured` {1M, 3M, 5M, 10M, 20M}; `product_type` {ogpo, casco, travel, property, accident, dms}; `document_type` {policy_duplicate, contract_copy, embassy_certificate, payment_certificate}; `contact_field` {phone, email, address}; `property_type` {apartment, house}.

### actions.json: `{meta, queues[6], error_format, error_codes{8}, error_handling[4], actions[31]}`
Действие: `{name, description, inputs: [str], outputs: [str], errors: [code], irreversible: bool}`; `"phone|iin"` в inputs означает «одно из».
Пример: `{"name":"cancel_policy","inputs":["policy_number","cancel_reason"],"outputs":["refund_amount"],"errors":["not_found","policy_inactive","already_done","not_eligible"],"irreversible":true}`

Очереди: `operator_general, claims_team, medical_assistance_24_7, corporate_sales, complaints_team, security_team`.
Ошибки: `{"error":{"code":"…","message":"…"}}`, коды `not_found, invalid_input, policy_inactive, not_eligible, not_covered, no_availability, already_done, service_unavailable`.
Поведение: not_found/invalid_input → переспросить один раз, потом другой идентификатор или оператор; policy_inactive/not_eligible/not_covered → причина одной фразой и ближайшая альтернатива; no_availability → ближайшие слоты; service_unavailable → один повтор, потом оператор.

Все 31 действие (irr = необратимое):
| Действие | in → out | irr |
|---|---|---|
| find_client | phone\|iin → client_id, full_name | |
| get_policies | client_id → policies | |
| get_policy | policy_number\|vehicle_plate → policy_number, product, status, end_date | |
| get_bm_class | iin → bm_class (неизвестный → "3") | |
| calc_ogpo_price / calc_casco_price / calc_travel_price / calc_property_price / calc_accident_price | параметры продукта → price (travel: +zone, coverage) | |
| create_policy | product_type, phone → policy_number | **да** |
| renew_policy | policy_number → policy_number, price | **да** |
| update_policy | policy_number → extra_premium | **да** |
| cancel_policy | policy_number, cancel_reason → refund_amount | **да** |
| create_claim | product_type, incident_date, incident_description → claim_number | **да** |
| get_claim | claim_number\|client_id → claim_number, status, next_step | |
| create_dispute | claim_number, complaint_text → ticket_id | **да** |
| book_inspection | claim_number, city, preferred_date → slot_datetime, address | **да** |
| book_appointment | policy_number, doctor_specialty, city, preferred_date → clinic_name, slot_datetime | **да** |
| check_coverage | policy_number, service_name → covered, note | |
| list_clinics | city → clinics | |
| resend_documents | policy_number → sent_to | |
| check_payment | client_id, payment_date → payment_status, amount | |
| update_contact | client_id, contact_field, new_value → — | **да** |
| request_document | policy_number, document_type, email → sent_to | |
| get_offices | city → address, hours | |
| kb_lookup | topic → answer | |
| send_sms | phone → — | |
| create_callback | phone, callback_time → — | |
| create_complaint / report_fraud | text → ticket_id | |
| transfer_to_operator | queue → — | |

### knowledge_base.json
Разделы: `company, offices[8], inspection_points[3], products{ogpo, casco, travel, property, accident, dms}, clinics[6], claims, payments, cancellation, bonus_malus, app_help, fraud_policy, documents_available, complaints`. Содержимое на английском. Подробно в §8.

### mock_backend.json: `{meta, defaults{unknown_iin_bm_class:"3"}, clients[11], policies[11], claims[4], payments[2]}`
- client: `{client_id, full_name, phone, iin, city, email, address, bm_class, preferred_language}`
- policy: `{policy_number, client_id, product, start_date, end_date, premium|null, details{…по продукту}}`
- claim: `{claim_number, client_id, policy_number, claim_type, incident_date, status, next_step, [approved_amount, assessor_estimate, decision_date, missing_documents, inspection_date, decision_due]}`
- payment: `{payment_id, client_id, date, amount, product, status, policy_number|null, [note]}`

### dev_utterances.json / dialogs_sample.json
См. §5 и §6.

### Связи
```
utterance ──LLM-роутер──► scenario_id ──► scenarios.slots.required/optional ──► slots.json (тип, pattern/values, вопрос ru/kk)
                                     ├──► scenarios.actions ──► actions.json (inputs ← слоты/профиль; irreversible → preview/confirm/execute)
                                     │                               └─► мок поверх mock_backend.json (clients/policies/claims/payments)
                                     │                                    + knowledge_base.json (цены по формулам, kb_lookup, clinics, offices)
                                     ├──► handoff.queue ──► actions.queues
                                     └──► not_this_if.use_instead ──► другой scenario_id / SYS_*
```
Проверено скриптом: все 43 слота и 31 действие используются, битых ссылок нет; **`requires_confirmation` = true ровно у сценариев с хотя бы одним irreversible-действием** (расхождений 0).
Скрытые входы: `product_type` нужен `create_policy`/`create_claim`, но в слотах сценариев его нет, выводится из сценария. `client_id` берётся из `find_client`.

---

## 3. Каталог сценариев (40)

Обозначения: **Пр** — priority (N/H/**U**); **FP** — fast_path_eligible; **Ид** — requires_identification; **Подтв** — requires_confirmation (необратимое действие); **Оп** — очередь handoff и условие.

### auto (11)
| ID | Название | Назначение | Обяз. слоты | Действия | Пр | FP | Ид | Подтв | Оп |
|---|---|---|---|---|---|---|---|---|---|
| SC01 | Расчёт ОГПО | узнать цену ОГПО до решения | region, vehicle_type, drivers_iin | get_bm_class, calc_ogpo_price | N | | | | |
| SC02 | Покупка ОГПО | оформить ОГПО сейчас | vehicle_plate, drivers_iin, phone | calc_ogpo_price, **create_policy**, send_sms | N | | | ✔ | |
| SC03 | КАСКО: консультация/цена | что покрывает и сколько стоит | car_value, car_year | calc_casco_price, kb_lookup | N | | | | |
| SC04 | Добавить водителя | вписать водителя в ОГПО/КАСКО | policy_number, new_driver_iin | find_client, get_policy, get_bm_class, **update_policy** | N | | ✔ | ✔ | |
| SC05 | Смена авто/госномера | обновить авто или номер в полисе | policy_number, vehicle_plate | find_client, get_policy, **update_policy** | N | | ✔ | ✔ | |
| SC11 | ДТП прямо сейчас | клиент на месте ДТП, нужны инструкции | injured, location | kb_lookup, send_sms, transfer_to_operator | **U** | | | | claims_team, если есть пострадавшие или клиент растерян |
| SC12 | Пострадавший по ОГПО виновника | прошлое ДТП, виновник застрахован в Saqta, нужна выплата | culprit_vehicle_plate, incident_date, incident_description, phone | get_policy, **create_claim**, send_sms | H | | | ✔ | |
| SC13 | Убыток по КАСКО | своя машина по КАСКО повреждена/угнана | policy_number, incident_date, incident_description | find_client, get_policy, **create_claim**, transfer | H | | ✔ | ✔ | claims_team: угон или тоталь |
| SC20 | Запись на осмотр авто | осмотр по уже заведённому убытку | claim_number, city, preferred_date | get_claim, **book_inspection** | N | | ✔ | ✔ | |
| SC32 | Бонус-малус | свой класс БМ / почему подорожало ОГПО | iin | get_bm_class, kb_lookup | N | | | | |

### travel (2), property (2), accident (2)
| ID | Название | Назначение | Обяз. слоты | Действия | Пр | FP | Ид | Подтв | Оп |
|---|---|---|---|---|---|---|---|---|---|
| SC06 | Покупка travel | поездка за границу, купить мед. страховку | trip_country, trip_start, trip_end, travelers_count, traveler_max_age | calc_travel_price, **create_policy**, send_sms | N | | | ✔ | |
| SC15 | Медслучай за границей | уже за границей, заболел или травма | policy_number, location, incident_description | get_policy, transfer | **U** | | ✔ | | medical_assistance_24_7 **всегда** после идентификации полиса |
| SC07 | Страхование жилья | условия и цена для квартиры/дома | property_type, sum_insured | calc_property_price, kb_lookup | N | | | | |
| SC14 | Убыток по имуществу | залив/пожар/кража застрахованного жилья | policy_number, incident_date, incident_description | find_client, get_policy, **create_claim**, send_sms, transfer | H | | ✔ | ✔ | claims_team: пожар с пострадавшими |
| SC08 | НС: консультация | страховка от травм/инвалидности | sum_insured | calc_accident_price, kb_lookup | N | | | | |
| SC16 | Выплата по НС | травма, хочет выплату по полису НС | policy_number, incident_date, incident_description | find_client, get_policy, **create_claim**, send_sms | H | | ✔ | ✔ | |

### health (5), corporate (1)
| ID | Название | Назначение | Обяз. слоты | Действия | Пр | FP | Ид | Подтв | Оп |
|---|---|---|---|---|---|---|---|---|---|
| SC09 | Индивидуальный ДМС | купить ДМС себе (без корпоративного) | — | kb_lookup | N | | | | |
| SC21 | Запись к врачу по ДМС | записаться к врачу | policy_number, doctor_specialty, city, preferred_date | find_client, **book_appointment** | N | | ✔ | ✔ | |
| SC22 | Покрытие ДМС | покрывает ли ДМС услугу/анализ/лекарство | policy_number, service_name | find_client, check_coverage | N | | ✔ | | |
| SC23 | Клиники-партнёры | список клиник в городе | city | list_clinics, send_sms | N | ✔ | | | |
| SC24 | Электронная карта ДМС | не может найти/не получил e-карту | phone | find_client, kb_lookup, send_sms | N | ✔ | ✔ | | |
| SC10 | Корпоративный запрос | представитель компании: сотрудники/активы | company_name, employees_count, phone | transfer | N | | | | corporate_sales **всегда** после сбора контактов |

### general: урегулирование (4)
| ID | Название | Назначение | Обяз. слоты | Действия | Пр | FP | Ид | Подтв | Оп |
|---|---|---|---|---|---|---|---|---|---|
| SC17 | Статус убытка | статус заявления/выплаты | claim_number | find_client, get_claim | N | | ✔ | | |
| SC18 | Документы для убытка | какие документы и как подать | product_type | kb_lookup, send_sms | N | ✔ | | | |
| SC19 | Несогласие с решением | оспорить отказ или сумму | claim_number, complaint_text | find_client, get_claim, **create_dispute**, transfer | H | | ✔ | ✔ | claims_team, если просит человека |

### general: полис и оплата (9)
| ID | Название | Назначение | Обяз. слоты | Действия | Пр | FP | Ид | Подтв | Оп |
|---|---|---|---|---|---|---|---|---|---|
| SC25 | Действует ли полис | активен ли и до когда | policy_number | find_client, get_policy | N | | ✔ | | |
| SC26 | Повторная отправка полиса | оформлен и оплачен, но документ не пришёл | phone | find_client, get_policies, resend_documents | N | ✔ | ✔ | | |
| SC27 | Продление | истекает или недавно истёк, продлить | policy_number | find_client, get_policy, **renew_policy**, send_sms | N | | ✔ | ✔ | |
| SC28 | Расторжение и возврат | досрочно расторгнуть, вернуть деньги | policy_number, cancel_reason | find_client, get_policy, **cancel_policy** | N | | ✔ | ✔ | |
| SC29 | Смена контактов | телефон/email/адрес в профиле | contact_field, new_value | find_client, **update_contact** | N | | ✔ | ✔ | |
| SC30 | Деньги списаны, полиса нет | оплата прошла, полис не выпущен | payment_date, phone | find_client, check_payment, transfer | H | | ✔ | | operator_general: платёж найден, полиса нет |
| SC31 | Способы оплаты, рассрочка | как платить, есть ли рассрочка | — | kb_lookup | N | ✔ | | | |
| SC39 | Справка / копия | справка для посольства, дубликат, копия договора | policy_number, document_type, email | find_client, request_document | N | | ✔ | | |
| SC40 | Разъяснение условий | франшиза, исключения, лимиты | topic | kb_lookup | N | | | | |

### general: инфо, контакт, безопасность (6)
| ID | Название | Назначение | Обяз. слоты | Действия | Пр | FP | Ид | Подтв | Оп |
|---|---|---|---|---|---|---|---|---|---|
| SC33 | Офисы и часы | адрес/режим офиса | city | get_offices, send_sms | N | ✔ | | | |
| SC34 | Приложение/ЛК | вход, SMS-код, ошибки | — | kb_lookup, send_sms, transfer | N | ✔ | | | operator_general, если стандартные шаги не помогли |
| SC35 | Жалоба на сервис | грубость, не перезвонили, задержки | complaint_text | create_complaint, transfer | H | | | | complaints_team: просит человека или сильно расстроен |
| SC36 | Обратный звонок | перезвонить позже; **без полной идентификации** | phone, callback_time | create_callback | N | ✔ | | | |
| SC37 | Оператор | явно просит человека | — | transfer | N | ✔ | | | operator_general **всегда** |
| SC38 | Мошенничество | подозрительный звонок/SMS от имени Saqta | fraud_details | report_fraud, kb_lookup, transfer | **U** | | | | security_team, если уже сообщил коды/карту |

Сводка: urgent: SC11, SC15, SC38; high: SC12, SC13, SC14, SC16, SC19, SC30, SC35; fast path (9): SC18, SC23, SC24, SC26, SC31, SC33, SC34, SC36, SC37; подтверждение (14): SC02, 04, 05, 06, 12, 13, 14, 16, 19, 20, 21, 27, 28, 29; requires_identification (19): SC04, 05, 13–17, 19–22, 24–30, 39.

---

## 4. Границы и риски путаницы

Правила взяты из `not_this_if` (оно направленное, и часть пар описана только с одной стороны). В скобках dev-реплики, которые проверяют эту границу.

| Группа | Ключ различия |
|---|---|
| **SC01 ↔ SC02 ↔ SC27** | цена без решения = SC01; «оформить/купить» = SC02; продлить существующий (истекает) = SC27. В D01 ответ «Да, давайте оформим» на вопрос после расчёта помечен **SC02**, а не продолжением SC01 |
| **SC01 ↔ SC32** | новая цена = SC01; «почему подорожало» / «какой у меня класс» = SC32 (U063, U064) |
| **SC01 ↔ SC03** | обязательное ОГПО vs добровольное КАСКО; «посчитайте каско и обязательную» = мультиинтент SC03+SC01 (U084) |
| **SC11 ↔ SC12 ↔ SC13 ↔ SC16** | «авария»: происходит **сейчас**, клиент на месте = SC11 (U021, U022); было раньше, клиент пострадавший и виновник застрахован в Saqta = SC12 (U023, U095); своя машина по КАСКО или клиент виновник = SC13 (U025); травма по полису НС = SC16, но травма в ДТП на месте = SC11 |
| **SC13 ↔ SC20** | убыток ещё не заявлен = SC13; убыток есть, нужен осмотр = SC20 (U039, U040; U083 = SC13+SC20) |
| **SC17 ↔ SC19 ↔ SC18** | «когда переведут / что с заявлением» = SC17 (U033); «не согласен, мало, отказали» = SC19 (U037, U038); «какие документы» = SC18. «Одобрили, но мало» → SC19 (явно в README) |
| **SC19 ↔ SC35** | спор с решением/суммой = SC19; качество обслуживания = SC35; вместе = мультиинтент (U087 SC19+SC35) |
| **SC35 ↔ SC28** | злость без явной просьбы расторгнуть = SC35; явное «расторгнуть» = SC28 |
| **SC35 ↔ SC37** | в D06 жалоба, затем «соедините с человеком» → метка SC37, но очередь complaints_team |
| **SC25 ↔ SC26 ↔ SC30 ↔ SC39** | действует ли = SC25; оформлен и оплачен, но документ не пришёл = SC26 (U051); деньги списаны, полиса нет = SC30 (U059, U060); справка/копия для другой цели = SC39 (U077, U096). D05: «проблема с полисом» → SYS_UNCLEAR с вариантами SC26/SC30 |
| **SC25 ↔ SC27** | «не закончилась ли страховка» = SC25 (U049), «хочу продлить» = SC27 |
| **SC25 ↔ SC38** | подозрительный звонок про аннулирование = SC38; просто проверить = SC25 (D09: SC38 → SC25) |
| **SC06 ↔ SC15 ↔ SC39** | планирует поездку = SC06 (в т.ч. «страховка для шенгенской визы», U012!); уже за границей и болен = SC15; справка для посольства по **существующему** полису = SC39 |
| **SC09 ↔ SC10 ↔ SC22** | купить ДМС себе = SC09; компания для сотрудников = SC10 (U020: «застраховать машины предприятия» тоже SC10); сотрудник про свой корпоративный ДМС = SC22 |
| **SC21 ↔ SC22 ↔ SC23** | записаться = SC21; покрывается ли = SC22; список клиник = SC23. U088/D04: SC21+SC22 |
| **SC22 ↔ SC40** | конкретная услуга по своему ДМС = SC22; общие исключения/термины = SC40 (U079, U080) |
| **SC24 ↔ SC34** | именно e-карта ДМС = SC24 (U048 «картам қосымшада көрінбей тұр»); вход в приложение вообще = SC34 (U067, U068, U097) |
| **SC04 ↔ SC05 ↔ SC28** | добавить водителя = SC04; сменил машину/номер и сохраняет полис = SC05; продал машину, возврат = SC28 (U092 SC28+SC29) |
| **SC29 ↔ SC05 / SC26** | контакты в профиле = SC29; данные авто = SC05; «не пришёл на почту + поменять почту» = SC26+SC29 (U085) |
| **SC30 ↔ SC31** | проблема со списанием = SC30; «как оплатить / рассрочка» = SC31 (U061, U062) |
| **SC33 ↔ SC20** | офис = SC33; где осматривают авто по убытку = SC20. U083: «где у вас осмотр делают» после КАСКО-убытка = SC20 |
| **SC36 ↔ SC37** | позже = SC36 (U071 «наберите вечером», U072); сейчас = SC37 |
| **SC07 ↔ SC14, SC08 ↔ SC16, SC03 ↔ SC13** | каждая пара «продажа ↔ убыток» различается тем, наступило ли событие |
| **SC08 ↔ OUT_OF_SCOPE** | страхование жизни → `SYS_OUT_OF_SCOPE` (U099) |

**Служебные намерения:** `SYS_OUT_OF_SCOPE`, `SYS_UNCLEAR`, `SYS_GOODBYE` (не SC, но это валидные метки в `expected` и `scenarios`). **Приветствия как отдельного интента нет**: «Сәлеметсіз бе, …» всегда входит в реплику с интентом (U004, U093, U094), а голое «Алло, я по поводу страховки» = SYS_UNCLEAR (U102). **Оператор** = SC37 (бизнес-сценарий, fast path), обратный звонок = SC36.

---

## 5. dev_utterances.json

Формат: `{meta, utterances[104]}`, запись `{id, text, lang: ru|kk|mixed, expected: [ID, …] (упорядочен), type: single|multi_intent|out_of_scope|unclear}`. Других полей нет (слотов и персон нет).
Пример: `{"id":"U083","text":"Кеше аулада көлігімді біреу соғып кетіпті, КАСКО бар, и ещё подскажите, где у вас осмотр делают","lang":"mixed","expected":["SC13","SC20"],"type":"multi_intent"}`

**Распределение**
| type \ lang | ru | kk | mixed | Σ |
|---|---|---|---|---|
| single | 40 | 39 | 5 | 84 |
| multi_intent | 8 | 3 | 2 | 13 |
| out_of_scope | 2 | 2 | 0 | 4 |
| unclear | 2 | 1 | 0 | 3 |
| Σ | 52 | 45 | 7 | 104 |

- U001–U080: ровно по одной ru и одной kk реплике на каждый SC01–SC40. U081–U093: мультиинтент. U094–U097: смешанные single. U098–U101: out_of_scope. U102–U104: unclear.
- `expected` длиной 1 у 91 реплики, длиной 2 у 13. Больше двух интентов нет.
- Покрытие (как основной / всего): у каждого SC минимум 2 основных; больше всего SC06 (4/4), SC25 (4/5), SC26 (4/4), SC29 (2/5: в мультиинтентах почти всегда вторым). **SYS_GOODBYE: 0**, в dev его нет вообще.
- Слабо покрыто: mixed (7, из них только 2 мультиинтента); kk мультиинтент (3); unclear (3, kk 1); urgent-сценарии в мультиинтенте (**0**, т.е. правило «urgent первым» на dev не проверяется); смена темы в dev отсутствует как класс, она есть только в диалогах.
- Мультиинтенты (порядок = порядок упоминания, urgent нет ни в одном): SC27+SC04, SC25+SC29, SC13+SC20, SC03+SC01, SC26+SC29, SC06+SC31, SC19+SC35, SC21+SC22, SC26+SC25, SC14+SC18, SC07+SC08, SC28+SC29, SC06+SC33.
- Mixed-реплики: переключение kk→ru внутри фразы, часто «Сәлеметсіз бе» + русская суть (U094 «полисім действует ли ещё, тексеріп беріңізші»); в казахских фразах встречаются русизмы (ОГПО, ДМС, КАСКО, «аварияға», «справка»).
- Утечки нет: ни одна dev-реплика не совпадает с 280 examples из scenarios.json.

---

## 6. dialogs_sample.json

Формат: `{meta, dialogs[10]}`; диалог: `{dialog_id, title, tags[], client_id: C0xx|null, turns[]}`. 80 реплик (40 client + 40 bot, строго чередуются).
- client-реплика: `{role:"client", text, lang, scenarios: [ID…], slots: {…только извлечённые в этой реплике}}`
- bot-реплика: `{role:"bot", text, lang, actions: [{name, mode?: "preview"|"execute", result?, topic?, queue?}]}`

Как размечено:
- **Продолжение сценария**: у реплики-ответа на вопрос повторяется тот же `scenarios` (флага `is_continuation` в разметке нет).
- **Смена темы**: просто другой ID в `scenarios` (D01 SC01→SC02, D09 SC38→SC25, D08 SC17→SC18).
- **Возврат к теме**: отдельной метки нет, есть только тег `context_return` (D03).
- **Мультиинтент**: несколько ID в одной реплике (D03 `[SC27, SC31]`, D04 `[SC21, SC22]`).
- **Смешанная речь**: `lang:"mixed"` у реплики клиента; бот отвечает на одном языке (в D04 на kk).
- **Подтверждение**: пара `mode:"preview"` (бот зачитывает данные и спрашивает) → «да» клиента → `mode:"execute"` с `result`.
- Значения слотов нормализованы (`+77071234567`, `2026-10-02`), описательные слоты на английском (`"incident_description":"Rear-end collision…"`, `"doctor_specialty":"therapist"`).

Теги по диалогам: D01 scenario_switch+confirmation; D02 kazakh+confirmation; D03 topic_switch+context_return+multi_intent; D04 mixed_language+multi_intent; D05 clarification; D06 handoff+emotional; D07 kazakh+irreversible_action; D08 context_carry; D09 security+scenario_switch; D10 language_switch+confirmation.

**Разбор показательных**
- **D03 (C007, смена темы и возврат).** SC17: бот по телефону нашёл клиента, `get_claim` → CL-500330 under_review. Затем «каско скоро заканчивается — можно продлить в рассрочку?» → `[SC27, SC31]`: бот отвечает про рассрочку из KB и сам предлагает продлить SQ-CASCO-204300 (полис взят из контекста, без `get_policy`). Клиент откладывает («давайте потом») и возвращается к убытку: «что-то ещё нужно донести?» → **SC18** (не SC17), слот `claim_number` перенесён из контекста, бот отвечает через `get_claim.next_step`. Выводы: стек тем реален, отказ от отложенной темы нужно уметь закрыть, возврат может прийти в соседний сценарий.
- **D04 (C002, mixed + мультиинтент + подтверждение в одной реплике).** «…терапевтке жазылу керек, завтра утром можно?» (mixed) → SC21, `preferred_date` = 2026-10-02 (от даты среза). Бот отвечает **на kk**. Город не спрашивали, он взят из профиля (Astana) → `book_appointment:preview`. Далее «Иә, жазыңыз. А анализы тоже бесплатно?» = подтверждение + новый интент: `[SC21, SC22]`, бот в одном ответе делает `execute` и `check_coverage`. Вывод: «да» + новый вопрос в одной фразе — штатный случай.
- **D06 (C004, эскалация).** Жалоба SC35, бот просит телефон; клиент даёт телефон и требует человека → метка SC37, но действия `create_complaint` → `transfer_to_operator(queue: complaints_team)`, а оператор «уже видит» CL-500311 из профиля. Вывод: очередь выбирается по контексту (активный сценарий), а не по SC37; тикет сначала регистрируется, резюме передаётся.
- Ещё: D01 показывает переход «да» после цены → SC02 и нормализацию телефона из слов; D05 показывает SYS_UNCLEAR с двумя вариантами; D10 показывает переключение на ru по просьбе клиента и цену travel (7 дней × 1100 × 2 = 15 400).

---

## 7. evaluate.py: что считает и что ждёт

**Интерфейс: только файл**, не HTTP и не функция. Роутер нужно прогнать офлайн по dev-набору и сохранить предсказания.
```
python evaluate.py predictions.json [dev_utterances.json]   # второй аргумент по умолчанию "dev_utterances.json" (относительно cwd)
```
- argparse нет. Без аргументов печатает docstring и выходит (`sys.exit(__doc__)`, код 1). **`--help` не поддерживается**: воспринимается как имя файла → `FileNotFoundError: '--help'` (проверено).
- **Вход `predictions.json`**: `{"<utterance_id>": ["SCxx", …] | "SCxx"}`. Порядок значим, первый элемент считается основным. Строку оборачивает в список. Нет id → `[]` (ошибка по обеим метрикам). Лишние id → только warning. Служебные метки пишутся строками `"SYS_OUT_OF_SCOPE"`, `"SYS_UNCLEAR"`.
- **Метрики** (по группам `all`, `lang=kk|mixed|ru`, `type=multi_intent|out_of_scope|single|unclear`):
  - `primary_accuracy = got[0] == expected[0]`
  - `full_match = set(got) == set(expected)` (порядок не важен, **лишний сценарий ломает full_match**, дубликаты схлопываются)
  - `intent_recall` только по multi_intent: `Σ|set(exp) ∩ set(got)| / Σ|exp|` (одно число, без разбивки)
- Вывод: таблица `group n primary_acc full_match`, затем `intent_recall`, затем список ошибок (`id expected got | text`) для всех, где не full_match.
- **Латентность, язык ответа, слоты и качество ответа НЕ считаются.** Confidence не используется.
- Практически: нужен скрипт `route_batch → predictions.json`, который гонит тот же роутер, что и продакшн (без STT, по тексту), плюс отдельный замер латентности. На живом демо жюри оценивает по трассировке и ответу, не по этому скрипту. Трассировку в README нужно показывать так:
```json
{"turn":3,"transcript":"...","language":"mixed","scenarios":[{"scenario_id":"SC21","confidence":0.9}],
 "alternatives":[{"scenario_id":"SC23","confidence":0.4}],"reason":"...","slots":{"doctor_specialty":"therapist"},
 "actions":["find_client","book_appointment:preview"],
 "latency_ms":{"stt":0,"triage":0,"router":0,"response":0,"tts_first_audio":0,"total":0}}
```
Контракт выхода роутера (README): `{scenarios:[{scenario_id, confidence, reason}], alternatives:[{scenario_id, confidence}], language, slots:{}, is_continuation: bool}`.

---

## 8. knowledge_base.json и mock_backend.json

### KB: на что опираться в ответах (всё на английском, озвучивать надо на ru/kk)
- **Цены формулами** (моки обязаны считать по ним, данные бэкенда им соответствуют, я пересчитал все полисы):
  - ОГПО = `base_by_region (almaty 38000 / astana 34000 / other 26000) × vehicle_type_coef (car 1.0 / truck 1.4 / moto 0.6) × bm_coef (худший класс среди водителей: M 2.0; 0–2 1.2; 3–5 1.0; 6–9 0.8; 10–13 0.6) × term (12 мес 1.0 / 6 мес 0.6)`; регион по коду номера: 02 → almaty, 01 → astana.
  - КАСКО = `car_value × rate (возраст 0–3: 0.04; 4–7: 0.05; 8–10: 0.065) × franchise (0: 1.0; 50k: 0.9; 100k: 0.8) × package (Standard 1.0 / Lite 0.4)`; максимальный возраст Standard 10 лет, Lite 15 (иначе `not_eligible`).
  - Travel = `rate/день (A СНГ+Грузия 450 / B Шенген+UK 900 / C мир без США/Канады 1100 / D весь мир 1600) × дни включительно × люди × age_coef (0–64: 1.0; 65–75: 2.0; >75: только оператор)`.
  - Жильё: 5M → 15 000, 10M → 25 000, 20M → 42 000 в год, дом ×1.5. НС: 1M → 6 000, 3M → 15 000, 5M → 22 000. ДМС индивидуальный: Basic 180 000, Comfort 320 000.
  - Возврат при расторжении = `premium × неиспользованные полные месяцы / 12 × 0.9`, 10 рабочих дней; возврата нет, если была выплата.
- **Покрытие ДМС**: пакеты Basic/Comfort со списками covered/not_covered (источник для `check_coverage`).
- Офисы (8, адреса и часы), пункты осмотра (Алматы, Астана, «other» = парковка офиса по записи), клиники (6: 2 Алматы, 2 Астана, Шымкент, Караганда; специальности на английском).
- Урегулирование: сообщить в течение 5 рабочих дней; решение 15 рабочих дней; выплата 5 рабочих дней; чек-лист «ДТП сейчас»; документы по типам (ogpo_victim, casco, property, accident, travel); подача через приложение или claims@…; спор 15 рабочих дней + омбудсмен.
- Оплата: способы, наличные не принимаются, рассрочка (КАСКО 2/4 платежа, ДМС индивидуальный 2, ОГПО и travel только полностью).
- БМ: старт 3, +1 за год без вины, −2 за ДТП по вине. Приложение: вход по SMS, код через 60 с, максимум 5 в час. Антифрод: 4 правила («никогда не просим коды…»). Справки: сроки выдачи. Жалобы: звонок супервайзера в тот же день, письменный ответ за 15 рабочих дней.

### mock_backend: персоны (у всех телефон `+770100000NN`, NN = номер клиента)
| Клиент | Город, язык, БМ | Данные | Вероятный сценарий персоны |
|---|---|---|---|
| C001 Arman Tulegenov | Almaty, ru, 7 | ОГПО 104501 + КАСКО 204118 (Camry 777ABC02), убыток CL-500198 paid | SC04/SC05, SC32, SC17; его ОГПО = полис **виновника** в D02 (SC12) |
| C002 Aigerim Bekova | Astana, **kk**, 3 | ДМС Comfort корпоративный (Nomad Logistics) | SC21/SC22/SC23/SC24 (D04) |
| C003 Yerlan Omarov | Shymkent, ru, 1 | ОГПО 102850 **истёк 2026-09-29**; платёж P-3001 от 30.09 `charged_policy_not_issued` | SC30, SC27 |
| C004 Natalia Smirnova | Almaty, ru, 3 | Жильё 404077; CL-500311 `documents_requested` (нет акта от УК) | SC17/SC18/SC35 (D06, D08) |
| C005 Daniyar Kaliyev | Karaganda, kk, 4 | **своих полисов нет**; CL-500287 ogpo_victim approved 412 000 при оценке СТО 830 000 | SC19 (классика «одобрили, но мало»), SC17 |
| C006 Madina Akhmetova | Astana, kk, 3 | Travel 304552 Турция **20.09–05.10 (сейчас за границей)** | SC15 (urgent), SC39 |
| C007 Sergey Popov | Pavlodar, ru, 6 | КАСКО 204300 **до 2026-10-20**; CL-500330 under_review, решение до 09.10 | SC17, SC27, SC31 (D03) |
| C008 Alibek Sarsenbayev | Almaty, kk, 4 | ОГПО 103990 до 2027-02-14 | SC38 → SC25 (D09) |
| C009 Rustem Ismailov | Almaty, ru, 10 | ОГПО 104777; платёж P-2950 success | SC26 (D05), SC32 |
| C010 Kamila Utepova | Atyrau, kk, 3 | КАСКО 204350 (RAV4 2022, франшиза 100k) | SC28 (D07: возврат 163 800) |
| C011 Nurlan Zhumabekov | Astana, kk, 5 | ОГПО 105120 (515ADF01) | SC04/SC05/SC25 |

Использование: идентификация по телефону (`find_client`) в начале любого сценария с `requires_identification`, после чего слоты берутся из профиля и полисов (город, полис, email) без лишних вопросов, по имени обращаться к клиенту, ПДн при зачитывании маскировать, язык по умолчанию брать из `preferred_language` до первой реплики. Новые ID не должны пересекаться с существующими (в диалогах: SQ-OGPO-104901, CL-500342, T-700118, F-900044, SQ-TRVL-304610).

---

## 9. Выводы для архитектуры

**Промпт роутера (статичный префикс, кэшируемый):**
- Передавать: `scenario_id`, `name`, `description`, **`not_this_if`** (прямо рекомендовано), `priority` (для порядка мультиинтента), 1–2 примера ru и kk. Системные интенты целиком. Не передавать `slots`, `actions`, `responses`, `handoff`: это нужно исполнителю, а не роутеру.
- Объём (оценка по символам: en ≈ 4 символа на токен, кириллица и казахский ≈ 2,5–3): `id+name+description+not_this_if+priority` ≈ 13 тыс. символов ≈ **3–3,5 тыс. токенов**; с 2 ru + 2 kk примерами ≈ 19,6 тыс. символов ≈ **5–6 тыс.**; со всеми 7 примерами ≈ 25 тыс. ≈ **7–8 тыс.**; весь scenarios.json ≈ 52 тыс. символов ≈ 14–17 тыс. (так не делать). Статичный каталог держать в начале промпта для prefix caching; динамика (состояние, активный сценарий, стек, последние 1–2 реплики) идёт в конец.
- Выход: строгий JSON по контракту README (structured output), `reason` короткий. Лимит на выходные токены ограничивает латентность сильнее, чем размер входа.
- Главные ловушки промпта, которые нужно описать явно: время события (сейчас / было раньше / планирую), роль (пострадавший / виновник / своя КАСКО), «наступило ли событие» (продажа vs убыток), «спор vs статус vs жалоба», «оплачено и оформлено vs списано без полиса».

**Где быстрый путь:**
- **Продолжение активного сценария** (ответ на вопрос о слоте, «да/нет» на preview): роутер не вызывать, только экстрактор слотов, либо детерминированная нормализация для телефона, ИИН, номеров и дат. Это самый частый ход диалога. Исключение: «да» + новая тема (D04) и «да, оформим» → SC02 (D01), поэтому детектор продолжения должен уметь заметить новый интент.
- `fast_path_eligible` (SC18, 23, 24, 26, 31, 33, 34, 36, 37): **маршрутизация всё равно через LLM** (классификатор запрещён; regex-правила формально не энкодер, но жюри проверяет именно «выбор делает LLM», так что рисковать не стоит). Экономить на ответе: шаблон из `responses` + данные KB без генеративного LLM.
- Срочность (SC11, SC15, SC38) определять в триаже и ставить в начало очереди мультиинтента.
- Латентность: бонус только за медиану ≤ 1,5 с (+2) или ≤ 3 с (+1). Бюджет на ≤ 1,5 с: endpointing STT ~300–500 мс + роутер ~300–500 мс + первый токен ответа + первый чанк TTS. Нужны стриминг ответа в TTS, параллельный запуск роутера и `find_client`, ближайший регион API. «≤ 500 мс на выбор» — наша внутренняя цель, не требование README.

**Где переспрашивать (SYS_UNCLEAR, один вопрос с top-2):**
- Голые «по поводу страховки», «с машиной вопрос», «проблема с полисом» (U102–U104, D05).
- «Авария» без маркера времени и роли (SC11/12/13), «выплата» без контекста (SC17/SC19), «документ не пришёл» (SC26/SC30), «справка» (SC39/SC18).
- Риск для метрики: в dev unclear всего 3 из 104, а слишком частый SYS_UNCLEAR на пограничных репликах убивает primary_accuracy. Порог 0.75 надо калибровать на dev.

**Где передача оператору:**
- Всегда: SC10 (corporate_sales, после сбора контактов), SC15 (medical_assistance_24_7, после полиса), SC37 (operator_general).
- Условно: SC11 пострадавшие или растерянность → claims_team; SC13 угон/тоталь; SC14 пожар с пострадавшими; SC19 просит человека; SC30 платёж найден, полиса нет → operator_general (кейс C003); SC34 не помогли шаги; SC35 просит человека или сильно расстроен → complaints_team; SC38 уже сообщил коды → security_team.
- Системно: confidence < 0.45 два раза подряд; not_found после одного переспроса; service_unavailable после одного повтора; travel > 75 лет.
- **Очередь выбирать по активному сценарию** (D06: SC37 внутри жалобы → complaints_team), в трансфер передавать резюме.

**Исполнитель:** FSM на каждый сценарий по данным scenarios.json (required-слоты, prompt из slots.json, actions, requires_confirmation → preview/execute), общий для всех 40, т.е. конфиг-управляемый, а не 40 ручных. Обязательны стек тем, перенос слотов между сценариями (claim_number, phone), слоты из профиля клиента, «сегодня» = 2026-10-01.

**Язык ответа** — отдельный балл за каждую одиночную реплику: для mixed нужно правило «преобладающего языка» (в D04 kk-вступление + ru-суть → ответ kk), при явной просьбе переключаться (D10). KB и slot values английские, поэтому генератор ответа должен переводить и произносить числа словами на kk/ru.

---

## 10. Непонятное и противоречия

1. **Кейс не банковский.** Постановка говорит «Halyk Bank», а датасет описывает Saqta Insurance (страхование). Уточнить у организаторов, не нужен ли брендинг Halyk (или Halyk только спонсор кейса).
2. **500 мс нет в документации.** Есть только бонус за медиану `latency_ms.total` (≤ 1,5 с / ≤ 3 с), медленное решение «не штрафуется».
3. **Трек.** AGENTS.md: «трек: Образование»; README репо после последнего коммита: «Мы выбираем»; кейс про контакт-центр страховой. AGENTS.md надо обновить.
4. **Примеры в evaluate.py и README расходятся с данными:** `"U097": ["SC27","SC04"]` (docstring) и `"U085": ["SC27","SC04"]` (README), но на деле U097 = SC34, U085 = SC26+SC29, а SC27+SC04 = U081. Это только иллюстрация формата.
5. **`--help` ломает evaluate.py** (FileNotFoundError), CLI позиционный.
6. **SYS_GOODBYE** отсутствует в dev, но встречается в диалогах; может ли он оказаться среди 10 скрытых реплик, неясно. Также неясно, считается ли SYS_UNCLEAR «правильным основным сценарием» на живом демо, если роутер переспросил на пограничной реплике.
7. **Порядок мультиинтента:** README требует «сначала urgent, затем по порядку упоминания», а evaluate засчитывает primary по первому expected. В dev ни в одном мультиинтенте нет urgent, поэтому непроверяемо, совпадает ли expected в скрытом наборе с правилом urgent-first.
8. **Язык ответа для mixed** не определён формально («преобладающий язык»). В D04 бот отвечает на kk, хотя смысловая часть фразы русская.
9. **Метки против очередей:** D06 помечает «соедините с человеком» как SC37 (очередь operator_general), но трансфер идёт в complaints_team.
10. **Разметка против actions:** D03 помечает реплику SC18, а бот использует `get_claim` (которого нет в SC18.actions) и не заполняет обязательный `product_type`; бот предлагает продлить SQ-CASCO-204300 без `get_policy`. D07 и D09 пропускают `get_policy`/`get_policies`, перечисленные в сценарии. D04 не спрашивает обязательный `city` (берёт из профиля). Вывод: слоты из профиля и контекста считаются заполненными, а список actions в сценарии — это «доступные», а не «обязательные по порядку».
11. **requires_identification не согласован с actions:** SC15 и SC20 требуют идентификацию, но `find_client` в actions нет; SC12 идентификацию не требует, хотя создаёт необратимый claim; SC32 требует `iin`, тогда как README велит идентифицировать персон по телефону (ИИН можно достать из профиля). SC36 прямо запрещает полную идентификацию.
12. **Моки недоопределены:** нет расписаний для `book_inspection`/`book_appointment` (как генерировать `slot_datetime` и когда отдавать `no_availability`); не описаны формула `extra_premium` для `update_policy`, цена `renew_policy` (видимо, пересчёт по формулам с текущим БМ) и сопоставление свободного `service_name` со списками covered/not_covered в `check_coverage`; `create_claim` не принимает policy_number/plate в inputs, хотя по смыслу он нужен (SC12 через номер виновника).
13. **ДМС-корпоративный C002:** `premium: null`; клиники есть только в 4 городах из 8 (для Павлодара и других `list_clinics` → not_found).
14. **Неоднозначная разметка в dev:** U012 «сақтандыру для шенгенской визы» = SC06 (не SC39); U020 «застраховать машины предприятия» = SC10 (не SC03); U049 «не закончилась ли страховка» = SC25 (не SC27); U063 «какой у меня класс» = SC32. Роутер должен следовать именно такой логике.
15. **Дата.** Реальная сегодняшняя дата 2026-09-23, а «сегодня» в данных 2026-10-01. Системное время использовать нельзя. C003 ОГПО истёк 29.09 (это «недавно истёк», допустим SC27), C006 сейчас за границей (до 05.10).
16. **Состав скрытого набора:** «10 высказываний», но в оценке упоминаются «смена темы» и персоны с идентификацией по телефону, т.е. это скорее реплики внутри диалога, а не изолированные фразы. Как жюри подаёт контекст (новая сессия на каждую реплику или один диалог), не сказано. Нужна кнопка «новый диалог» и выбор/автоопределение персоны.
17. **Мусор в распаковке:** `__MACOSX/`, `.DS_Store` в `case_2/` и `voice_router_dataset/`. В git их коммитить не стоит (добавить в .gitignore); сам датасет, если коммитить, раскрыть в README как материал организаторов.
