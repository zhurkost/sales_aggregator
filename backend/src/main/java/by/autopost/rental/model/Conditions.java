package by.autopost.rental.model;

import static by.autopost.rental.model.Values.*;
import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

public final class Conditions {
  public enum Truth {
    YES,
    NO,
    UNKNOWN
  }

  public static Truth when(JsonNode condition, ObjectNode values) {
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
}
