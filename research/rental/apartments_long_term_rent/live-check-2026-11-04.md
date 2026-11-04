# Живая проверка форм аренды — 4 ноября 2026

Chrome владельца (Windows, Claude in Chrome 1.0.104). Рецепты — `runtime/browser_<id>.json`
на коммите 3ea66a5. Скрипт на странице повторял поиск из `extension/rental-form.js`
(`query`, `targets`, `choiceScope`, `selected`) и возвращал только количества.
Нажимались только шаги выбора категории (`setup`). «Далее», «Сохранить», «Подать»
только искались. Файлы не загружались, значения полей не читались.

**Вход:** ни на одной площадке не выполнен. Kufar и Onliner без входа проверить нельзя.

Обозначения: `N/M` — всего совпадений селектора / из них видимых и доступных
(как `targets()`); «вар.» — число вариантов в найденной области.

## Kufar — заблокировано: нужен вход

`/ain/create?isUnauthorized=1`. Шаги `setup` 1–3 нашлись по одному и сработали.
`name_selected_category` = «Недвижимость Квартиры». Без входа форма показывает только
`subject`, `address`, `images`, `body`, `price` и плашку «Войдите или зарегистрируйтесь,
чтобы добавить контакты и подать объявление». Блока `[data-name="type"]` нет.

| Поле | Результат |
| --- | --- |
| title, price, description, address_text, currency | 1/1 |
| photos `#imageLoaderDropzone` | 1/0 |
| остальные 25 контролов, шаг «Долгосрочная аренда», `submit` | 0 — без входа не показываются |

## Onliner — заблокировано: нужен вход

`r.onliner.by/ak/apartments/create` перенаправляет на `profile.onliner.by/login`.

## Realt — проверено без входа

Шаги «Сдать длительно», «Жилая», «Квартира»: по 1 совпадению, сработали; `ready` — оба OK.

| Поле | Результат |
| --- | --- |
| settlement | 1/1, область автодополнения 1 |
| street, house_number, building_number | 1/0 — недоступны до выбора населённого пункта (`after`) |
| floor, total_area, living_area, building_floors, building_year, monthly_rent, short_description, bargain | 1/1 |
| contact_phone_1, contact_name, contact_email | 0 — «Войдите, чтобы добавить контакты и опубликовать объявление» |
| rooms | 1/1, 5 вар.: 1, 2, 3, 4, 5+ |
| repair | 1/1, 4 вар.: евроремонт, хороший, нормальный, плохое состояние |
| balcony | 1/1, 5 вар.: балкон, нет, лоджия, балкон и лоджия, терраса |
| currency | 1/1, 3 вар.: BYN (выбран), USD, EUR |
| utilities | 1/1, 3 вар.: нет, 50%, 100% |
| rental_term | 1/1, 6 вар.: месяц, 2 месяца, 3 месяца, полгода, год, длительный |
| prepayment | 1/1, 5 вар.: без предоплаты, месяц, 2 месяца, 3 месяца, полгода |
| tenant_condition | 1/1, 4 вар.: семье, под офис, студентам, не компаниям |
| photos `input[type=file]` [0] | 2/1 |
| next «Сохранить и продолжить» | 0 — кнопки нет в DOM без входа |

**Заголовок:** `[id="description.title"]` — `input type=text`, `maxlength=255`, 1 совпадение, видим.

**Описание (TinyMCE 7.0.0):**
- исходник — `textarea#description.description` без `name`, скрыт (`display:none`, `aria-hidden=true`);
- редактор — `iframe#description.description_ifr.tox-edit-area__iframe` без `src` и `sandbox`, same-origin, на странице один;
- внутри iframe — `body#tinymce.mce-content-body`, `contenteditable=true`, `data-id="description.description"`, пустое состояние `<p><br data-mce-bogus="1"></p>`;
- в основном мире страницы `tinymce.get()` → `["description.description"]`. Из изолированного мира content script этот объект недоступен, а DOM iframe доступен.

**Класс `text-white bg-basic` принадлежит Realt.** Это выбранная кнопка-вариант (`div[role=button]`).
Выбранная BYN: `… items-center rounded-l-md text-white bg-basic text-subhead py-1.5`.
Невыбранные USD и «2»: `… items-center bg-basic-50 text-basic-900 hover:bg-basic-100 …`.
Перенесено в рецепт как `selectedClass: "text-white"` — коммит 17af4c5.

## Domovita — проверено без входа

Шаги «Сдаче длительно» и «Квартиры»: по 1 совпадению; каждый переходит на новую страницу
(`/new/add` → `/new/add/rent` → `/new/add/flats/rent`). `ready` — оба OK.

| Поле | Результат |
| --- | --- |
| contact_name, contact_phone, email, area_total, area_kitchen, area_living, storey, storeys, monthly_price, description `.tiptap`, images | 1/1 |
| additional_phone_1, additional_phone_2 | 0 — на странице только `phones.0.contact_phone` |
| account_type `input[name="account_type"]` | 0 — такого поля на форме нет |
| rooms | 7/7 |
| amenities, tenant_conditions (общий `input[type=checkbox]`) | 12/8 |
| currency `input[role=combobox]` [3] | 4/1 |
| town [0] | 4/1 |
| street [1], house_number [2] | 4/0 — недоступны до выбора города (`after`) |
| next «Далее» | 1 |

## Что осталось открытым

- Kufar и Onliner: повторить проверку после входа владельца.
- Realt: контакты и «Сохранить и продолжить» видны только после входа.
- Domovita: `account_type` и дополнительные телефоны не найдены. Без входа причину
  установить нельзя, рецепт не менялся.
