package by.autopost.rental.catalog;

import static by.autopost.rental.catalog.ReferenceValidator.check;
import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.Set;

/** Validate executable configuration, without executing or guessing a conversion. */
final class ConversionValidator {
  void validate(JsonNode conversion) {
    if (conversion.has("requires"))
      check(conversion.path("requires").isArray(), "requires должен быть массивом");
    switch (text(conversion, "kind")) {
      case "lookup", "list_lookup" -> pairs(conversion.path("values"));
      case "multi_lookup" -> {
        check(
            conversion.path("members").isArray() && !conversion.path("members").isEmpty(),
            "пустой состав multi_lookup");
        Set<String> members = new HashSet<>();
        for (var member : conversion.path("members")) {
          ReferenceValidator.keys(
              member, "состав multi_lookup", Set.of("common_option_id", "values"));
          check(members.add(text(member, "common_option_id")), "повторный источник multi_lookup");
          pairs(member.path("values"));
        }
      }
      case "decimal" ->
          check(
              Set.of("integer", "number").contains(text(conversion, "target")),
              "неверный числовой тип назначения");
      case "phone" ->
          check(
              Set.of("BY_NATIONAL", "E164").contains(text(conversion, "format")),
              "неизвестный формат телефона");
      default -> {
        /* The handler allowlist is checked by ReferenceValidator. */
      }
    }
  }

  private void pairs(JsonNode pairs) {
    // An explicitly empty table is valid partial coverage: lookup reports any supplied value
    // as unmapped. A missing/malformed table must not silently become that state.
    check(pairs.isArray(), "нет таблицы соответствий значений");
    Set<JsonNode> sources = new HashSet<>();
    for (var pair : pairs) {
      ReferenceValidator.keys(pair, "пара значений", Set.of("from", "to"));
      check(pair.has("from") && pair.has("to"), "пара значений должна содержать from и to");
      check(
          !pair.path("from").isContainerNode() && !pair.path("to").isContainerNode(),
          "ожидались скалярные коды вариантов");
      check(sources.add(pair.path("from")), "несколько соответствий одного исходного значения");
    }
  }
}
