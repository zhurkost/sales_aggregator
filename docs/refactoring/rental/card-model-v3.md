# Модель карточки v3 — предложение (фаза 7a)

5 ноября 2026 · **ждёт утверждения владельца** · основа: ветка `claude` 5b5c962, common (114 полей),
`runtime/card.json`, четыре плана и рецепта, исходные схемы, отчёты исследований и живая проверка
4 ноября; покрытие — `java -jar backend/target/autopost-api.jar --rental-coverage=…`.

## Сводка

- **114 полей common → 55 понятий**: 41 о квартире и условиях, 14 о публикующем (валидатор печатает «124» — это 114 полей и 10 групп).
- **Объединяются**: 35 полей удобств и дома → 3 списка флажков; метро 3×3 → `metro` list; телефоны 4 + мессенджеры 4 → `phones` list; цена + валюта → `rent`; 5 полей проекции адреса → `address`; ссылки на фото и фото на сервере → `photos`.
- **Удаляются 5**: микрорайон и расстояние до МКАД (площадки выводят сами — `deferred`), планировка-файл и 3D-тур Realt, рекламный текст Domovita. Констант из common — 0 (10 констант категории уже в mapping).
- **Для пользователя**: числа с цифровой клавиатурой; три блока флажков вместо ~35 переключателей; «+ телефон» с Viber/WhatsApp у номера; метро — только для Минска; 5 полей, которые никуда не уходят, не спрашиваются.
- **Покрытие**: `transferred` и `constant` не меняются нигде; `manual` −2 Kufar (метро и микрорайон больше не выключают автоподачу), −3 Realt, −1 Domovita. По содержанию лучше: 5–7 комнат, «балкон», предоплата «3 месяца», год ≤ 1950 и этаж > 30 теперь доходят до форм.
- **Риски миграции**: нечисловой текст в числах и 8 исчезающих кодов (`5+`, `>30`, `<=1950`, «более 10», `months_3_plus`, `two_plus`, `present_unspecified`, «студия» в планировке) → «Сверьте прежние сведения»; новые ID и `cardVersion` — разовая команда при выкладке (с ключами `aiEvidence`); Realt «Количество телефонов» теряет «1 / 2 / спаренный».
- **Решить владельцу — 3 вопроса** (раздел 5): число понятий, тип даты, сопоставление шкал ремонта.

## 1. Понятия карточки

Типы — только из набора задания. Значения в карточке — JSON: числа числами, `triState` —
`true` / `false` / ключа нет, `enum` — код, `multiEnum` — массив кодов, `money` —
`{amount, currency}`, `list<…>` — массив объектов. Варианты — `код` подпись; нативные значения
площадок — только в mapping. «Обязательно»: K — Kufar, O — Onliner, R — Realt, D — Domovita;
источник — `fill_rule.required: true` исходной схемы площадки (уточнения — в сносках).

**Квартира и условия (41)**

