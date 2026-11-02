package by.autopost.shared;

import java.util.Locale;

public final class Text {
  private Text() {}

  public static String normalized(String value) {
    return value.strip().toLowerCase(Locale.ROOT).replace('ё', 'е').replaceAll("\\s+", " ");
  }
}
