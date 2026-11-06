package by.autopost.rental.ai;

import static by.autopost.shared.Json.*;

import by.autopost.address.application.StreetKind;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Literal components only: no geocoding, invented location or AI-provided identifiers. */
public final class LiteralAddress {
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
      String prefixes = parts.stream().map(LiteralAddress::typePrefix)
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

  private static final String CITY =
      "(?:город|г\\.?|агрогородок|аг\\.?|деревня|дер\\.?|д\\.?|поселок|посёлок|пос\\.?)";
  private static final String STREET =
      "(?:улица|ул\\.?|переулок|пер\\.?|проспект|пр-т|пр-кт|просп\\.?|пр-д|пр\\.?|бульвар|бул\\.?|площадь|пл\\.?|проезд|шоссе)";
  private static final List<String> PARTS =
      List.of("region", "district", "settlement", "street", "house", "block");

  // In "В Витебске сдаётся квартира, ул. Ленина, дом 12А" the address is not contiguous.
  // Use only literal components from the same sentence. Never assemble separate addresses.
  private static final Pattern OPENING_LOCATION = Pattern.compile(
      "(?iu)(?:^|[.!?]\\s+)(?:(?:сдам|сдаю|сда[её]тся)\\s+[^.!?;:\\n]{0,70}?)?\\bв\\s+([\\p{L}-]+)(?:\\s+(?:сда[её]тся|сда[её]м|сдаю)\\s+[^.!?;\\n]{0,130}?,|\\s*:)\\s*("
          + STREET + "\\s+[\\p{L}][\\p{L} .-]{0,65}?),\\s*((?:дом|д\\.)\\s*\\d+[\\p{L}\\d/-]*)(?:,\\s*((?:корпус|корп\\.)\\s*\\d+[\\p{L}\\d/-]*))?(?=[\\s.,;!?]|$)");

  static ObjectNode withOpeningLocation(String source, JsonNode proposal, ObjectNode original) {
    if (!proposal.isObject()) return original;
    var match = OPENING_LOCATION.matcher(source);
    if (!match.find()) return original;
    String city = match.group(1), street = match.group(2), house = match.group(3), block = match.group(4);
    if (match.find()) return original;
    String label = city + ", " + street + ", " + house + (block == null ? "" : ", " + block);
    ObjectNode evidence = object("settlement", city, "settlementNominative", text(proposal, "settlementNominative"),
        "street", street, "streetNominative", text(proposal, "streetNominative"));
    return parse(label, evidence);
  }

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
      } else if (segment.matches("(?iu)(?:корпус|корп\\.?|к\\.?)\\s*\\d[\\p{L}\\d-]*")) {
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
    // A street and house often share a segment: "ул. Пушкина 7".
    String streetAndHouse = text(result, "street");
    String house = text(result, "house");
    if (!house.isBlank() && streetAndHouse.endsWith(" " + house)) {
      String streetOnly = streetAndHouse.substring(0, streetAndHouse.length() - house.length()).strip();
      if (StreetKind.parse(streetOnly).name().equalsIgnoreCase(
          StreetKind.parse(text(proposal, "street")).name())) result.put("street", streetOnly);
    }
    // Only accept inflections of text actually evidenced for this component.
    for (String part : List.of("settlement", "street")) {
      String raw = text(proposal, part).strip(), nom = text(proposal, part + "Nominative").strip();
      if (raw.isBlank() || nom.isBlank() || !containsWord(label, raw)) continue;
      raw = raw.replaceFirst(part.equals("settlement") ? "(?iu)^(?:в|во)\\s+" : "(?iu)^(?:на|по)\\s+", "");
      var street = StreetKind.parse(raw);
      String name = cleanComponent(raw, part);
      String parsed = text(result, part);
      String typedStreet = street.kind().isEmpty() ? parsed : raw;
      // A name following the street type is already in its citation form ("ул. Горького").
      // Preserve it when it ends in a genitive surname, even if the model proposes an adjective.
      if (part.equals("street") && !name.equalsIgnoreCase(nom)
          && name.matches("(?iu).*(?:ого|его)$") && !StreetKind.parse(typedStreet).kind().isEmpty()
          && typedStreet.toLowerCase(Locale.ROOT).endsWith(name.toLowerCase(Locale.ROOT))) continue;
      if (!inflectionOf(name, nom)) continue;
      if (!parsed.isBlank() && !containsWord(parsed, raw) && !containsWord(raw, parsed)) continue;
      String typed = raw.replace(name, nom);
      if (part.equals("settlement")) typed = typed.replaceFirst("(?iu)^город(?:е|а)\\s+", "город ");
      if (part.equals("street")) {
        String kind = street.kind().isEmpty() ? StreetKind.parse(parsed).kind() : street.kind();
        typed = kind.isEmpty() ? nom : kind + " " + nom;
      }
      result.put(part, typed);
    }
    return result;
  }

  private static boolean containsWord(String label, String value) {
    return Pattern.compile("(?iu)(?<![\\p{L}\\d])" + Pattern.quote(value) + "(?![\\p{L}\\d])")
        .matcher(label).find();
  }

  private static boolean inflectionOf(String source, String nominal) {
    if (nominal.length() > 200 || !nominal.matches("[\\p{L}\\d .-]+")) return false;
    String[] a = key(source).split("[ -]+"), b = key(nominal).split("[ -]+");
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (a[i].equals(b[i])) continue;
      String endings = "(?:ого|его|ому|ему|ыми|ими|ой|ей|ом|ем|ым|им|ых|их|ах|ях|ов|ев|ью|ая|яя|ое|ее|ый|ий|ые|ие|ую|юю|[аяуюоеыиьй])$";
      String stem = a[i].replaceFirst(endings, "");
      if (stem.length() < 2 || !(stem.equals(b[i]) || stem.equals(b[i].replaceFirst(endings, "")))) return false;
    }
    return true;
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
        String expectedType = part.equals("street") ? StreetKind.parse(expected).kind() : type(expected);
        String actualType = part.equals("street") ? StreetKind.parse(actual).kind() : type(actual);
        if (expectedType.equals("пр") && actualType.startsWith("пр")) continue;
        if (!expectedType.isBlank() && !expectedType.equals(actualType)) return false;
      }
    }
    return true;
  }

  private static String key(String value) {
    return value.toLowerCase(Locale.ROOT).replace('ё', 'е').replaceAll("[.\\s]+", " ").strip();
  }

  private static String component(String value, String part) {
    if (part.equals("street")) return key(StreetKind.parse(value).name());
    String prefix = part.equals("settlement") ? CITY : "(?!)";
    String stripped = value.replaceFirst("(?iu)^" + prefix + "\\s+", "");
    if (part.equals("region")) stripped = stripped.replaceFirst("(?iu)\\s+(область|обл\\.?)$", "");
    if (part.equals("district")) stripped = stripped.replaceFirst("(?iu)\\s+(район|р-н)$", "");
    return key(stripped);
  }

  private static String type(String value) {
    String first = key(value).split(" ")[0];
    return switch (first) {
      case "город", "г" -> "city";
      case "агрогородок", "аг" -> "agro";
      case "деревня", "дер", "д" -> "village";
      case "поселок", "пос" -> "town";
      default -> "";
    };
  }
}
