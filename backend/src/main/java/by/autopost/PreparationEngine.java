package by.autopost;

import static by.autopost.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.math.*;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Pure transformations. No HTTP, profile mutation or publication. Plans are operator-owned data.
 */
class PreparationEngine {
  static final String VERSION = "1.0";

  enum Truth {
    YES,
    NO,
    UNKNOWN
  }

  static BigDecimal decimal(JsonNode input, boolean integer) {
    if (!input.isTextual()) throw new IllegalArgumentException("Введите число текстом.");
    String value = input.asText().strip();
    if (value.length() > 64
        || !(value.matches("[+-]?\\d+(?:[.,]\\d+)?")
            || value.matches("[+-]?\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+(?:[.,]\\d+)?")))
      throw new IllegalArgumentException(
          "Нужно однозначное число: например, 45,5. Без диапазона или единицы измерения.");
    BigDecimal number =
        new BigDecimal(value.replaceAll("[ \\u00a0\\u202f]", "").replace(',', '.'))
            .stripTrailingZeros();
    if (integer && number.scale() > 0)
      throw new IllegalArgumentException(
          "Площадка принимает только целое число; исправьте сумму без автоматического округления.");
    if (number.abs().compareTo(new BigDecimal("9007199254740991")) > 0)
      throw new IllegalArgumentException("Число слишком велико.");
    return number;
  }

  static String phone(JsonNode input, String format) {
    if (!input.isTextual())
      throw new IllegalArgumentException("Телефон должен оставаться строкой.");
    String value = input.asText().strip();
    if (!value.matches("[+0-9 ()\\-\\u00a0]+"))
      throw new IllegalArgumentException(
          "Проверьте телефон: только номер, без добавочного и букв.");
    value = value.replaceAll("[ ()\\-\\u00a0]", "");
    if (value.matches("(?:25|29|33|44|17)\\d{7}")) value = "+375" + value;
    if (value.matches("375(?:25|29|33|44|17)\\d{7}")) value = "+" + value;
    if (!value.matches("\\+[1-9]\\d{7,14}"))
      throw new IllegalArgumentException("Укажите полный телефон с кодом страны, например +375…");
    if (format.equals("BY_NATIONAL")) {
      if (!value.matches("\\+375(?:25|29|33|44|17)\\d{7}"))
        throw new IllegalArgumentException(
            "Для этой площадки нужен белорусский телефон допустимого формата.");
      return value.substring(4);
    }
    if (!format.equals("E164"))
      throw new IllegalArgumentException("Формат телефона площадки ещё не подтверждён.");
    return value;
  }

  static boolean missing(JsonNode value) {
    return value == null
        || value.isMissingNode()
        || value.isNull()
        || value.isTextual() && value.asText().isBlank()
        || value.isArray() && value.isEmpty();
  }

  static boolean equal(JsonNode a, JsonNode b) {
    if (a == null || b == null) return false;
    if (a.isNumber() && b.isNumber()) return a.decimalValue().compareTo(b.decimalValue()) == 0;
    return a.equals(b);
  }

  static Truth when(JsonNode condition, ObjectNode values) {
    if (condition == null || condition.isMissingNode()) return Truth.YES;
    if (condition.has("not")) {
      Truth t = when(condition.get("not"), values);
      return t == Truth.UNKNOWN ? t : t == Truth.YES ? Truth.NO : Truth.YES;
    }
    for (String kind : List.of("all", "any"))
      if (condition.has(kind)) {
        boolean unknown = false;
        for (var c : condition.get(kind)) {
          Truth t = when(c, values);
          if (kind.equals("all") && t == Truth.NO) return Truth.NO;
          if (kind.equals("any") && t == Truth.YES) return Truth.YES;
          unknown |= t == Truth.UNKNOWN;
        }
        return unknown ? Truth.UNKNOWN : kind.equals("all") ? Truth.YES : Truth.NO;
      }
    JsonNode actual = values.path(text(condition, "option_id")), expected = condition.path("value");
    String op = text(condition, "operator");
    if (op.equals("exists")) return missing(actual) ? Truth.NO : Truth.YES;
    if (missing(actual)) return Truth.UNKNOWN;
    boolean result;
    switch (op) {
      case "equals" -> result = equal(actual, expected);
      case "not_equals" -> result = !equal(actual, expected);
      case "in", "not_in" -> {
        result = list(expected).stream().anyMatch(v -> equal(actual, v));
        if (op.equals("not_in")) result = !result;
      }
      case "gt", "gte", "lt", "lte" -> {
        if (!actual.isNumber() || !expected.isNumber()) return Truth.UNKNOWN;
        int c = actual.decimalValue().compareTo(expected.decimalValue());
        result =
            switch (op) {
              case "gt" -> c > 0;
              case "gte" -> c >= 0;
              case "lt" -> c < 0;
              default -> c <= 0;
            };
      }
      default -> {
        return Truth.UNKNOWN;
      }
    }
    return result ? Truth.YES : Truth.NO;
  }

