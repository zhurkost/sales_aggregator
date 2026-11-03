# Фаза 6 — типизированный движок и одна правда о применимости

Цель: убрать сырой JSON из серверной логики и дублирование правил в TypeScript. Поведение
для пользователя не меняется — это чистый рефакторинг под защитой существующих тестов.

## Задачи

### 1. Модель справочников и карточки на records

- Пакет `rental/model`: `FieldDef`, `FieldType` (enum), `Choice`, `Condition`
  (sealed: `All`, `Any`, `Not`, `Compare`), `MappingRule`, `Conversion`
  (sealed: `Identity`, `Lookup`, `ListLookup`, `MultiLookup`, `Decimal`, `Phone`,
  `PlainTextHtml`, `Files`), `FormRecipe`, `FormControl`, `Card`, `Address`.
- Комплект разбирается в эти типы один раз (Jackson databind, `FAIL_ON_UNKNOWN_PROPERTIES`).
  `ReferenceValidator` проверяет уже типизированную модель.
- `PreparationEngine`, `RuleExecutor`, `FieldValidation`, `AddressPreparation`,
  `Conditions`, `EditorSchemaBuilder`, `RentalBrowserPreparation` переписываются на эти типы.
  `JsonNode` остаётся только в контроллерах при разборе входа и в DTO ответа.
- `ArchitectureTest` (лучше на ArchUnit) запрещает `com.fasterxml.jackson.databind.JsonNode`
  в `rental/model`, `rental/engine`, `rental/application`.

### 2. Применимость полей вычисляет только сервер

Сейчас условия считаются и в `Conditions.java`, и в `conditions.ts`, а `RentalViewModel.context()`
частично повторяет подготовку (identity/decimal/lookup).

- Новый эндпоинт или поле в ответе `prepare`/`editor-state`: для текущей карточки и выбранных
  площадок — список видимых полей, их обязательность и доступные варианты.
- Фронтенд запрашивает его с задержкой после правки (как проверку) и рисует ответ.
- Удалить `frontend/src/app/rental/conditions.ts`, `context()`, `availableExtras`,
  `waitingExtras`, `nativeChoices` и передачу `rules`/`bindings`/`conditions` площадок в браузер.
- Тесты: поле, зависящее от числового условия, видно одинаково для сервера и UI
  (UI просто показывает ответ сервера).

### 3. Фронтенд на signals и HttpClient

- `RentalDraftStore` — injectable-сервис с `signal`/`computed`; компоненты читают сигналы.
  Геттеры, пересчитываемые на каждом цикле (`mainFields`, `additionalGroups`,
  `additionalFilled`, `groupedIssues`), становятся `computed`.
- `rentalApi` заменить на `HttpClient` с interceptor: заголовок `X-Autopost-Workspace`,
  разбор ошибок (включая не-JSON из фазы 1A).
- Аренда — отдельный маршрут `/rental` (Router уже в зависимостях), а не ветка
  `view === "rental"` в `AppComponent`.
- Существующие тесты переписать под новый API store, сценарии сохранить.

### 4. Жёсткие ID полей в коде

ID общих полей, которые код использует (`listing.description`, `listing.title`, адресные
`location.*`, этаж/этажность), вынести в одно место — константы модели карточки на сервере
и сгенерированные из них TS-константы. Хаки `id.includes("area")` → «м²» и стиль по
`rental.monthly_price` заменить свойствами поля из модели (`unit`, `role`).

## Приёмка

Все существующие сценарии тестов сохраняются и зелёные; `conditions.ts` удалён; в
`rental/engine` и `rental/model` нет `JsonNode`; раздел «Фаза 6» в `progress.md`.
