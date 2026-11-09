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

  static boolean stoveGrounded(String value, String quote) {
    String type = value.equals("gas") ? "газов\\p{L}*" : "электрическ\\p{L}*|электро";
    String stove = "(?:(?:" + type + ")\\s*плит\\p{L}*|плит\\p{L}*\\s+(?:" + type + "))";
    return Pattern.compile("(?iu)(?<!\\p{L})" + stove).matcher(quote).find()
        && !Pattern.compile("(?iu)(?:без|нет|не)\\s+" + stove).matcher(quote).find();
  }

  static String paymentValue(String value, String quote) {
    boolean deposit = Pattern.compile("(?iu)(?<!\\p{L})залог\\p{L}*").matcher(quote).find();
    boolean noDeposit = Pattern.compile("(?iu)(?:без\\s+залога|залог\\s+не\\s+(?:нужен|требуется)|нет\\s+залога)")
        .matcher(quote).find();
    boolean advance = Pattern.compile("(?iu)(?:предоплат|аванс|(?:оплат\\p{L}*|плат[её]ж\\p{L}*)\\s+(?:за\\s+\\S+\\s+)?впер[её]д)")
        .matcher(quote).find();
    if (value.equals("none") && !advance) return null;
    if (value.startsWith("months_")) {
      // The legacy code stores the presence of a deposit, not its amount.
      if (deposit && !noDeposit && !advance) return "deposit_unspecified";
      if (!advance) return null;
    }
    if (value.equals("deposit_unspecified") && (!deposit || noDeposit)) return null;
    return value;
  }

  static boolean houseAdvanceGrounded(String value, String quote) {
    String code = switch (value) {
      case "нет" -> "none";
      case "месяц" -> "months_1";
      case "2 месяца" -> "months_2";
      case "3 месяца" -> "months_3";
      case "полгода" -> "months_6";
      default -> "";
    };
    // Domovita has no deposit-only option. Never turn a deposit into an advance.
    return !code.isEmpty() && code.equals(paymentValue(code, quote));
  }

  private static final Map<String, String> ROOM_PREFIXES = Map.of("1", "одно", "2", "двух|дву",
      "3", "трех|трёх", "4", "четырех|четырёх", "5", "пяти", "6", "шести", "7", "семи");

  private static final Map<String, String> HEIGHTS = Map.ofEntries(
      Map.entry("одно", "1"), Map.entry("двух", "2"), Map.entry("трех", "3"), Map.entry("четырех", "4"),
      Map.entry("пяти", "5"), Map.entry("шести", "6"), Map.entry("семи", "7"), Map.entry("восьми", "8"),
      Map.entry("девяти", "9"), Map.entry("десяти", "10"), Map.entry("одиннадцати", "11"),
      Map.entry("двенадцати", "12"), Map.entry("шестнадцати", "16"));
  private static final Map<String, String> FLOOR_ORDINALS = Map.of(
      "первом", "1", "втором", "2", "третьем", "3", "четвертом", "4", "пятом", "5",
      "шестом", "6", "седьмом", "7", "восьмом", "8", "девятом", "9", "десятом", "10");
  private static final String HOUSE_MATERIAL = "(?:(?:панельного|кирпичного|блочного|монолитного|деревянного)\\s+)?";
  private static final String WRITTEN_HEIGHT = "(" + String.join("|", HEIGHTS.keySet()).replace("е", "[её]")
      + ")этажного\\s+" + HOUSE_MATERIAL + "дома\\b";
  private static final Pattern WRITTEN_FLOORS = Pattern.compile(
      "(?iu)(?<![\\p{L}\\d])(?:\\d+(?:-?(?:м|ом|ем))?|"
          + String.join("|", FLOOR_ORDINALS.keySet()).replace("е", "[её]") + ")\\s+этаже\\s+" + WRITTEN_HEIGHT);
  private static final Pattern FLOOR_IN_WORDS = Pattern.compile("(?iu)\\bна\\s+("
      + String.join("|", FLOOR_ORDINALS.keySet()).replace("четвертом", "четв[её]ртом") + ")\\s+этаже\\b");
  static boolean spelledFloor(String quote, String value) {
    var floor = FLOOR_IN_WORDS.matcher(quote);
    while (floor.find())
      if (apartmentFloor(quote, floor) && floorOrdinal(floor.group(1)).equals(value)) return true;
    return false;
  }
  private static boolean apartmentFloor(String source, java.util.regex.Matcher floor) {
    String lead = source.substring(0, floor.start()).replaceFirst("(?s)^.*(?:[.!?;]\\s+|\\n)", "").strip();
    String tail = source.substring(floor.end()).stripLeading();
    return (lead.isEmpty() || lead.matches("(?iu).*(?:квартир[ауы]|студия|студию)(?:\\s+[\\d,.]+\\s*м[²2])?\\s*,?"))
        && (tail.isEmpty() || ".,;:!?".indexOf(tail.charAt(0)) >= 0 || tail.matches("(?isu)^" + WRITTEN_HEIGHT + ".*"));
  }
  private static String floorOrdinal(String word) {
    return FLOOR_ORDINALS.get(word.toLowerCase(java.util.Locale.ROOT).replace('ё', 'е'));
  }

  static boolean spelledHeight(String quote, String value) {
    var match = WRITTEN_FLOORS.matcher(quote.toLowerCase(java.util.Locale.ROOT).replace('ё', 'е'));
    while (match.find()) if (value.equals(HEIGHTS.get(match.group(1)))) return true;
    return false;
  }

  private static final Pattern COZY_TITLE = Pattern.compile(
      "(?iu)^уютная\\s+(?=квартира\\b|студия\\b|[\\p{L}\\d-]*комнатная\\b)");
  private static final Pattern COZY_APARTMENT = Pattern.compile(
      "(?iu)\\bуютн(?:ая|ую|ой)\\s+(?:квартир(?:а|у|ы|е|ой)|студи\\p{L}*|[\\p{L}\\d-]*комнатн\\p{L}*)\\b"
          + "|\\b(?:квартира|студия)\\s+(?:очень\\s+)?уютная\\b");

  static String groundedTitle(String title, String source) {
    var prefix = COZY_TITLE.matcher(title);
    if (!prefix.find()) return title;
    var evidence = COZY_APARTMENT.matcher(source);
    while (evidence.find()) {
      if (!source.substring(0, evidence.start()).matches("(?isu).*\\bне\\s+(?:(?:очень|слишком|особенно)\\s+)?$")) return title;
    }
    String rest = title.substring(prefix.end());
    return Character.toUpperCase(rest.charAt(0)) + rest.substring(1);
  }

  static boolean supportedCopy(String copy, String source) {
    for (String claim : java.util.List.of("(?iu)\\bв\\s+центре\\b", "(?iu)\\bсветл(?:ая|ый|ое|ые|ую|ой|ыми|ых|ого|ом)\\b"))
      if (Pattern.compile(claim).matcher(copy).find() && !Pattern.compile(claim).matcher(source).find()) return false;
    return true;
  }

  private static final Map<String, String> ROOM_NUMERALS = Map.of(
      "одна", "1", "одну", "1", "две", "2", "три", "3", "четыре", "4",
      "пять", "5", "шесть", "6", "семь", "7");
  private static final String ROOM_COUNT = "(\\d+|" + String.join("|", ROOM_NUMERALS.keySet()) + ")";
  private static final Pattern SEPARATE_COUNT = Pattern.compile("(?iu)(?<![\\p{L}\\d])" + ROOM_COUNT
      + "\\s+(?:раздельн|изолированн)\\p{L}*(?=\\s+комнат|\\s*(?:$|[,.;:!?])|\\s+и\\s+\\S+\\s+проходн)");
  private static final Pattern WALK_THROUGH_COUNT = Pattern.compile("(?iu)(?<![\\p{L}\\d])" + ROOM_COUNT
      + "\\s+проходн\\p{L}*(?=\\s+комнат|\\s*(?:$|[,.;:!?]))");
  private static String roomNumber(String token) {
    return ROOM_NUMERALS.getOrDefault(token.toLowerCase(java.util.Locale.ROOT), token);
  }

  static boolean spelledRoomCount(String value, String quote) {
    var separate = SEPARATE_COUNT.matcher(quote);
    while (separate.find()) if (roomNumber(separate.group(1)).equals(value)) return true;
    String prefix = ROOM_PREFIXES.get(value);
    if (value.equals("1") && Pattern.compile("(?iu)(?<!\\p{L})одн(?:а|у)\\s+комнат[ау](?!\\p{L})").matcher(quote).find()) return true;
    return prefix != null && Pattern.compile("(?iu)(?<![\\p{L}])(?:" + prefix + ")комнатн\\p{L}*")
        .matcher(quote).find();
  }

  static void reconcile(JsonNode editor, String source, Map<String, ObjectNode> accepted,
      Set<String> conflicts) {
    var fields = RentalAiPolicy.fields(editor);
    if (accepted.containsKey(ROOMS) || accepted.containsKey(SEPARATE)) {
      Map<String, ObjectNode> explicit = new LinkedHashMap<>();
      for (var entry : ROOM_PREFIXES.entrySet()) {
        var written = Pattern.compile("(?iu)(?<!\\p{L})(?:" + entry.getValue() + ")комнатн\\p{L}*").matcher(source);
        if (written.find() && explicit.put(ROOMS, object("value", entry.getKey(), "quote", written.group())) != null)
          conflicts.add(ROOMS);
      }
      var rooms = Pattern.compile(
          "(?iu)(?<![\\p{L}\\d])(?:всего\\s+)?" + ROOM_COUNT + "\\s+(?:(раздельн\\p{L}*|изолированн\\p{L}*)\\s+)?комнат[аы]?(?:\\s+(раздельн\\p{L}*|изолированн\\p{L}*))?")
          .matcher(source);
      while (rooms.find()) {
        String id = rooms.group(2) != null || rooms.group(3) != null ? SEPARATE : ROOMS;
        var previous = explicit.put(id, object("field", id, "value", roomNumber(rooms.group(1)), "quote", rooms.group()));
        if (previous != null && !text(previous, "value").equals(roomNumber(rooms.group(1)))) conflicts.add(id);
      }
      var separate = SEPARATE_COUNT.matcher(source);
      while (separate.find()) {
        var previous = explicit.put(SEPARATE,
            object("field", SEPARATE, "value", roomNumber(separate.group(1)), "quote", separate.group()));
        if (previous != null && !text(previous, "value").equals(roomNumber(separate.group(1)))) conflicts.add(SEPARATE);
      }
      var walkThrough = WALK_THROUGH_COUNT.matcher(source);
      if (walkThrough.find() && !roomNumber(walkThrough.group(1)).matches("0+")
          && !accepted.containsKey("rental.walk_through_room") && !conflicts.contains("rental.walk_through_room")
          && fields.containsKey("rental.walk_through_room")) {
        accepted.put("rental.walk_through_room",
            object("field", "rental.walk_through_room", "value", true, "quote", walkThrough.group()));
      }
      explicit.forEach((id, entry) -> put(editor, fields, accepted, conflicts, id,
          text(entry, "value"), text(entry, "quote")));
      boolean hasWalkThrough = accepted.containsKey("rental.walk_through_room")
          && accepted.get("rental.walk_through_room").path("value").asBoolean();
      if (!hasWalkThrough && explicit.size() == 1 && conflicts.isEmpty()) {
        var entry = explicit.values().iterator().next();
        String other = explicit.containsKey(ROOMS) ? SEPARATE : ROOMS;
        if (!accepted.containsKey(other))
          put(editor, fields, accepted, conflicts, other, text(entry, "value"), text(entry, "quote"));
      }
      for (String id : Set.of(ROOMS, SEPARATE)) if (conflicts.contains(id)) accepted.remove(id);
      for (String id : Set.of(ROOMS, SEPARATE)) {
        String other = id.equals(ROOMS) ? SEPARATE : ROOMS;
        if (!hasWalkThrough && !accepted.containsKey(id) && accepted.containsKey(other)
            && text(accepted.get(other), "value").matches("[1-9]\\d*"))
          put(editor, fields, accepted, conflicts, id, text(accepted.get(other), "value"),
              text(accepted.get(other), "quote"));
      }
      if (accepted.containsKey(ROOMS) && accepted.containsKey(SEPARATE)
          && text(accepted.get(ROOMS), "value").matches("\\d+")) {
        var total = new java.math.BigDecimal(text(accepted.get(ROOMS), "value"));
        int comparison = new java.math.BigDecimal(text(accepted.get(SEPARATE), "value")).compareTo(total);
        if (comparison > 0 || (comparison == 0 && hasWalkThrough)) {
          accepted.remove(SEPARATE);
          conflicts.add(SEPARATE);
        }
      }
    }
    if (!accepted.isEmpty()) {
      var noBalcony = Pattern.compile("(?iu)(?:^|[.!?;]\\s*)(балкона\\s+нет|без\\s+балкона)\\s*(?=[.!?;]|$)").matcher(source);
      if (noBalcony.find()) {
        String other = source.substring(0, noBalcony.start()) + source.substring(noBalcony.end());
        if (!Pattern.compile("(?iu)\\b(?:балкон|лоджи)\\p{L}*").matcher(other).find())
          put(editor, fields, accepted, conflicts, "rental.balcony", "none", noBalcony.group(1));
      }
    }
  }

  static void reconcileFloors(JsonNode editor, Map<String, JsonNode> fields, String source,
      Map<String, ObjectNode> accepted, Set<String> conflicts, String floorId, String heightId) {
    var floors = Pattern.compile("(?iu)(?:этаж\\s*(\\d+)\\s*(?:из|/)\\s*(\\d+)|(\\d+)\\s*(?:-?й\\s*)?этаж\\s*(?:из|/)\\s*(\\d+)|(\\d+)\\s*/\\s*(\\d+)\\s*этаж)").matcher(source);
    Map<String, ObjectNode> explicit = new LinkedHashMap<>();
    var floorInWords = FLOOR_IN_WORDS.matcher(source);
    while (floorInWords.find()) {
      // An amenity on another floor is not the floor of the apartment.
      if (!apartmentFloor(source, floorInWords)) continue;
      String value = floorOrdinal(floorInWords.group(1));
      var previous = explicit.put(floorId, object("value", value, "quote", floorInWords.group()));
      if (previous != null && !text(previous, "value").equals(value)) conflicts.add(floorId);
    }
    var writtenFloors = WRITTEN_FLOORS.matcher(source);
    while (writtenFloors.find()) {
      String height = HEIGHTS.get(writtenFloors.group(1).toLowerCase(java.util.Locale.ROOT).replace('ё', 'е'));
      var previous = explicit.put(heightId, object("value", height, "quote", writtenFloors.group()));
      if (previous != null && !text(previous, "value").equals(height)) conflicts.add(heightId);
    }
    while (floors.find()) {
      int offset = floors.group(1) != null ? 1 : floors.group(3) != null ? 3 : 5;
      for (var e : Map.of(floorId, floors.group(offset),
          heightId, floors.group(offset + 1)).entrySet()) {
        var previous = explicit.put(e.getKey(), object("value", e.getValue(), "quote", floors.group()));
        if (previous != null && !text(previous, "value").equals(e.getValue())) conflicts.add(e.getKey());
      }
    }
    explicit.forEach((id, entry) -> put(editor, fields, accepted, conflicts, id,
        text(entry, "value"), text(entry, "quote")));
    for (String id : Set.of(floorId, heightId))
      if (conflicts.contains(id)) accepted.remove(id);
  }

  private static void put(JsonNode editor, Map<String, JsonNode> fields,
      Map<String, ObjectNode> accepted, Set<String> conflicts, String id, String value, String quote) {
    if (!fields.containsKey(id) || conflicts.contains(id)) return;
    var valid = RentalAiPolicy.validValue(fields.get(id), editor.path("canonicalValues").path(id),
        TextNode.valueOf(value), quote);
    if (valid != null) accepted.put(id, object("field", id, "value", valid, "quote", quote));
  }
}
