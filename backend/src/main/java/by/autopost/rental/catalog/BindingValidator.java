package by.autopost.rental.catalog;

import static by.autopost.rental.catalog.ReferenceValidator.*;
import static by.autopost.rental.model.SchemaFields.fields;
import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Validates the parsing 2.1 boundary. A valid binding is not a supported browser adapter. */
final class BindingValidator {
  void validate(String category, String platform, JsonNode schema, JsonNode binding) {
    check(
        category.equals(text(binding, "category_id")) && platform.equals(text(binding, "platform")),
        "binding относится к другой категории или площадке");
    var leaves = new LinkedHashMap<>(fields(schema));
    leaves.entrySet().removeIf(e -> text(e.getValue(), "type").equals("group"));
    Map<String, Set<String>> graph = new LinkedHashMap<>();
    for (var item : binding.path("fields")) {
      String id = text(item, "option_id"), status = text(item, "status");
      check(
          leaves.containsKey(id) && !graph.containsKey(id),
          "binding: неизвестное или повторяющееся поле " + id);
      check(
          Set.of("ready", "needs_review", "unsupported").contains(status),
          "binding: неизвестный статус " + id);
      if (status.equals("ready")) {
        check(
            item.path("target").path("selectors").isArray()
                && !item.path("target").path("selectors").isEmpty(),
            "binding: нет селектора " + id);
        check(
            Set.of(
                    "set_value",
                    "select_option",
                    "set_checked",
                    "choose",
                    "click",
                    "autocomplete",
                    "upload_files",
                    "sequence")
                .contains(text(item, "action")),
            "binding: неподдерживаемое действие " + id);
        check(
            Set.of("value_equals", "selected_text_equals", "checked_equals", "files_accepted")
                .contains(text(item.path("verify"), "kind")),
            "binding: нет проверки результата " + id);
      } else
        check(
            !text(item, "reason").isBlank(),
            "binding: не указана причина неполной поддержки " + id);
      Set<String> dependencies = new HashSet<>();
      for (var dep : item.path("depends_on")) {
        check(leaves.containsKey(dep.asText()), "binding: неизвестный родитель " + dep.asText());
        dependencies.add(dep.asText());
      }
      graph.put(id, dependencies);
    }
    check(
        graph.keySet().equals(leaves.keySet()),
        "binding должен учитывать каждое конечное поле площадки");
    acyclic(graph);
  }
}
