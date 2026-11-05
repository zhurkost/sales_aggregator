package by.autopost.rental.engine;

import by.autopost.rental.model.Condition;
import by.autopost.rental.model.Condition.Truth;
import by.autopost.rental.model.FieldDef;
import by.autopost.rental.model.FieldType;
import by.autopost.rental.model.Mapping;
import by.autopost.rental.model.Value;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Checks the prepared native values against their schema, in schema order: a field that does not
 * apply loses its value and its remarks, a field whose condition is unknown waits for the fields
 * it depends on. Records whether each field applies.
 */
public final class FieldValidation {
  private final Map<String, Value> values;
  private final Issues issues;
  private final Map<String, Truth> applies;

  FieldValidation(Map<String, Value> values, Issues issues, Map<String, Truth> applies) {
    this.values = values;
    this.issues = issues;
    this.applies = applies;
  }

  void validate(List<FieldDef> options, Truth parent) {
    for (var field : options) {
      String id = field.id();
      Truth active = parent.and(Condition.test(field.when(), values));
      if (field.type() == FieldType.GROUP) {
        validate(field.options(), active);
        continue;
      }
      if (field.type() == FieldType.CHOICE) continue;
      applies.put(id, active);
      Value v = values.get(id);
      if (active == Truth.NO) {
        issues.remove(id);
        values.remove(id);
        continue;
      }
      if (active == Truth.UNKNOWN) {
        if (!Value.missing(v) || field.required())
          issues.add(id, "condition", field.name() + ": сначала заполните связанные поля.");
        values.remove(id);
        continue;
      }
      if (Value.missing(v)) {
        if (field.required() && !issues.has(id))
          issues.add(id, "required", "Заполните: " + field.name());
        continue;
      }
      try {
        validateValue(field, v);
        if (field.type().coded())
          for (var selected : field.type() == FieldType.ENUM ? List.of(v) : items(v)) {
            if (field.choices().stream()
                .filter(c -> Value.same(c.code(), selected))
                .noneMatch(c -> Condition.test(c.when(), values) == Truth.YES))
              throw new IllegalArgumentException(
                  "выбранный вариант недоступен при текущих связанных полях.");
          }
      } catch (IllegalArgumentException e) {
        issues.add(id, "validation", field.name() + ": " + e.getMessage());
      }
    }
  }

  private static List<Value> items(Value v) {
    return v instanceof Value.Items items ? items.items() : List.of();
  }

  /** The value has the field's type, one of its codes, and keeps its limits and format. */
  public static void validateValue(FieldDef field, Value v) {
    var type = field.type();
    var validation = field.rule().validation();
    boolean ok =
        switch (type) {
          case TEXT, DATE, DATETIME -> v instanceof Value.Text;
          case BOOLEAN -> v instanceof Value.Bool;
          case INTEGER -> v instanceof Value.Num n && n.integral();
          case NUMBER -> v instanceof Value.Num;
          case FILES, MULTI_ENUM -> v instanceof Value.Items;
          case ENUM -> !(v instanceof Value.Items);
          default -> false;
        };
    if (!ok) throw new IllegalArgumentException("неверный тип значения.");
    if (type.coded()) {
      for (var choice : type == FieldType.ENUM ? List.of(v) : items(v))
        if (field.choices().stream().noneMatch(c -> Value.same(c.code(), choice)))
          throw new IllegalArgumentException("значение отсутствует в подтверждённом справочнике.");
      if (type == FieldType.MULTI_ENUM && new HashSet<>(items(v)).size() != items(v).size())
        throw new IllegalArgumentException("повторяющиеся варианты.");
    }
    if (v instanceof Value.Num number) {
      BigDecimal n = number.value();
      bound(n, "min", validation.min());
      bound(n, "max", validation.max());
      bound(n, "exclusive_min", validation.exclusiveMin());
      bound(n, "exclusive_max", validation.exclusiveMax());
      bound(n, "multiple_of", validation.multipleOf());
    }
    int length =
        v instanceof Value.Items items
            ? items.items().size()
            : v instanceof Value.Text text ? text.value().length() : 0;
    Integer min = v instanceof Value.Items ? validation.minItems() : validation.minLength(),
        max = v instanceof Value.Items ? validation.maxItems() : validation.maxLength();
    if (min != null && length < min || max != null && length > max)
      throw new IllegalArgumentException("проверьте длину или количество значений.");
    if (v instanceof Value.Text text && validation.pattern() != null) {
      // Only this documented ASCII subset is portable. Unknown constructs fail closed.
      String pattern = validation.pattern();
      if (pattern.contains("(?") || pattern.matches(".*\\\\[1-9pPuU].*") || pattern.length() > 500)
        throw new IllegalArgumentException(
            "сложное правило JavaScript требует проверки в форме площадки.");
      pattern = pattern.replace("[\\w-\\.]", "[\\w.\\-]");
      try {
        if (!Pattern.compile(pattern).matcher(text.value()).matches())
          throw new IllegalArgumentException("не соответствует формату площадки.");
      } catch (java.util.regex.PatternSyntaxException e) {
        throw new IllegalArgumentException("правило формата требует проверки в форме площадки.");
      }
    }
    if (type == FieldType.DATE)
      try {
        java.time.LocalDate.parse(((Value.Text) v).value());
      } catch (Exception e) {
        throw new IllegalArgumentException("дата должна иметь формат YYYY-MM-DD.");
      }
  }

  private static void bound(BigDecimal n, String key, BigDecimal bound) {
    if (bound == null) return;
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

  /** {@code left} greater than {@code right}: the plan's message on the left field. */
  void crossCheck(Mapping.CrossCheck check) {
    if (values.get(check.left()) instanceof Value.Num a
        && values.get(check.right()) instanceof Value.Num b
        && a.value().compareTo(b.value()) > 0)
      issues.add(check.left(), "cross_field", check.message());
  }
}
