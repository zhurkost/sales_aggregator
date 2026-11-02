package by.autopost.rental.model;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;

public final class SchemaFields {
  public static Map<String, JsonNode> fields(JsonNode category) {
    Map<String, JsonNode> result = new LinkedHashMap<>();
    for (var c : category) collect(c.path("options"), result);
    return result;
  }

  public static void collect(JsonNode options, Map<String, JsonNode> result) {
    for (var o : options) {
      if (!text(o, "type").equals("choice")) result.put(text(o, "id"), o);
      if (text(o, "type").equals("group")) collect(o.path("options"), result);
    }
  }
}
