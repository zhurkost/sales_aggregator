package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Set;

/** Source files are never rewritten. The old engine shape is an internal compatibility model. */
public final class SchemaCompatibility {
  private static final Set<String> FACTS =
      Set.of("value", "required", "validation", "when", "file_role");

  private SchemaCompatibility() {}

  public static JsonNode normalize(JsonNode source, String version) {
    if (!Set.of("1.2", "2.1").contains(version))
      throw new ApiException(409, "Неподдерживаемая версия формата справочника.");
    JsonNode copy = source.deepCopy();
    if (!copy.isArray() || copy.size() != 1)
      throw new ApiException(409, "Для редактора нужен комплект одной конечной категории.");
    for (var category : copy) {
      if (!category.path("categories").isEmpty())
        throw new ApiException(409, "Выделите конечную категорию без наследования полей.");
      normalizeOptions(category.path("options"), version);
    }
    return copy;
  }

  private static void normalizeOptions(JsonNode options, String version) {
    if (!options.isArray()) throw new ApiException(409, "У поля нужен массив options.");
    for (var field : options) {
      if (!field.isObject()) throw new ApiException(409, "Поле схемы должно быть объектом.");
      if (version.equals("2.1")) {
        if (field.has("fill_rule"))
          throw new ApiException(409, "Схема 2.1 не должна содержать fill_rule.");
        if (Set.of("enum", "multi_enum").contains(text(field, "type"))
            && !field.path("options_complete").isBoolean())
          throw new ApiException(409, "У перечисления должна быть указана полнота вариантов.");
        if (text(field, "type").equals("choice")
            && (!field.has("value") || field.path("value").isContainerNode()))
          throw new ApiException(409, "У варианта нужен скалярный код или явный null.");
        ObjectNode facts = object();
        FACTS.forEach(
            key -> {
              if (field.has(key)) facts.set(key, field.get(key));
            });
        ((ObjectNode) field).set("fill_rule", facts);
      } else if (FACTS.stream().anyMatch(field::has)) {
        throw new ApiException(409, "Для новой схемы укажите формат 2.1 в manifest.json.");
      }
      normalizeOptions(field.path("options"), version);
    }
  }
}
