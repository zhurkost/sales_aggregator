package by.autopost.rental.catalog;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;

/** Source schemas use format 1.2: the facts of a field are nested in its fill_rule. */
final class SourceSchemaValidator {
  private static final Set<String> FACTS =
      Set.of("value", "required", "validation", "when", "file_role");

  private SourceSchemaValidator() {}

  static void validate(JsonNode schema) {
    if (!schema.isArray() || schema.size() != 1)
      throw new ApiException(409, "Для редактора нужен комплект одной конечной категории.");
    for (var category : schema) {
      if (!category.path("categories").isEmpty())
        throw new ApiException(409, "Выделите конечную категорию без наследования полей.");
      options(category.path("options"));
    }
  }

  private static void options(JsonNode options) {
    if (!options.isArray()) throw new ApiException(409, "У поля нужен массив options.");
    for (var field : options) {
      if (!field.isObject()) throw new ApiException(409, "Поле схемы должно быть объектом.");
      if (FACTS.stream().anyMatch(field::has))
        throw new ApiException(409, "Факты поля указываются в fill_rule (формат схем 1.2).");
      options(field.path("options"));
    }
  }
}