| id | Подпись | Тип | Ед. | Варианты | Обязательно |
| --- | --- | --- | --- | --- | --- |
| *Главное* | | | | | |
| `rooms` | Комнат | enum | | `studio` Студия · `1`…`7` | K, R, D (схема) |
| `area_total` | Общая площадь | decimal | м² | | K, R, D (схема) |
| `area_living` | Жилая площадь | decimal | м² | | R, D (схема) |
| `area_kitchen` | Площадь кухни | decimal | м² | | — |
| `floor` | Этаж | integer | | | R, D (схема) |
| `floors_total` | Этажей в доме | integer | | | R, D (схема) |
| `rent` | Плата за месяц | money{amount, currency} | валюта | `BYN` · `USD` · `EUR` · `RUB` | сумма O, R, D; валюта K, R, D (схема) |
| `address` | Адрес | address | | части: label, region, district, settlement, street, house, block, latitude, longitude, precision, confirmed | K, O, R, D (схема: адресное поле каждой формы) |
| `photos` | Фотографии | photos | | файлы на сервере (фаза 5), порядок = порядок в форме | O, R, D (схема) |
| `title` | Заголовок | text | | | K, 2–100 знаков (схема) |
| `description` | Описание | longText | | | K, 20–5000 знаков (схема) |
| *Для объявления* | | | | | |
| `short_description` | Краткое описание | longText | | | R, 50–500 знаков (схема, отчёт Realt) |
| `video_url` | Видео на YouTube | text | | одна ссылка | — |
| *Квартира* | | | | | |
| `separate_rooms` | Раздельных комнат | integer | | | R при 2+ комнатах (схема `when`) |
| `walk_through_room` | Есть проходная комната | triState | | | — |
| `bathroom` | Санузел | enum | | `separate` Раздельный · `combined` Совмещённый · `two` Два санузла · `three` Три санузла | — |
| `balcony` | Балкон или лоджия | enum | | `none` Нет · `balcony` Балкон · `loggia` Лоджия · `balcony_and_loggia` Балкон и лоджия · `two` Два балкона или лоджии · `terrace` Терраса | — |
| `repair` | Ремонт | enum | | `cosmetic` Косметический · `euro` Евроремонт · `designer` Дизайнерский · `construction_finish` Строительная отделка · `unfinished` Без отделки · `needs_repair` Требуется ремонт · `unsafe_condition` Аварийное состояние · `good` Хороший · `normal` Нормальный · `poor` Плохое состояние | — |
| `layout` | Планировка | enum | | `czech` Чешский проект · `brezhnevka` Брежневка · `stalinka` Сталинка · `khrushchevka` Хрущёвка · `small_family` Малосемейка · `penthouse` Пентхаус · `townhouse` Таунхаус · `new_building` Новостройка · `free` Свободная планировка (студия — `rooms = studio`) | — |
| `sleeping_places` | Спальных мест | integer | | | — |
| `window_view` | Окна выходят | multiEnum | | `yard` Во двор · `river` На речку · `park` В парк · `street` На улицу · `south` Юг · `north` Север · `east` Восток · `west` Запад | — |
| `furniture` | Мебель | enum | | `present` Есть · `partial` Частично · `absent` Нет | D¹ |
| `appliances` | Техника | multiEnum | | `refrigerator` Холодильник · `washing_machine` Стиральная машина · `dishwasher` Посудомоечная машина · `microwave` Микроволновая печь · `tv` Телевизор · `air_conditioner` Кондиционер · `iron` Утюг · `coffee_maker` Кофеварка · `hairdryer` Фен · `home_cinema` Домашний кинотеатр · `small_appliances` Мелкая бытовая техника · `computer` Компьютер · `gas_stove` Газовая плита · `electric_stove` Электрическая плита | D¹ |
| `comforts` | Удобства | multiEnum | | `internet` Интернет · `wifi` Wi‑Fi · `landline` Стационарный телефон · `shower` Душевая кабина · `bath` Ванна · `jacuzzi` Джакузи · `dishes` Посуда · `towels` Полотенца · `kitchen_furniture` Кухонная мебель | D¹ |
| *Дом* | | | | | |
| `building_year` | Год постройки | integer | год | | — |
| `wall_material` | Материал стен | enum | | `panel` Панельный · `monolithic` Монолитный · `brick` Кирпичный · `block` Блочный · `frame` Каркасный · `frame_block` Каркасно-блочный · `block_rooms` Блок-комнаты · `silicate_blocks` Силикатные блоки · `logs` Бревенчатый | — |
| `major_repair_year` | Год капремонта | integer | год | | — |
| `housing_market` | Новое или вторичное жильё | enum | | `new` Новое · `resale` Вторичное | K (схема `kufar.condition`) |
| `building_features` | В доме и во дворе | multiEnum | | `elevator` Лифт · `ramp` Пандус · `garbage_chute` Мусоропровод · `fenced_area` Огороженная территория · `covered_parking` Крытая парковка · `parking_space` Стояночное место · `parking` Парковка · `intercom` Домофон · `video_intercom` Видеодомофон · `cctv` Видеонаблюдение · `basement` Подвал · `alarm` Сигнализация · `new_building` Новостройка | D¹ |
| *Рядом с домом* | | | | | |
| `metro` | Ближайшее метро | list<{station: enum, minutes: integer, mode: enum}>, до 3 | мин | station — 36 станций Минска²; mode — `walk` Пешком · `transport` На транспорте | — |
| `residential_complex` | Жилой комплекс | text | | | — |
| *Условия* | | | | | |
| `prepayment` | Предоплата | enum | | `none` Без предоплаты · `months_1` Один месяц · `months_2` Два месяца · `months_3` Три месяца · `months_6` Полгода · `deposit` Залог | — |
| `utilities` | Коммунальные платежи | enum | | `none` Нет · `half` 50 % · `full` 100 % | — |
| `bargain` | Возможен торг | triState | | | — |
| `commission` | Есть комиссия | triState | | | — |
| `sale_planned` | Планируется продажа квартиры | triState | | | — |
| `students` | Студентам | triState | | | — |
| `children` | С детьми | triState | | | — |
| `pets` | С животными | triState | | | — |
| `suitable_for` | Подходит также | multiEnum | | `couples` Парам · `workers` Рабочим · `business_travelers` Командированным | — |
| `preferred_tenant` | Условия сдачи | enum | | `family` Семье · `office` Под офис · `students` Студентам · `no_companies` Не компаниям | — |

**Публикующий (14)** — группа «Агентство» видна только при `landlord = agency`
(у Onliner эти поля появляются при «Агентство», схема `when`).

