package by.autopost.rental.preparation;

import static by.autopost.rental.model.Conditions.*;
import static by.autopost.rental.model.Values.*;
import static by.autopost.rental.preparation.PreparationIssues.*;
import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.regex.Pattern;

public final class FieldValidation {
  public void validate(JsonNode options, Truth parent, ObjectNode values, ArrayNode issues) {
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
        for (int i = issues.size() - 1; i >= 0; i--)
          if (text(issues.get(i), "field").equals(id)) issues.remove(i);
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
        if (rule.path("required").asBoolean(false)
            && list(issues).stream().noneMatch(i -> text(i, "field").equals(id)))
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

  public static void validateValue(JsonNode field, JsonNode v) {
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

  public void crossCheck(JsonNode c, ObjectNode values, ArrayNode issues) {
    String left = text(c, "left"), right = text(c, "right");
    JsonNode a = values.path(left), b = values.path(right);
    if (a.isNumber() && b.isNumber() && a.decimalValue().compareTo(b.decimalValue()) > 0)
      issue(issues, left, "cross_field", text(c, "message"));
  }
}
