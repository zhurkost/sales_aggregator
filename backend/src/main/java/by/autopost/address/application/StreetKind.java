package by.autopost.address.application;

import java.util.List;
import java.util.regex.Pattern;

/** Parse a separate street-type word at either end of a name. */
public record StreetKind(String name, String kind) {
  private record Alias(String kind, Pattern pattern) {
    Alias(String kind, String re) {
      this(kind, Pattern.compile("(?iu)^(?:" + re + ")(?:\\.\\s*|\\s+)(.+)$|^(.+?)\\s+(?:" + re + ")\\.?$"));
    }
  }
  private static final List<Alias> TYPES = List.of(
      new Alias("улица", "улиц(?:а|ы|е|у|ей)|ул"),
      new Alias("проспект", "проспект(?:е|а|у|ом)?|просп|пр-кт|пр-т"),
      new Alias("проезд", "проезд(?:е|а|у|ом)?|пр-д"), new Alias("пр", "пр"),
      new Alias("переулок", "переулок|переулк(?:е|а|у|ом)|пер"),
      new Alias("бульвар", "бульвар(?:е|а|у|ом)?|бул|б-р"),
      new Alias("площадь", "площадь|площади|пл"), new Alias("шоссе", "шоссе|ш"),
      new Alias("набережная", "набережная|набережной|наб"), new Alias("тракт", "тракт(?:е|а|у|ом)?"),
      new Alias("тупик", "тупик(?:е|а|у|ом)?|туп"), new Alias("парк", "парк(?:е|а|у|ом)?"));
  public String code() { return kind.isEmpty() ? "" : kind.substring(0, 2); }

  public static StreetKind parse(String text) {
    String value = text.strip();
    for (var type : TYPES) {
      var m = type.pattern.matcher(value);
      if (m.matches()) return new StreetKind((m.group(1) == null ? m.group(2) : m.group(1)).strip(), type.kind);
    }
    return new StreetKind(value, "");
  }
}