| id | Подпись | Тип | Ед. | Варианты | Обязательно |
| --- | --- | --- | --- | --- | --- |
| `landlord` | Кто сдаёт | enum | | `owner` Собственник · `agency` Агентство | D (схема `account_type`; живая проверка без входа поле не нашла) |
| `contact_name` | Имя | text | | | K, R (схема) |
| `phones` | Телефоны | list<{number: text, messengers: multiEnum}>, до 4 | | messengers — `viber` Viber · `whatsapp` WhatsApp | первый номер — K, R, D (схема) |
| `email` | Email | text | | | — |
| `contact_method` | Способ связи | enum | | `calls_and_messages` Звонки и сообщения · `calls_only` Только звонки · `messages_only` Только сообщения | K (схема) |
| `call_from` | Звонить с | integer | ч | 0–23 | — |
| `call_to` | Звонить до | integer | ч | 0–23 | — |
| `agency_name` | Название организации | text | | | — |
| `agency_unp` | УНП | text | | | K для профиля организации (схема `company_vat`) |
| `agency_legal_address` | Юридический адрес | text | | | K для профиля организации (схема `company_address`) |
| `agency_contract_number` | Номер договора | text | | | — |
| `agency_contract_date` | Дата договора | text | | ГГГГ-ММ-ДД (вопрос 2) | — |
| `agency_licence_number` | Номер лицензии | text | | | — |
| `agency_licence_date` | Дата выдачи лицензии | text | | ГГГГ-ММ-ДД (вопрос 2) | — |

¹ Domovita: «Дополнительные опции» обязательны — хотя бы один из «Мебель», «Холодильник»,
«Стиральная машина», «Интернет», «Лифт» (схема `domovita.amenities`, `min_items: 1`).

² Станции (подписи как в форме Realt, без «(2024)»): `institut_kultury` Институт культуры ·
`ploshchad_lenina` Площадь Ленина · `oktyabrskaya` Октябрьская · `ploshchad_pobedy` Площадь Победы ·
`ploshchad_yakuba_kolasa` Площадь Якуба Коласа · `akademiya_nauk` Академия наук · `park_chelyuskintsev`
Парк Челюскинцев · `moskovskaya` Московская · `vostok` Восток · `borisovsky_trakt` Борисовский тракт ·
`uruchye` Уручье · `grushevka` Грушевка · `mikhalovo` Михалово · `petrovshchina` Петровщина ·
`malinovka` Малиновка · `pushkinskaya` Пушкинская · `molodezhnaya` Молодёжная · `frunzenskaya`
Фрунзенская · `nemiga` Немига · `kupalovskaya` Купаловская · `pervomayskaya` Первомайская ·
`proletarskaya` Пролетарская · `traktorny_zavod` Тракторный завод · `partizanskaya` Партизанская ·
`avtozavodskaya` Автозаводская · `mogilevskaya` Могилёвская · `sportivnaya` Спортивная ·
`kuntsevshchina` Кунцевщина · `kamennaya_gorka` Каменная горка · `yubileynaya_ploshchad` Юбилейная
площадь · `ploshchad_bogushevicha` Площадь Богушевича · `vokzalnaya` Вокзальная · `kovalskaya_sloboda`
Ковальская Слобода · `aerodromnaya` Аэродромная · `nemorshansky_sad` Неморшанский сад ·
`slutsky_gostinets` Слуцкий гостинец.

Почему не 20–40: каждое из 55 понятий либо переносится хотя бы на одну площадку, либо обязательно на
ней, либо ждёт привязки элемента формы (раздел 4). Меньше — только ценой переносимых значений
(вопрос 1).

## 2. Старое поле → новое понятие

Все **114** полей common. Итог: перенос — 46, объединение — 63, уходит в mapping как константа — 0,
удаляется — 5. «Сверьте» — значение уходит в `legacy` и показывается в «Сверьте прежние сведения»
(механизм фазы 2), а не угадывается миграцией. Таблица сгенерирована по файлам комплекта и проверена
вручную.