  static Map<String, JsonNode> fields(JsonNode category) {
    Map<String, JsonNode> result = new LinkedHashMap<>();
    for (var c : category) collect(c.path("options"), result);
    return result;
  }

  static void collect(JsonNode options, Map<String, JsonNode> result) {
    for (var o : options) {
      if (!text(o, "type").equals("choice")) result.put(text(o, "id"), o);
      if (text(o, "type").equals("group")) collect(o.path("options"), result);
    }
  }

  static JsonNode lookup(JsonNode pairs, JsonNode input) {
    for (var p : pairs) if (equal(p.path("from"), input)) return p.path("to").deepCopy();
    throw new IllegalArgumentException(
        "У площадки нет точного соответствия этому значению. Уточните его отдельно.");
  }

  static void issue(ArrayNode issues, String field, String code, String message) {
    if (list(issues).stream()
        .noneMatch(i -> text(i, "field").equals(field) && text(i, "code").equals(code)))
      issues.add(object("field", field, "code", code, "message", message));
  }

  ObjectNode prepare(
      JsonNode schema, JsonNode plan, ObjectNode common, ObjectNode extras, JsonNode address) {
    if (!text(plan, "runtime_version").equals(VERSION))
      throw new ApiException(409, "Версия правил подготовки не поддерживается.");
    Map<String, JsonNode> fields = fields(schema);
    ObjectNode values = object();
    ArrayNode issues = array();
    // All extras are explicit per-platform input, not a way to alter a server-owned mapping plan.
    extras
        .fields()
        .forEachRemaining(
            e -> {
              if (!fields.containsKey(e.getKey()))
                issue(
                    issues,
                    e.getKey(),
                    "unknown_field",
                    "Поле отсутствует в текущей схеме площадки.");
              else if (!missing(e.getValue())) {
                JsonNode value = e.getValue();
                String type = text(fields.get(e.getKey()), "type");
                if (value.isTextual() && Set.of("integer", "number").contains(type)) {
                  try {
                    BigDecimal n = decimal(value, type.equals("integer"));
                    value =
                        type.equals("integer")
                            ? BigIntegerNode.valueOf(n.toBigIntegerExact())
                            : DecimalNode.valueOf(n);
                  } catch (IllegalArgumentException ex) {
                    issue(issues, e.getKey(), "conversion", ex.getMessage());
                    return;
                  }
                }
                values.set(e.getKey(), value.deepCopy());
              }
            });
    plan.path("constants")
        .fields()
        .forEachRemaining(
            e -> {
              if (values.has(e.getKey()) && !equal(values.get(e.getKey()), e.getValue()))
                issue(
                    issues,
                    e.getKey(),
                    "route_conflict",
                    "Тип объекта или сделки не соответствует долгосрочной аренде квартиры.");
              values.set(e.getKey(), e.getValue().deepCopy());
            });
    Map<String, JsonNode> rules = new LinkedHashMap<>();
    for (var row : plan.path("fields")) rules.put(text(row, "platform_option_id"), row);
    Set<String> visiting = new HashSet<>(), done = new HashSet<>();
    for (String target : rules.keySet())
      apply(target, rules, fields, common, values, issues, visiting, done);
    for (var coordinate : plan.path("coordinates")) {
      String target = text(coordinate, "platform_option_id"), axis = text(coordinate, "axis");
      JsonNode lat = common.path("location.latitude"), lon = common.path("location.longitude");
      if (missing(lat) && missing(lon)) continue;
      try {
        BigDecimal latitude = decimal(lat, false), longitude = decimal(lon, false);
        if (!address.path("confirmed").asBoolean(false)
            || !text(address, "precision").equals("0")
            || latitude.compareTo(decimal(address.path("latitude"), false)) != 0
            || longitude.compareTo(decimal(address.path("longitude"), false)) != 0
            || latitude.abs().compareTo(new BigDecimal("90")) > 0
            || longitude.abs().compareTo(new BigDecimal("180")) > 0)
          throw new IllegalArgumentException(
              "Подтвердите точную точку дома; координаты должны соответствовать выбранному"
                  + " адресу.");
        JsonNode v =
            axis.equals("pair")
                ? TextNode.valueOf(latitude.toPlainString() + "," + longitude.toPlainString())
                : DecimalNode.valueOf(axis.equals("latitude") ? latitude : longitude);
        if (values.has(target) && !equal(values.get(target), v))
          issue(
              issues,
              target,
              "coordinate_conflict",
              "Координаты площадки и выбранного адреса различаются.");
        else values.set(target, v);
      } catch (IllegalArgumentException e) {
        issue(issues, target, "coordinate", e.getMessage());
      }
    }
    // Resolve only confirmed labels/codes from this form's dictionary. Never reuse a DaData/OSM ID
    // as a marketplace ID.
    for (var row : plan.path("addresses")) {
      String target = text(row, "platform_option_id"), part = text(row, "part");
      JsonNode field = fields.get(target);
      if (field == null) continue;
      if (!address.path("confirmed").asBoolean(false)) {
        if (!missing(values.get(target)) && !row.path("scalar_verified").asBoolean(false))
          issue(
              issues,
              target,
              "native_address_object",
              "Подтвердите адрес в форме площадки: одного вручную выбранного кода недостаточно.");
        continue;
      }
      if (missing(values.get(target))) {
        String label = text(address, part);
        var matches =
            list(field.path("options")).stream()
                .filter(c -> normalized(text(c, "name")).equals(normalized(label)))
                .toList();
        if (!label.isBlank() && matches.size() == 1 && row.path("scalar_verified").asBoolean(false))
          values.set(target, matches.get(0).path("fill_rule").path("value").deepCopy());
        else
          issue(
              issues,
              target,
              "marketplace_address",
              "Адрес выбран у нас; подтвердите соответствующий адрес в справочнике площадки. Её"
                  + " внутренние коды отличаются.");
      }
      if (!row.path("scalar_verified").asBoolean(false))
        issue(
            issues,
            target,
            "native_address_object",
            "Для этой площадки нужен подтверждённый адресный объект и точка карты; одного"
                + " идентификатора недостаточно.");
    }
    for (var c : schema) validate(c.path("options"), Truth.YES, values, issues);
    for (var check : plan.path("checks")) crossCheck(check, values, issues);
    for (var block : plan.path("review")) {
      String id = text(block, "field");
      if (id.isEmpty() || !missing(values.get(id)))
        issue(issues, id, "adapter_review", text(block, "message"));
    }
    return object(
        "platform",
        text(plan, "platform"),
        "values",
        values,
        "issues",
        issues,
        "dataReady",
        issues.isEmpty(),
        "publicationReady",
        false,
        "runtimeVersion",
        VERSION);
  }

