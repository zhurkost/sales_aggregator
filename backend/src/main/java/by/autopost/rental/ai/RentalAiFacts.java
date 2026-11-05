package by.autopost.rental.ai;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Deterministic relationships for numbers that the model can otherwise conflate. */
final class RentalAiFacts {
  private static final String ROOMS = "rental.room_configuration";
  private static final String SEPARATE = "rental.separate_rooms";

  static boolean spelledRoomCount(String value, String quote) {
    String prefix = Map.of("1", "одно", "2", "двух|дву", "3", "трех|трёх",
        "4", "четырех|четырёх", "5", "пяти", "6", "шести", "7", "семи").get(value);
    return prefix != null && Pattern.compile("(?iu)(?<![\\p{L}])(?:" + prefix + ")комнатн\\p{L}*")
        .matcher(quote).find();
  }

  static void reconcile(JsonNode editor, String source, Map<String, ObjectNode> accepted,
      Set<String> conflicts) {
    var fields = RentalAiPolicy.fields(editor);
    if (accepted.containsKey(ROOMS) || accepted.containsKey(SEPARATE)) {
      Map<String, ObjectNode> explicit = new LinkedHashMap<>();
      var rooms = Pattern.compile(
          "(?iu)(?<![\\p{L}\\d])(?:всего\\s+)?(\\d+)\\s+(?:(раздельн\\p{L}*|изолированн\\p{L}*)\\s+)?комнат[аы]?(?:\\s+(раздельн\\p{L}*|изолированн\\p{L}*))?")
          .matcher(source);
      while (rooms.find()) {
        String id = rooms.group(2) != null || rooms.group(3) != null ? SEPARATE : ROOMS;
        var previous = explicit.put(id, object("field", id, "value", rooms.group(1), "quote", rooms.group()));
        if (previous != null && !text(previous, "value").equals(rooms.group(1))) conflicts.add(id);
      }
      var separate = Pattern.compile("(?iu)(?<![\\p{L}\\d])(\\d+)\\s+(?:раздельн|изолированн)\\p{L}*")
          .matcher(source);
      while (separate.find()) {
        var previous = explicit.put(SEPARATE,
            object("field", SEPARATE, "value", separate.group(1), "quote", separate.group()));
        if (previous != null && !text(previous, "value").equals(separate.group(1))) conflicts.add(SEPARATE);
      }
      explicit.forEach((id, entry) -> put(editor, fields, accepted, conflicts, id,
          text(entry, "value"), text(entry, "quote")));
      if (explicit.size() == 1 && conflicts.isEmpty()) {
        var entry = explicit.values().iterator().next();
        String other = explicit.containsKey(ROOMS) ? SEPARATE : ROOMS;
        put(editor, fields, accepted, conflicts, other, text(entry, "value"), text(entry, "quote"));
      }
      for (String id : Set.of(ROOMS, SEPARATE)) if (conflicts.contains(id)) accepted.remove(id);
      for (String id : Set.of(ROOMS, SEPARATE)) {
        String other = id.equals(ROOMS) ? SEPARATE : ROOMS;
        if (!accepted.containsKey(id) && accepted.containsKey(other)
            && text(accepted.get(other), "value").matches("[1-9]\\d*"))
          put(editor, fields, accepted, conflicts, id, text(accepted.get(other), "value"),
              text(accepted.get(other), "quote"));
      }
      if (accepted.containsKey(ROOMS) && accepted.containsKey(SEPARATE)
          && text(accepted.get(ROOMS), "value").matches("\\d+")) {
        var total = new java.math.BigDecimal(text(accepted.get(ROOMS), "value"));
        if (new java.math.BigDecimal(text(accepted.get(SEPARATE), "value")).compareTo(total) > 0) {
          accepted.remove(SEPARATE);
          conflicts.add(SEPARATE);
        }
      }
    }
    if (accepted.containsKey("rental.floor") || accepted.containsKey("building.total_floors")) {
      var floors = Pattern.compile("(?iu)(?:этаж\\s*(\\d+)\\s*(?:из|/)\\s*(\\d+)|(\\d+)\\s*(?:-?й\\s*)?этаж\\s*(?:из|/)\\s*(\\d+)|(\\d+)\\s*/\\s*(\\d+)\\s*этаж)").matcher(source);
      Map<String, ObjectNode> explicit = new LinkedHashMap<>();
      while (floors.find()) {
        int offset = floors.group(1) != null ? 1 : floors.group(3) != null ? 3 : 5;
        for (var e : Map.of("rental.floor", floors.group(offset),
            "building.total_floors", floors.group(offset + 1)).entrySet()) {
          var previous = explicit.put(e.getKey(), object("value", e.getValue(), "quote", floors.group()));
          if (previous != null && !text(previous, "value").equals(e.getValue())) conflicts.add(e.getKey());
        }
      }
      explicit.forEach((id, entry) -> put(editor, fields, accepted, conflicts, id,
          text(entry, "value"), text(entry, "quote")));
      for (String id : Set.of("rental.floor", "building.total_floors"))
        if (conflicts.contains(id)) accepted.remove(id);
    }
  }

  private static void put(JsonNode editor, Map<String, JsonNode> fields,
      Map<String, ObjectNode> accepted, Set<String> conflicts, String id, String value, String quote) {
    if (!fields.containsKey(id) || conflicts.contains(id)) return;
    var valid = RentalAiPolicy.validValue(fields.get(id), editor.path("canonicalValues").path(id),
        TextNode.valueOf(value), quote);
    if (valid != null) accepted.put(id, object("field", id, "value", valid, "quote", quote));
  }
}