| № | Старое поле | Понятие v3 | Пометка | Примечание |
| --- | --- | --- | --- | --- |
| | **Главное о квартире** (`group.main`) | | | |
| 1 | `rental.room_configuration` Комнаты / студия | `rooms` | перенос | код `5+` убирается: 5–7 → «5+» Kufar и Realt |
| 2 | `rental.total_area` Общая площадь | `area_total` | перенос | текст → число |
| 3 | `rental.floor` Этаж квартиры | `floor` | перенос | текст → целое; `>30` → «Сверьте» |
| 4 | `building.total_floors` Этажей в доме | `floors_total` | перенос | текст → целое |
| 5 | `rental.monthly_price` Плата за месяц | `rent.amount` | объединение | сумма и валюта — одно `money` |
| 6 | `rental.currency` Валюта месячной платы | `rent.currency` | объединение |  |
| 7 | `contact.landlord_role` Тип арендодателя | `landlord` | перенос |  |
| | **Описание** (`group.listing`) | | | |
| 8 | `listing.title` Заголовок | `title` | перенос |  |
| 9 | `listing.description` Описание квартиры | `description` | перенос |  |
| | **Условия аренды** (`group.terms`) | | | |
| 10 | `rental.prepayment` Предоплата | `prepayment` | перенос | `months_3_plus` → «Сверьте»; `deposit_unspecified` → `deposit` |
| 11 | `tenant.students` Студенты | `students` | перенос | allowed/forbidden → да/нет |
| 12 | `tenant.pets` С животными | `pets` | перенос | allowed/forbidden → да/нет |
| 13 | `tenant.children` С детьми | `children` | перенос | allowed/forbidden → да/нет |
| 14 | `rental.bargain` Возможен торг | `bargain` | перенос | boolean → triState |
| 15 | `rental.utilities` Коммунальные платежи | `utilities` | перенос | «нет/50%/100%» → `none/half/full` |
| 16 | `rental.has_commission` Есть комиссия | `commission` | перенос | подписи → да/нет |
| 17 | `rental.sale_planned` Планируется продажа квартиры | `sale_planned` | перенос | «Да/Нет» → да/нет |
| 18 | `tenant.preferred` Предпочтительные арендаторы | `preferred_tenant` | перенос | русские коды → латиница |
| 19 | `tenant.couples` Парам | `suitable_for: couples` | объединение |  |
| 20 | `tenant.workers` Рабочим | `suitable_for: workers` | объединение |  |
| 21 | `tenant.business_travel` Командированным | `suitable_for: business_travelers` | объединение |  |
| | **Планировка и дом** (`group.details`) | | | |
| 22 | `rental.living_area` Жилая площадь | `area_living` | перенос | текст → число |
| 23 | `rental.kitchen_area` Площадь кухни | `area_kitchen` | перенос | текст → число |
| 24 | `rental.bathroom` Санузел | `bathroom` | перенос | `two_plus` → «Сверьте»; two/three → Realt «2 и более» |
| 25 | `rental.balcony` Балкон / лоджия | `balcony` | перенос | `present_unspecified` → «Сверьте»; `balcony` → Kufar «Есть» |
| 26 | `rental.repair` Ремонт / состояние отделки | `repair` | перенос | коды прежние (вопрос 3) |
| 27 | `building.year` Год постройки | `building_year` | перенос | текст → целое; `<=1950` → «Сверьте» |
| 28 | `building.wall_material` Материал стен | `wall_material` | перенос |  |
| 29 | `rental.walk_through_room` Есть проходная комната | `walk_through_room` | перенос | boolean → triState |
| 30 | `rental.sleeping_places` Количество спальных мест | `sleeping_places` | перенос | enum → целое; «более 10» → «Сверьте» |
| 31 | `rental.window_orientation` Окна выходят | `window_view` | перенос | русские коды → латиница |
| 32 | `building.new_building` В новостройке | `building_features: new_building` | объединение |  |
| 33 | `rental.condition` Новое или вторичное жильё | `housing_market` | перенос | «Новое/Вторичное» → `new/resale` |
| 34 | `rental.separate_rooms` Раздельных комнат | `separate_rooms` | перенос |  |
| 35 | `rental.layout` Планировка | `layout` | перенос | «студия» → `rooms = studio`, при других комнатах → «Сверьте» |
| 36 | `building.major_repair_year` Год капитального ремонта | `major_repair_year` | перенос |  |
| 37 | `building.infrastructure` Инфраструктура | `building_features: alarm, parking` | объединение |  |
| 38 | `building.ramp` Пандус | `building_features: ramp` | объединение |  |
| 39 | `building.garbage_chute` Мусоропровод | `building_features: garbage_chute` | объединение |  |
| 40 | `building.fenced` Огороженная территория | `building_features: fenced_area` | объединение |  |
| 41 | `building.covered_parking` Парковка крытая | `building_features: covered_parking` | объединение |  |
| 42 | `building.parking_space` Стояночное место | `building_features: parking_space` | объединение |  |
| 43 | `building.intercom` Домофон | `building_features: intercom` | объединение |  |
| 44 | `building.cctv` Видеонаблюдение | `building_features: cctv` | объединение |  |
| 45 | `building.basement` Подвал | `building_features: basement` | объединение |  |
| 46 | `building.video_intercom` видеодомофон | `building_features: video_intercom` | объединение |  |
| | **Мебель и удобства** (`group.amenities`) | | | |
| 47 | `amenity.furniture` Мебель | `furniture` | перенос | коды прежние |
| 48 | `amenity.refrigerator` Холодильник | `appliances: refrigerator` | объединение | yes/no → пункт списка |
| 49 | `amenity.washing_machine` Стиральная машина | `appliances: washing_machine` | объединение |  |
| 50 | `amenity.dishwasher` Посудомоечная машина | `appliances: dishwasher` | объединение |  |
| 51 | `amenity.microwave` Микроволновая печь | `appliances: microwave` | объединение |  |
| 52 | `amenity.tv` Телевизор | `appliances: tv` | объединение |  |
| 53 | `amenity.air_conditioner` Кондиционер | `appliances: air_conditioner` | объединение |  |
| 54 | `amenity.internet` Интернет | `comforts: internet` | объединение |  |
| 55 | `amenity.shower` Душевая кабина | `comforts: shower` | объединение |  |
| 56 | `amenity.jacuzzi` Джакузи | `comforts: jacuzzi` | объединение |  |
| 57 | `amenity.dishes` Посуда | `comforts: dishes` | объединение |  |
| 58 | `amenity.elevator` Лифт | `building_features: elevator` | объединение |  |
| 59 | `amenity.stove_type` Тип плиты | `appliances: gas_stove / electric_stove` | объединение |  |
| 60 | `amenity.telephone_lines` Количество телефонов | `comforts: landline` | объединение | Realt «Количество телефонов» получит только «есть» |
| 61 | `amenity.wifi` Wi-Fi | `comforts: wifi` | объединение |  |
| 62 | `amenity.telephone_network` Телефон | `comforts: landline` | объединение |  |
| 63 | `amenity.iron` Утюг | `appliances: iron` | объединение |  |
| 64 | `amenity.coffee_maker` Кофеварка | `appliances: coffee_maker` | объединение |  |
| 65 | `amenity.bath` Ванна | `comforts: bath` | объединение |  |
| 66 | `amenity.hairdryer` Фен | `appliances: hairdryer` | объединение |  |
| 67 | `amenity.towels` Комплект полотенец | `comforts: towels` | объединение |  |
| 68 | `amenity.kitchen_furniture` Кухонная мебель | `comforts: kitchen_furniture` | объединение |  |
| 69 | `amenity.home_cinema` домашний кинотеатр | `appliances: home_cinema` | объединение |  |
| 70 | `amenity.small_appliances` мелкая бытовая техника | `appliances: small_appliances` | объединение |  |
| 71 | `amenity.computer` компьютер | `appliances: computer` | объединение |  |
| | **Рядом с домом** (`group.location`) | | | |
| 72 | `location.residential_complex` Жилой комплекс | `residential_complex` | перенос |  |
| 73 | `location.town_distance` Расстояние | — | удаляется | Realt подставляет расстояние сам по населённому пункту (схема `realt.town_distance`); в mapping — `deferred` |
| 74 | `location.metro_1_station` Ближайшее метро: станция 1 | `metro[0].station` | объединение | 9 полей → `list` до 3 строк |
| 75 | `location.metro_1_mode` Пешком / Транспортом: 1 | `metro[0].mode` | объединение |  |
| 76 | `location.metro_1_minutes` Минут до метро: 1 | `metro[0].minutes` | объединение |  |
| 77 | `location.metro_2_station` Ближайшее метро: станция 2 | `metro[1].station` | объединение |  |
| 78 | `location.metro_2_mode` Пешком / Транспортом: 2 | `metro[1].mode` | объединение |  |
| 79 | `location.metro_2_minutes` Минут до метро: 2 | `metro[1].minutes` | объединение |  |
| 80 | `location.metro_3_station` Ближайшее метро: станция 3 | `metro[2].station` | объединение |  |
| 81 | `location.metro_3_mode` Пешком / Транспортом: 3 | `metro[2].mode` | объединение |  |
| 82 | `location.metro_3_minutes` Минут до метро: 3 | `metro[2].minutes` | объединение |  |
| 83 | `location.microdistrict` Микрорайон адреса | — | удаляется | единственный потребитель Kufar выводит микрорайон из геокодера (схема `kufar.address_microdistrict`); в mapping — `deferred` |
| | **Контакты** (`group.contact`) | | | |
| 84 | `contact.name` Имя контактного лица | `contact_name` | перенос |  |
| 85 | `contact.phone` Основной телефон | `phones[0].number` | объединение | 4 телефона + 4 набора мессенджеров → `list` |
| 86 | `contact.additional_phone_1` Дополнительный телефон 1 | `phones[1].number` | объединение |  |
| 87 | `contact.additional_phone_2` Дополнительный телефон 2 | `phones[2].number` | объединение |  |
| 88 | `contact.additional_phone_3` Дополнительный телефон 3 | `phones[3].number` | объединение |  |
| 89 | `contact.email` Email | `email` | перенос |  |
| 90 | `contact.organization_name` Название организации / агентства | `agency_name` | перенос |  |
| 91 | `contact.organization_unp` УНП организации | `agency_unp` | перенос |  |
| 92 | `contact.communication_method` Способ связи | `contact_method` | перенос |  |
| 93 | `contact.organization_address` Юридический адрес / адрес регистрации | `agency_legal_address` | перенос |  |
| 94 | `contact.agency_contract_number` Номер договора | `agency_contract_number` | перенос |  |
| 95 | `contact.agency_contract_date` Дата заключения договора | `agency_contract_date` | перенос | `date` → `text` ГГГГ-ММ-ДД (вопрос 2) |
| 96 | `contact.agency_licence_number` Номер лицензии | `agency_licence_number` | перенос |  |
| 97 | `contact.agency_licence_date` Дата выдачи лицензии | `agency_licence_date` | перенос | `date` → `text` ГГГГ-ММ-ДД (вопрос 2) |
| 98 | `contact.call_time_from` Звонить с | `call_from` | перенос | «9:00» → 9 |
| 99 | `contact.call_time_to` Звонить до | `call_to` | перенос | «18:00» → 18 |
| 100 | `contact.messengers` Мессенджеры телефона 1 | `phones[0].messengers` | объединение |  |
| 101 | `contact.additional_phone_1_messengers` Мессенджеры телефона 2 | `phones[1].messengers` | объединение |  |
| 102 | `contact.additional_phone_2_messengers` Мессенджеры телефона 3 | `phones[2].messengers` | объединение |  |
| 103 | `contact.additional_phone_3_messengers` Мессенджеры телефона 4 | `phones[3].messengers` | объединение |  |
| | **Фотографии и материалы** (`group.media`) | | | |
| 104 | `media.images` Фотографии квартиры | `photos` | объединение | поле ссылок и фото на сервере (фаза 5) → одно понятие; ссылки в форму не попадали, при миграции удаляются |
| 105 | `media.youtube_video` Видео квартиры на YouTube | `video_url` | перенос | список ссылок → одна ссылка; остальные → «Сверьте» |
| 106 | `media.floor_plan` Фото планировки | — | удаляется | только Realt, вручную; в редакторе — поле ссылок, файлов планировки на сервере нет |
| 107 | `media.tour_3d` 3D тур | — | удаляется | только Realt, платное «Спецпредложение», вручную |
| | **Дополнительные сведения** (`group.additional`) | | | |
| 108 | `listing.short_description` Краткое описание | `short_description` | перенос |  |
| 109 | `listing.promotion_text` Рекламный текст | — | удаляется | только Domovita, платный тариф «Максимальный» (схема), вручную |
| | **Адрес (производные значения)** (`group.address_projection`) | | | |
| 110 | `location.settlement` Населённый пункт | `address.settlement` | объединение | проекция адреса: не хранится значением, движок читает `address` |
| 111 | `location.street` Улица | `address.street` | объединение |  |
| 112 | `location.house_number` Номер дома | `address.house` | объединение |  |
| 113 | `location.latitude` Широта | `address.latitude` | объединение |  |
| 114 | `location.longitude` Долгота | `address.longitude` | объединение |  |

