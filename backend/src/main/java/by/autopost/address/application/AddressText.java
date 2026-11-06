package by.autopost.address.application;

import static by.autopost.shared.Json.text;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Normalizes address components and formats the search query used by browser forms. */
public final class AddressText {
  private AddressText() {}

  public static String cleanComponent(String value, String part) {
    if ("street".equals(part)) return StreetKind.parse(value).name();
    return value.strip().replaceFirst("(?iu)^(?:" + typePrefix(part) + ")(?:\\.\\s*|\\s+)", "").strip();
  }

  private static String typePrefix(String part) {
    return switch (part) {
      case "settlement" -> "городской поселок|городской посёлок|г\\.?\\s*п|рабочий поселок|рабочий посёлок|р\\.?\\s*п|городе|города|город|г|агрогородок|аг|деревня|дер|д|поселок|посёлок|пос|п|село|с";
      case "street" -> "улица|ул|переулок|пер|проспект|пр-т|пр-кт|просп|пр|бульвар|бул|б-р|площадь|пл|проезд|пр-д|шоссе|ш|набережная|наб|тупик|туп|тракт";
      case "house" -> "дом|д";
      case "block" -> "корпус|корп|к";
      default -> "(?!)";
    };
  }

  /** Text typed into a single address search box; the canonical address stays intact. */
  public static String searchText(JsonNode address) {
    var parts = List.of("settlement", "street", "house", "block");
    String query;
    if (!text(address, "settlement").isBlank() && !text(address, "street").isBlank()) {
      query = parts.stream().map(p -> cleanComponent(text(address, p), p))
          .filter(v -> !v.isBlank()).collect(java.util.stream.Collectors.joining(" "));
    } else {
      String prefixes = parts.stream().map(AddressText::typePrefix)
          .collect(java.util.stream.Collectors.joining("|"));
      query = text(address, "label").replace(',', ' ')
          .replaceAll("(?iu)(?<![\\p{L}\\d])(?:" + prefixes + ")(?:\\.\\s*|\\s+)", "");
    }
    query = query.replace(',', ' ').replaceAll("\\s+", " ").strip().toLowerCase(Locale.ROOT);
    return Pattern.compile("(?<!\\p{L})\\p{L}").matcher(query)
        .replaceAll(m -> m.group().toUpperCase(Locale.ROOT));
  }

  public static void cleanComponents(ObjectNode address) {
    for (String part : List.of("settlement", "street", "house", "block")) {
      if (!address.has(part)) continue;
      String original = text(address, part), clean = cleanComponent(original, part);
      if (part.equals("street") && !original.equals(clean)) address.put("streetType", StreetKind.parse(original).code());
      if (!original.equals(clean) && part.equals("settlement"))
        address.put(part + "WithType", original);
      address.put(part, clean);
    }
  }
}
