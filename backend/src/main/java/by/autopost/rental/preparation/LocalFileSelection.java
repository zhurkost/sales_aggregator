package by.autopost.rental.preparation;

import static by.autopost.shared.Json.*;

import by.autopost.rental.model.SchemaFields;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;

/** Browser-held files are counted for validation, never represented as uploaded URLs. */
public final class LocalFileSelection {
  public static Map<String, Integer> read(JsonNode input, JsonNode common) {
    if (input.isMissingNode()) return Map.of();
    if (!input.isObject()) throw new ApiException(400, "Некорректный список локальных файлов.");
    var fields = SchemaFields.fields(common);
    Map<String, Integer> counts = new LinkedHashMap<>();
    input.fields().forEachRemaining(entry -> {
      var field = fields.get(entry.getKey());
      var count = entry.getValue();
      if (field == null || !text(field, "type").equals("files")
          || !count.isIntegralNumber() || !count.canConvertToInt()
          || count.asInt() < 0 || count.asInt() > 1000)
        throw new ApiException(400, "Некорректное количество локальных файлов.");
      counts.put(entry.getKey(), count.asInt());
    });
    return counts;
  }

  public static Map<String, Integer> targets(
      JsonNode plan, Map<String, JsonNode> fields, Map<String, Integer> commonCounts) {
    Map<String, Integer> counts = new LinkedHashMap<>();
    for (var row : plan.path("fields")) {
      String target = text(row, "platform_option_id");
      var field = fields.get(target);
      if (field != null && text(field, "type").equals("files")
          && text(row.path("conversion"), "kind").equals("files")) {
        int count = commonCounts.getOrDefault(text(row, "common_option_id"), 0);
        if (count > 0) counts.put(target, count);
      }
    }
    return counts;
  }
}