## 3. Решения по проблемам ревью

| Проблема (ревью, «Модель данных») | Решение |
| --- | --- |
| Площадь, этаж, цена — текст | `decimal(м²)`, `integer`, `money`; единица — в модели (`CardFields.UNITS/ROLES` уходят, стиль цены — по типу `money`). Проверки карточки «этаж ≤ этажность» и «жилая/кухня ≤ общей» — один список в card.json вместо кода `CardChecks` и копий в планах Realt и Domovita. Округлять движок не будет: 54,35 м² на Kufar (шаг 0,1) — замечание, как сейчас. Пороги Kufar («больше 30» у этажа и этажности, «1950 или ранее», «более 10») — одно преобразование «число → код по диапазону» в mapping (4 поля); «5+» комнат — обычный lookup кодов `5`–`7`. |
| «Да/нет» пятью способами | Один `triState` (`true` / `false` / нет ключа) для 7 фактов: торг, комиссия, продажа, проходная комната, студенты, дети, животные. Удобства и дом — `multiEnum`: во всех четырёх планах «нет» удобства → `null`, явное «нет» не нужно ни одной площадке. Исключения с явным «нет» — `furniture` (Kufar «Без мебели», Realt «нет») и арендаторы (Onliner «Не студентам», «Без детей», «Без животных»). Один список карточки раскладывается по нескольким спискам формы (Kufar: быт, кухня, ванная): в mapping — подмножество, пункт без кода в этом поле пропускается. |
| Два механизма перечислений, общий словарь подписей | Варианты `{code, label}` внутри поля; `canonicalValues` и `valueLabels` удаляются («Два» у санузла и балкона — разные подписи). ИИ получает варианты из поля, вывод числового типа из планов (`AiCard`) уходит. |
| Коды вперемешку с подписями | Латинские коды; существующие латинские коды сохранены (меньше миграции), русские переименованы (`layout`, `window_view`, `housing_market`, `utilities`, `preferred_tenant`, станции, мессенджеры, часы). Нативные значения — только в mapping. Найдено и уходит: в Kufar-маппинге метро 7 исходных подписей не совпадают с вариантами карточки («Октябрьская (Купаловская)» и др.). |
| Метро — 9 полей Realt | `metro: list<{station, minutes, mode}>`, до 3 строк (у Realt — три строки, схема). Mapping Realt: `metro[i]` → `metro_{i+1}_*`; Kufar — `deferred`. |
| Телефоны и мессенджеры — 4 + 4 поля Domovita | `phones: list<{number, messengers}>`, до 4 (Realt `maxNumber=4`, схема). `phones[0]` → основной телефон всех площадок, `phones[1..3]` → доп. Domovita и Realt, `messengers` → Domovita. Проверка Domovita «один мессенджер — у одного номера» (схема) — в её mapping. Номер хранится в E.164, формат площадки — преобразование `phone` в mapping, как сейчас. Профиль кабинета подставляет `phones[0].number`, `contact_name`, `agency_name`. |
| Минские справочники для всей страны | Остаётся один: станции метро. Поле `metro` применимо только к адресу в Минске — решает сервер по `address.settlement` (DaData «г Минск»), кабинет показывает ответ `POST fields`. Смена дома сбрасывает `metro` и `residential_complex` с «Вернуть» (как «Рядом с домом» сейчас). Микрорайон удалён: его вывел бы только Kufar, и он выводит сам. Станции по координатам дома — нужен справочник координат станций, которого нет ни в одном источнике; вне 7b. |
| Две сущности «фото» | `photos` — фото карточки на сервере (`rental_photos`, фаза 5), значения в `values` нет; поле ссылок `media.images` удаляется. Mapping: `photos` → `files`-контрол; «площадка требует фото» — из `required` схемы, как сейчас. Планировка и 3D — не фото квартиры, удалены (раздел 2). |
| Адресная проекция | 5 полей `location.*` и `addressProjection` уходят: `address` — понятие, mapping берёт части (`address.label`, `.settlement`, …). |

