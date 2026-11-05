package by.autopost.rental.ai;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Literal components only: no geocoding, invented location or AI-provided identifiers. */
public final class LiteralAddress {
  public static String cleanComponent(String value, String part) {
    String prefix = switch (part) {
      case "settlement" -> "городской поселок|городской посёлок|г\\.?\\s*п|рабочий поселок|рабочий посёлок|р\\.?\\s*п|город|г|агрогородок|аг|деревня|дер|д|поселок|посёлок|пос|п|село|с";
      case "street" -> "улица|ул|переулок|пер|проспект|пр-т|просп|бульвар|бул|б-р|площадь|пл|проезд|пр-д|шоссе|ш|набережная|наб|тупик|туп";
      case "house" -> "дом|д";
      case "block" -> "корпус|корп|к";
      default -> "(?!)";
    };
    return value.strip().replaceFirst("(?iu)^(?:" + prefix + ")(?:\\.\\s*|\\s+)", "").strip();
  }

  public static void cleanComponents(ObjectNode address) {
    for (String part : List.of("settlement", "street", "house", "block")) {
      if (!address.has(part)) continue;
      String original = text(address, part), clean = cleanComponent(original, part);
      if (!original.equals(clean) && (part.equals("settlement") || part.equals("street")))
        address.put(part + "WithType", original);
      address.put(part, clean);
    }
  }

  private static final String CITY =
      "(?:город|г\\.?|агрогородок|аг\\.?|деревня|дер\\.?|д\\.?|поселок|посёлок|пос\\.?)";
  private static final String STREET =
      "(?:улица|ул\\.?|переулок|пер\\.?|проспект|пр-т|просп\\.?|бульвар|бул\\.?|площадь|пл\\.?|проезд|шоссе)";
  private static final List<String> PARTS =
      List.of("region", "district", "settlement", "street", "house", "block");

  public static ObjectNode parse(String label, JsonNode proposal) {
    ObjectNode result =
        object("provider", "manual", "countryIso", "BY", "label", label, "confirmed", false);
    for (String part : PARTS) result.put(part, "");
    String separated =
        label.replaceAll("(?iu)\\s+(?=(?:" + STREET + "|дом|д\\.|корпус|корп\\.)\\s)", ", ");
    String[] segments = separated.split("\\s*,\\s*");
    for (String segment : segments) {
      segment = segment.strip();
      if (segment.matches("(?iu)(?:дом|д\\.?)\\s*\\d[\\p{L}\\d/-]*")) {
        result.put("house", segment.replaceFirst("(?iu)^(?:дом|д\\.?)\\s*", ""));
      } else if (segment.matches("(?iu)(?:корпус|корп\\.?|к\\.?)\\s*[\\p{L}\\d-]+")) {
        result.put("block", segment.replaceFirst("(?iu)^(?:корпус|корп\\.?|к\\.?)\\s*", ""));
      } else if (segment.matches("(?iu)" + STREET + "\\s+.+")) result.put("street", segment);
      else if (segment.matches("(?iu)" + CITY + "\\s+.+")) result.put("settlement", segment);
      else if (segment.matches("(?iu).+\\s+(?:область|обл\\.?)")) result.put("region", segment);
      else if (segment.matches("(?iu).+\\s+(?:район|р-н)")) result.put("district", segment);
      else if (!text(result, "street").isBlank() && segment.matches("\\d[\\p{L}\\d/-]*"))
        result.put("house", segment);
    }
    // A bare city is common in comma-separated addresses; require an explicit street after it.
    if (text(result, "settlement").isBlank()
        && !text(result, "street").isBlank()
        && segments[0].matches("[\\p{L}][\\p{L} .-]{1,79}")
        && !segments[0].matches("(?iu).*(?:область|обл\\.?|район|р-н|беларусь)$")
        && !segments[0].equals(text(result, "street"))) result.put("settlement", segments[0]);
    // AI may split unusual syntax, but every part must be copied from this address snippet.
    for (String part : PARTS) {
      String value = text(proposal, part).strip();
      if (!text(result, part).isBlank() || value.isBlank() || value.length() > 200) continue;
      if ((part.equals("house") || part.equals("block")) && !value.matches("\\d[\\p{L}\\d/-]*"))
        continue;
      if (Pattern.compile("(?iu)(?<![\\p{L}\\d])" + Pattern.quote(value) + "(?![\\p{L}\\d])")
          .matcher(label)
          .find()) result.put(part, value);
    }
    return result;
  }

  public static boolean matches(JsonNode literal, JsonNode candidate) {
    if (!text(candidate, "countryIso").equals("BY")) return false;
    for (String part : List.of("settlement", "street", "house"))
      if (text(literal, part).isBlank() || text(candidate, part).isBlank()) return false;
    for (String part : PARTS) {
      String expected = text(literal, part), actual = text(candidate, part);
      // Never silently choose a building/corpus that was not specified.
      if (part.equals("block") && !key(expected).equals(key(actual))) return false;
      if (expected.isBlank()) continue;
      if (!component(expected, part).equals(component(actual, part))) return false;
      if (part.equals("street") || part.equals("settlement")) {
        String expectedType = type(expected), actualType = type(actual);
        if (!expectedType.isBlank() && !expectedType.equals(actualType)) return false;
      }
    }
    return true;
  }

  private static String key(String value) {
    return value.toLowerCase(Locale.ROOT).replace('ё', 'е').replaceAll("[.\\s]+", " ").strip();
  }

  private static String component(String value, String part) {
    String prefix = part.equals("street") ? STREET : part.equals("settlement") ? CITY : "(?!)";
    String stripped = value.replaceFirst("(?iu)^" + prefix + "\\s+", "");
    if (part.equals("region")) stripped = stripped.replaceFirst("(?iu)\\s+(область|обл\\.?)$", "");
    if (part.equals("district")) stripped = stripped.replaceFirst("(?iu)\\s+(район|р-н)$", "");
    return key(stripped);
  }

  private static String type(String value) {
    String first = key(value).split(" ")[0];
    return switch (first) {
      case "улица", "ул" -> "street";
      case "переулок", "пер" -> "lane";
      case "проспект", "пр-т", "просп" -> "avenue";
      case "бульвар", "бул" -> "boulevard";
      case "площадь", "пл" -> "square";
      case "проезд", "шоссе" -> first;
      case "город", "г" -> "city";
      case "агрогородок", "аг" -> "agro";
      case "деревня", "дер", "д" -> "village";
      case "поселок", "пос" -> "town";
      default -> "";
    };
  }
}
