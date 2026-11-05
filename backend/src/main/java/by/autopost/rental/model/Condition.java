package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * When a native field or option applies, with three outcomes: a condition on a field without a
 * value is {@link Truth#UNKNOWN}, and negation keeps it unknown.
 */
public sealed interface Condition
    permits Condition.All, Condition.Any, Condition.Not, Condition.Compare {
  enum Truth {
    YES,
    NO,
    UNKNOWN;

    /** Both must apply: a field inside a group applies only where the group does. */
    public Truth and(Truth other) {
      return this == NO || other == NO ? NO : this == UNKNOWN || other == UNKNOWN ? UNKNOWN : YES;
    }
  }

  Truth test(Map<String, Value> values);

  /** The fields this condition reads. */
  void fields(Set<String> into);

  /** A condition that may be absent: none means it applies. */
  static Truth test(Condition condition, Map<String, Value> values) {
    return condition == null ? Truth.YES : condition.test(values);
  }

  record All(List<Condition> all) implements Condition {
    public All {
      all = List.copyOf(all);
    }

    @Override
    public Truth test(Map<String, Value> values) {
      boolean unknown = false;
      for (var c : all) {
        Truth t = c.test(values);
        if (t == Truth.NO) return Truth.NO;
        unknown |= t == Truth.UNKNOWN;
      }
      return unknown ? Truth.UNKNOWN : Truth.YES;
    }

    @Override
    public void fields(Set<String> into) {
      for (var c : all) c.fields(into);
    }
  }

  record Any(List<Condition> any) implements Condition {
    public Any {
      any = List.copyOf(any);
    }

    @Override
    public Truth test(Map<String, Value> values) {
      boolean unknown = false;
      for (var c : any) {
        Truth t = c.test(values);
        if (t == Truth.YES) return Truth.YES;
        unknown |= t == Truth.UNKNOWN;
      }
      return unknown ? Truth.UNKNOWN : Truth.NO;
    }

    @Override
    public void fields(Set<String> into) {
      for (var c : any) c.fields(into);
    }
  }

  record Not(Condition not) implements Condition {
    @Override
    public Truth test(Map<String, Value> values) {
      Truth t = not.test(values);
      return t == Truth.UNKNOWN ? t : t == Truth.YES ? Truth.NO : Truth.YES;
    }

    @Override
    public void fields(Set<String> into) {
      not.fields(into);
    }
  }

  enum Operator {
    EQUALS,
    NOT_EQUALS,
    IN,
    NOT_IN,
    EXISTS,
    GT,
    GTE,
    LT,
    LTE;

    static Operator of(Object code) {
      for (var operator : values())
        if (operator.name().toLowerCase(Locale.ROOT).equals(code)) return operator;
      throw new IllegalArgumentException("неизвестная операция условия " + code);
    }
  }

  /** {@code expected} is null only for {@link Operator#EXISTS}. */
  record Compare(String field, Operator operator, Value expected) implements Condition {
    public Compare {
      if (operator != Operator.EXISTS && expected == null)
        throw new IllegalArgumentException("в условии отсутствует сравниваемое значение");
      if ((operator == Operator.IN || operator == Operator.NOT_IN)
          && !(expected instanceof Value.Items))
        throw new IllegalArgumentException("условие in требует список");
    }

    @Override
    public Truth test(Map<String, Value> values) {
      Value actual = values.get(field);
      if (operator == Operator.EXISTS) return Value.missing(actual) ? Truth.NO : Truth.YES;
      if (Value.missing(actual)) return Truth.UNKNOWN;
      boolean result;
      switch (operator) {
        case EQUALS -> result = actual.same(expected);
        case NOT_EQUALS -> result = !actual.same(expected);
        case IN, NOT_IN -> {
          result = ((Value.Items) expected).items().stream().anyMatch(actual::same);
          if (operator == Operator.NOT_IN) result = !result;
        }
        default -> {
          if (!(actual instanceof Value.Num a) || !(expected instanceof Value.Num e))
            return Truth.UNKNOWN;
          int c = a.value().compareTo(e.value());
          result =
              switch (operator) {
                case GT -> c > 0;
                case GTE -> c >= 0;
                case LT -> c < 0;
                default -> c <= 0;
              };
        }
      }
      return result ? Truth.YES : Truth.NO;
    }

    @Override
    public void fields(Set<String> into) {
      into.add(field);
    }
  }

  /**
   * Parses one condition of a source schema: exactly one of {@code all}, {@code any}, {@code not}
   * or a comparison {@code option_id}/{@code operator}/{@code value}.
   */
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  static Condition of(Map<String, Object> raw) {
    if (raw == null) throw new IllegalArgumentException("некорректное условие применимости");
    int forms = 0;
    for (String key : List.of("not", "all", "any", "option_id")) if (raw.containsKey(key)) forms++;
    if (forms != 1) throw new IllegalArgumentException("условие должно содержать одну операцию");
    if (raw.containsKey("not")) return new Not(child(raw.get("not")));
    for (String kind : List.of("all", "any"))
      if (raw.containsKey(kind)) {
        if (!(raw.get(kind) instanceof List<?> list))
          throw new IllegalArgumentException("неверный список условий");
        List<Condition> children = new ArrayList<>();
        for (Object child : list) children.add(child(child));
        return kind.equals("all") ? new All(children) : new Any(children);
      }
    if (!(raw.get("option_id") instanceof String field))
      throw new IllegalArgumentException("условие ссылается на неизвестное поле");
    var operator = Operator.of(raw.get("operator"));
    return new Compare(
        field, operator, raw.containsKey("value") ? Value.of(raw.get("value")) : null);
  }

  @SuppressWarnings("unchecked")
  private static Condition child(Object raw) {
    if (!(raw instanceof Map<?, ?> map))
      throw new IllegalArgumentException("некорректное условие применимости");
    return of((Map<String, Object>) map);
  }
}