Набросок для 7b (ключи окончательно — в реализации, неизвестные запрещены):

```json
{"id": "metro", "label": "Ближайшее метро", "type": "list", "max": 3, "group": "nearby",
 "when": {"city": "Минск"},
 "item": [{"id": "station", "type": "enum", "options": [{"code": "nemiga", "label": "Немига"}]},
          {"id": "minutes", "type": "integer", "unit": "мин"},
          {"id": "mode", "type": "enum", "options": [{"code": "walk", "label": "Пешком"}]}]}
```

Карточка: `"values": {"rooms": "2", "area_total": 54.3, "floor": 5, "rent": {"amount": 450,
"currency": "USD"}, "pets": false, "appliances": ["refrigerator", "tv"], "metro": [{"station":
"nemiga", "minutes": 7, "mode": "walk"}], "phones": [{"number": "+375291234567", "messengers":
["viber"]}]}`, `address` — как сейчас.

## 4. Площадки: что закрывается

Покрытие по нативным полям, как считает `--rental-coverage` (transferred / manual / deferred / constant):

| Площадка | Сейчас | v3 | Что меняется |
| --- | --- | --- | --- |
| Kufar | 32 / 6 / 12 / 3 | **32 / 4 / 14 / 3** | метро и микрорайон: manual → deferred |
| Onliner | 19 / 0 / 0 / 1 | **19 / 0 / 0 / 1** | — |
| Realt | 29 / 26 / 0 / 4 | **29 / 23 / 1 / 4** | расстояние: manual → deferred; планировка-файл и 3D — понятия удалены |
| Domovita | 19 / 11 / 2 / 2 | **19 / 10 / 2 / 2** | рекламный текст — понятие удалён |

