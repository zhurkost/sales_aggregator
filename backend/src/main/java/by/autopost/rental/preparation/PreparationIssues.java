package by.autopost.rental.preparation;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.node.ArrayNode;

public final class PreparationIssues {
  public static void issue(ArrayNode issues, String field, String code, String message) {
    if (list(issues).stream()
        .noneMatch(i -> text(i, "field").equals(field) && text(i, "code").equals(code)))
      issues.add(object("field", field, "code", code, "message", message));
  }
}
