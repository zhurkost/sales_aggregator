package by.autopost;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

final class Json {
  static final ObjectMapper MAPPER = new ObjectMapper();

  static ObjectNode object(Object... pairs) {
    ObjectNode n = MAPPER.createObjectNode();
    for (int i = 0; i < pairs.length; i += 2)
      n.set((String) pairs[i], MAPPER.valueToTree(pairs[i + 1]));
    return n;
  }

  static ArrayNode array() {
    return MAPPER.createArrayNode();
  }

  static ArrayNode array(Collection<?> list) {
    return MAPPER.valueToTree(list);
  }

  static JsonNode parse(String text) {
    try {
      return MAPPER.readTree(text);
    } catch (Exception e) {
      throw new ApiException(400, "Некорректный JSON.");
    }
  }

  static String text(JsonNode n, String k) {
    return n == null ? "" : n.path(k).asText("");
  }

  static String clean(JsonNode n, String k, int size) {
    return clean(n == null ? null : n.get(k), size);
  }

  static String clean(JsonNode n, int size) {
    String s = n != null && n.isTextual() ? n.asText().trim() : "";
    return s.substring(0, Math.min(size, s.length()));
  }

  static List<JsonNode> list(JsonNode n) {
    List<JsonNode> r = new ArrayList<>();
    if (n != null && n.isArray()) n.forEach(r::add);
    return r;
  }

  static boolean has(JsonNode n, String v) {
    return list(n).stream().anyMatch(x -> x.asText().equals(v));
  }

  static boolean id(String id) {
    return id != null && id.matches("[a-zA-Z0-9_-]{1,80}");
  }
}