`transferred` и `constant` не уменьшаются нигде. `manual` уменьшается только там, где карточка
перестаёт спрашивать то, что пользователь всё равно вводил на площадке; поле формы остаётся для
ввода там. Запись `поле ← понятие`; в скобках — что меняется по содержанию.

**Kufar.**
Transferred (32): title, description, rooms (5–7 → «5+»), floor ← floor (> 30 → «больше 30»),
total_floors ← floors_total, year_built ← building_year (≤ 1950 → «1950 или ранее»), wall_material,
bathroom, balcony («балкон» → «Есть»), repair, currency ← rent.currency, price ← rent.amount,
prepayment («3 месяца» → «Три и более месяца»), contact_method, photos, total_area, living_area,
kitchen_area ← area_*, household_amenities ← furniture + appliances + comforts, kitchen_amenities ←
appliances + comforts, bathroom_amenities ← appliances + comforts, building_amenities ←
building_features, rental_conditions ← students + pets + children + suitable_for, unfurnished ←
furniture, walk_through_room, sleeping_places (≥ 11 → «более 10»), window_orientation ← window_view,
new_building ← building_features, condition ← housing_market, contact_name, contact_phone ← phones[0],
address_text ← address.label.
Manual (4): video ← video_url (только партнёрам), company_address ← agency_legal_address, company_vat ←
agency_unp (профиль организации не исследован), residential_complex (выбор ЖК не исследован).
Deferred (14): адрес и координаты (10), company_ad, ad_video_enabled; **новые** — address_metro и
address_microdistrict: служебные поля геокодера без элемента формы (схема: «C сортирует станции по
distance_to…», «геокодер передаёт microDistrict»). Constant (3): category, transaction_type, price_mode.