  void apply(
      String target,
      Map<String, JsonNode> rules,
      Map<String, JsonNode> fields,
      ObjectNode common,
      ObjectNode values,
      ArrayNode issues,
      Set<String> visiting,
      Set<String> done) {
    if (done.contains(target)) return;
    if (!visiting.add(target))
      throw new ApiException(409, "Цикл зависимостей в правилах подготовки.");
    JsonNode row = rules.get(target), field = fields.get(target);
    if (field == null) throw new ApiException(409, "Правила не соответствуют версии справочника.");
    var cv = row.path("conversion");
    for (var dep : cv.path("requires"))
      if (rules.containsKey(dep.asText()))
        apply(dep.asText(), rules, fields, common, values, issues, visiting, done);
    boolean dependencies =
        list(cv.path("requires")).stream()
            .allMatch(
                d ->
                    !missing(values.get(d.asText()))
                        && list(issues).stream()
                            .noneMatch(i -> text(i, "field").equals(d.asText())));
    String cid = text(row, "common_option_id");
    JsonNode input = common.path(cid);
    try {
      String kind = text(cv, "kind");
      if (kind.equals("multi_lookup")) {
        ArrayNode merged = array();
        JsonNode prior = values.path(target);
        if (!missing(prior) && !prior.isArray())
          throw new IllegalArgumentException("Выберите несколько значений из списка площадки.");
        if (prior.isArray()) prior.forEach(v -> merged.add(v.deepCopy()));
        boolean supplied = !missing(prior);
        for (var member : cv.path("members")) {
          JsonNode v = common.path(text(member, "common_option_id"));
          if (missing(v)) continue;
          supplied = true;
          try {
            JsonNode code = lookup(member.path("values"), v);
            if (list(merged).stream().noneMatch(x -> equal(x, code))) merged.add(code);
          } catch (IllegalArgumentException e) {
            issue(issues, target, "list_value", e.getMessage());
          }
        }
        if (supplied) values.set(target, merged);
      } else if (!missing(input)) {
        if (!dependencies)
          throw new IllegalArgumentException(
              "Сначала уточните связанные поля, например валюту суммы.");
        JsonNode output;
        switch (kind) {
          case "identity" -> output = input.deepCopy();
          case "lookup" -> output = lookup(cv.path("values"), input);
          case "decimal" -> {
            BigDecimal n = decimal(input, text(cv, "target").equals("integer"));
            String currency = values.path(text(cv, "currency_field")).asText();
            if (has(cv.path("integer_currencies"), currency) && n.scale() > 0)
              throw new IllegalArgumentException(
                  "В выбранной валюте площадка изменяет дробную цену; укажите целую сумму.");
            output =
                text(cv, "target").equals("integer")
                    ? BigIntegerNode.valueOf(n.toBigIntegerExact())
                    : DecimalNode.valueOf(n);
          }
          case "phone" -> output = TextNode.valueOf(phone(input, text(cv, "format")));
          case "plain_text_html" -> {
            if (!input.isTextual()) throw new IllegalArgumentException("Нужно текстовое описание.");
            String text =
                input
                    .asText()
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\"", "&quot;")
                    .replace("'", "&#39;");
            output =
                TextNode.valueOf(
                    "<p>"
                        + text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")
                        + "</p>");
          }
          case "files" -> {
            if (!input.isArray())
              throw new IllegalArgumentException(
                  "Вложения должны быть списком ссылок на оригиналы.");
            for (var url : input)
              if (!url.isTextual() || !url.asText().matches("https://[^\\s]+"))
                throw new IllegalArgumentException("Нужны ссылки HTTPS на исходные вложения.");
            output = input.deepCopy();
            issue(
                issues,
                target,
                "file_acceptance",
                "Нужно проверить параметры оригиналов и принятие файлов площадкой; порядок и файлы"
                    + " сохранены.");
          }
          default -> throw new IllegalArgumentException("Этот обработчик ещё не поддерживается.");
        }
        if (values.has(target) && !equal(values.get(target), output))
          issue(
              issues,
              target,
              "conflict",
              "Общее поле и уточнение площадки противоречат друг другу. Выберите верное значение.");
        else values.set(target, output);
      }
    } catch (IllegalArgumentException e) {
      issue(issues, target, "conversion", text(field, "name") + ": " + e.getMessage());
    }
    visiting.remove(target);
    done.add(target);
  }

  static String normalized(String value) {
    return value.strip().toLowerCase(Locale.ROOT).replace('ё', 'е').replaceAll("\\s+", " ");
  }

  void validate(JsonNode options, Truth parent, ObjectNode values, ArrayNode issues) {
    for (var field : options) {
      String id = text(field, "id"), type = text(field, "type");
      JsonNode rule = field.path("fill_rule"), v = values.path(id);
      Truth own = when(rule.get("when"), values);
      Truth active =
          parent == Truth.NO || own == Truth.NO
              ? Truth.NO
              : parent == Truth.UNKNOWN || own == Truth.UNKNOWN ? Truth.UNKNOWN : Truth.YES;
      if (type.equals("group")) {
        validate(field.path("options"), active, values, issues);
        continue;
      }
      if (active == Truth.NO) {
        values.remove(id);
        continue;
      }
      if (active == Truth.UNKNOWN) {
        if (!missing(v) || rule.path("required").asBoolean(false))
          issue(
              issues, id, "condition", text(field, "name") + ": сначала заполните связанные поля.");
        values.remove(id);
        continue;
      }
      if (missing(v)) {
        if (rule.path("required").asBoolean(false))
          issue(issues, id, "required", "Заполните: " + text(field, "name"));
        continue;
      }
      try {
        validateValue(field, v);
        if (type.equals("enum") || type.equals("multi_enum")) {
          for (var selected : type.equals("enum") ? List.of(v) : list(v)) {
            var matching =
                list(field.path("options")).stream()
                    .filter(c -> equal(c.path("fill_rule").path("value"), selected))
                    .toList();
            if (matching.stream()
                .noneMatch(c -> when(c.path("fill_rule").get("when"), values) == Truth.YES))
              throw new IllegalArgumentException(
                  "выбранный вариант недоступен при текущих связанных полях.");
          }
        }
      } catch (IllegalArgumentException e) {
        issue(issues, id, "validation", text(field, "name") + ": " + e.getMessage());
      }
    }
  }

  static void validateValue(JsonNode field, JsonNode v) {
    String type = text(field, "type");
    JsonNode validation = field.path("fill_rule").path("validation");
    boolean ok =
        switch (type) {
          case "text", "date", "datetime" -> v.isTextual();
          case "boolean" -> v.isBoolean();
          case "integer" -> v.isIntegralNumber();
          case "number" -> v.isNumber();
          case "files", "multi_enum" -> v.isArray();
          case "enum" -> !v.isContainerNode();
          default -> false;
        };
    if (!ok) throw new IllegalArgumentException("неверный тип значения.");
    if (type.equals("enum") || type.equals("multi_enum")) {
      for (var choice : type.equals("enum") ? List.of(v) : list(v))
        if (list(field.path("options")).stream()
            .noneMatch(c -> equal(c.path("fill_rule").path("value"), choice)))
          throw new IllegalArgumentException("значение отсутствует в подтверждённом справочнике.");
      if (type.equals("multi_enum") && new HashSet<>(list(v)).size() != v.size())
        throw new IllegalArgumentException("повторяющиеся варианты.");
    }
    if (v.isNumber()) {
      BigDecimal n = v.decimalValue();
      for (String key : List.of("min", "max", "exclusive_min", "exclusive_max", "multiple_of"))
        if (validation.path(key).isNumber()) {
          BigDecimal bound = validation.get(key).decimalValue();
          int c = n.compareTo(bound);
          boolean invalid =
              switch (key) {
                case "min" -> c < 0;
                case "max" -> c > 0;
                case "exclusive_min" -> c <= 0;
                case "exclusive_max" -> c >= 0;
                default -> bound.signum() <= 0 || n.remainder(bound).signum() != 0;
              };
          if (invalid)
            throw new IllegalArgumentException(
                "значение не соответствует ограничению " + key + "=" + bound.toPlainString() + ".");
        }
    }
    int length = v.isArray() ? v.size() : v.isTextual() ? v.asText().length() : 0;
    String min = v.isArray() ? "min_items" : "min_length",
        max = v.isArray() ? "max_items" : "max_length";
    if (validation.path(min).isNumber() && length < validation.get(min).asInt()
        || validation.path(max).isNumber() && length > validation.get(max).asInt())
      throw new IllegalArgumentException("проверьте длину или количество значений.");
    if (v.isTextual() && validation.path("pattern").isTextual()) {
      // Only this documented ASCII subset is portable. Unknown constructs fail closed.
      String pattern = validation.get("pattern").asText();
      if (pattern.contains("(?") || pattern.matches(".*\\\\[1-9pPuU].*") || pattern.length() > 500)
        throw new IllegalArgumentException(
            "сложное правило JavaScript требует проверки в форме площадки.");
      pattern = pattern.replace("[\\w-\\.]", "[\\w.\\-]");
      try {
        if (!Pattern.compile(pattern).matcher(v.asText()).matches())
          throw new IllegalArgumentException("не соответствует формату площадки.");
      } catch (java.util.regex.PatternSyntaxException e) {
        throw new IllegalArgumentException("правило формата требует проверки в форме площадки.");
      }
    }
    if (type.equals("date"))
      try {
        java.time.LocalDate.parse(v.asText());
      } catch (Exception e) {
        throw new IllegalArgumentException("дата должна иметь формат YYYY-MM-DD.");
      }
  }

  void crossCheck(JsonNode c, ObjectNode values, ArrayNode issues) {
    String left = text(c, "left"), right = text(c, "right");
    JsonNode a = values.path(left), b = values.path(right);
    if (a.isNumber() && b.isNumber() && a.decimalValue().compareTo(b.decimalValue()) > 0)
      issue(issues, left, "cross_field", text(c, "message"));
  }
}
