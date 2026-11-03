# Фаза 2 — удалить совместимость, дубли и мёртвые настройки

Цель: уменьшить объём кода и данных, не меняя поведения для пользователя. Каждое удаление —
отдельный коммит; после каждого все тесты зелёные.

## Задачи

### 1. Исследовательские файлы — отдельно от рабочих

- Создать `research/rental/apartments_long_term_rent/<platform>/` и перенести туда:
  отчёты `data/parsing/**/report_*.txt`, исследовательские bindings
  (`data/rental/**/bindings_*.json`), исследовательские маппинги
  (`data/rental/**/integration/mapping_*.json`), задания `docs/parsing/apartments_long_term_rent/**`.
- Устаревшие копии схем в `data/parsing/apartments_long_term_rent/*.json` удалить: рабочие
  версии лежат в `data/rental/…`, а старые есть в истории Git. Перед удалением проверить
  `diff`, что в старых копиях нет полей, отсутствующих в рабочих; если есть — перечислить их
  в отчёте фазы, не удалять молча.
- Обновить ссылки в документации и `manifest.json`.

### 2. Удалить адаптеры форматов, которые не используются

Рабочий комплект — формат 1.2 с manifest. Удалить:

- путь формата 2.1 в `SchemaCompatibility` и `BindingValidator` (bindings 2.1 нигде не
  исполняются);
- режим «без manifest» в `FileReferenceRepository` (`LEGACY_CATEGORY`, пути по умолчанию,
  реестр из `card.json`);
- запасной путь `integration/integration-audit.json` в `EditorSchemaBuilder`;
- ветки для `card.version < 2` (`RentalCatalog.normalize`, `EditorSchemaBuilder`).

Тесты, проверявшие эти режимы (`ReferenceBundleTest`, пример 2.1 в
`backend/src/test/resources/reference-example/`), удалить или переписать под 1.2.

### 3. Миграция старых карточек — один раз, а не на каждом чтении

`CardMigration.normalize` работает при каждом `GET drafts/{id}` и при публикации; на экране
есть блок «Сверьте прежние сведения» (`legacy`, `resolvedLegacy`).

- Добавить команду `--migrate-rental-drafts`, которая один раз переводит все записи
  `rental_drafts` с `modelVersion < 2` в текущий формат и пишет отчёт (сколько записей,
  сколько неоднозначных значений сохранено в `legacy`).
- Чтение и публикация больше не вызывают миграцию: карточка с `modelVersion < 2` даёт 409
  «Карточку нужно перенести командой миграции».
- Блок «Сверьте прежние сведения» оставить только для карточек, где после миграции есть
  непустой `legacy`.
- `deploy/spring/deploy-release.sh` запускает миграцию перед переключением релиза.
- Тесты: миграция идемпотентна; чтение не меняет данные; публикация v1-карточки отклоняется.

### 4. Мёртвые ключи в планах и рецептах

- Удалить из `runtime/preparation_*.json` ключи, которые не читает код: `on_unmapped`,
  `on_incompatible`, `preparation.operations` (проверить поиском ещё раз).
- `ReferenceValidator` и `BrowserRecipeValidator` отклоняют неизвестные ключи (явный
  список допустимых для каждого объекта). Ключи, которые читает расширение
  (`stepSelector`, `optionsSelector`, `displaySelector`, `triggerSelector`, `uiLabels`,
  `label`, `absent`, `matchText`, `selectedClass`), добавить в список и проверить по типу.
- Тесты: неизвестный ключ в плане или рецепте отклоняется с понятным сообщением.

### 5. Фронтенд: делегаты и мёртвые методы

- `RentalEditorComponent`: убрать прокси-геттеры и делегаты (строки с `get schema()` …
  `set filledOnly`), шаблон обращается к `store`, `ai`, `view` напрямую.
- Удалить неиспользуемые `setExtra`, `toggleExtra`, `extraFiles`, `extra`, `selected`,
  `availableExtras`, `waitingExtras`, `nativeChoices`, `extraFileText` и связанные части
  `RentalViewModel`, если шаблоны их не используют (проверить сборкой).

### 6. Инфраструктура, которая «не нужна»

- `ops/cloudflare-dadata-probe/` — временная проверка связи, удалить.
- `deploy/cloudflare/` и `scripts/prepare-cloudflare-*` — README называет Cloudflare Containers
  ненужными. **Удалять только после подтверждения владельца** (вопрос записать в отчёт).

## Приёмка

Поведение для пользователя не изменилось (все существующие тесты, кроме удалённых вместе
с режимами, зелёные). В отчёте — сколько строк кода и файлов удалено.