**Onliner.**
Transferred (19): description, room_count ← rooms, price_currency ← rent.currency, price_amount ←
rent.amount, contact_owner ← landlord, contact_name, contact_phone ← phones[0], agency_name, agency_unp,
agency_contract_number/date, agency_licence_number/date, call_time_from/to ← call_from/to, images ←
photos, facilities ← balcony («два» → «Лоджия или балкон») + furniture + appliances + comforts,
rent_rules ← students + pets + children (значение «нет»), address_query ← address.label.
Constant (1): rent_type = flat.

**Realt.**
Transferred (29): title, description, short_description, rooms (5–7 → «5+»), separate_rooms, balcony,
repair, furniture, stove ← appliances (газовая/электрическая плита), telephone_lines ← comforts
(«landline» → «есть»), currency, monthly_rent ← rent, prepayment, bargain, utilities,
tenant_condition ← preferred_tenant, total_area, living_area, floor, building_floors ← floors_total,
building_year, photos, contact_name, contact_email ← email, contact_phone_1 ← phones[0], settlement,
street, house_number, building_number ← address.
Manual (23): за «Все параметры» — building_type ← wall_material, bathroom (два/три → «2 и более»),
kitchen_area, layout (+ `rooms = studio` → «студия»), major_repair_year; списки с «Применить» —
appliances, amenities ← comforts + building_features; infrastructure ← building_features; после входа —
communication_method, contact_phone_2–4 ← phones[1–3]; youtube_video ← video_url (платное);
residential_complex; metro_1–3 station/mode/minutes ← metro[0–2] (9).
Deferred (1): town_distance — Realt подставляет из населённого пункта (схема). Убраны из mapping:
floor_plan, tour_3d. Constant (4): deal_type, property_family, property_kind, rental_term = 999.

**Domovita.**
Transferred (19): rooms, area_total, area_living, area_kitchen, storey ← floor, storeys ← floors_total,
monthly_price ← rent.amount, currency ← rent.currency, account_type ← landlord, contact_name,
contact_phone ← phones[0], email, images ← photos, description, amenities ← furniture + appliances +
comforts + building_features, tenant_conditions ← students + pets + children, town, street,
house_number ← address.
Manual (10): additional_phone_1–3 ← phones[1–3] (кнопка «Добавить другой номер»), четыре набора
мессенджеров ← phones[0–3].messengers, has_commission ← commission, sale_planned (флажки без имени и id),
video ← video_url (одна ссылка — прежняя причина «в карточке список» снята, нужен элемент формы).
Deferred (2): position_x/y. Убран из mapping: promotion_text. Constant (2): action, property_type.

## 5. Вопросы владельцу

1. **Число понятий — 55 при ориентире 20–40.** Рекомендую принять. Сократить можно так:
   (а) убрать 5 понятий, которые сейчас только «вручную» и только на одной площадке (`layout`,
   `major_repair_year`, `commission`, `sale_planned`, `agency_legal_address`) — 50, `transferred` не
   меняется, но вернуть их после привязки форм — новая версия модели и миграция; (б) дополнительно
   перенести реквизиты агентства и часы звонков (9) в профиль кабинета — 41 в карточке, нужен
   серверный профиль (новая таблица и API).
2. **Тип даты.** В наборе типов нет `date`, а даты договора и лицензии агентства Onliner — поле даты
   (схема: `type=date`, ГГГГ-ММ-ДД). Добавить тип `date` (рекомендую: календарь в редакторе) или
   оставить `text` с проверкой формата?
3. **Ремонт: две шкалы.** Kufar — вид отделки (7 вариантов), Realt — состояние (4), общий только
   «евроремонт». Сопоставлять ли перекрёстно, например «требуется ремонт» и «аварийное» → Realt
   «плохое состояние», «дизайнерский» → «евроремонт»? Это решение о смысле, а не факт площадки. Без него — как сейчас: каждая площадка получает только свои варианты.

Решено по доказательствам (не вопросы): метро остаётся (Realt даёт править станции, минуты и способ —
знание арендодателя; схема и отчёт Realt); микрорайон и расстояние удалены (площадки выводят сами);
неоднозначные значения при миграции — в «Сверьте», а не угадываются; новые сопоставления — только где
подпись площадки прямо покрывает значение («5+», «Три и более», «2 и более», «Есть», «Лоджия или
балкон», «есть», «студия»).

**Нужно исследование** (для 7b и фазы 8; модель от них не зависит):

- Kufar: `BYR` («р.») — это BYN? Пока цена в BYN на Kufar не переносится (как сейчас).
- Kufar: включает ли «больше 30» этаж 30, а «более 10» — 10 спальных мест? Пока 30 и 10 не переносятся.
- Kufar: «Балкон: Два» — подходит ли для «балкон и лоджия»?
- Realt: сколько комнат указывать для студии (планировка «студия»)? Пока «Комнат» пусто — замечание
  `required`, как сейчас.
- Domovita: селектор ссылки YouTube (`youtube_link` в отчёте) — тогда `video_url` → transferred.
- Kufar: `contact_name` и `contact_phone` в схеме — «UI disabled, значения профиля»; после входа
  проверить, что расширение их действительно заполняет (сейчас `transferred`).
