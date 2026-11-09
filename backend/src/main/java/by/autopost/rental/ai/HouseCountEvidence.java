package by.autopost.rental.ai;

import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Checks word-form counts against the quoted house attribute, not unrelated numbers. */
final class HouseCountEvidence {
  private HouseCountEvidence() {}

  private static final Map<String, String> COUNTS = Map.ofEntries(
      Map.entry("1", "один|одного|одном|одну|одна"), Map.entry("2", "два|две|двух"),
      Map.entry("3", "три|трех"), Map.entry("4", "четыре|четырех"),
      Map.entry("5", "пять|пяти"), Map.entry("6", "шесть|шести"),
      Map.entry("7", "семь|семи"), Map.entry("8", "восемь|восьми"),
      Map.entry("9", "девять|девяти"), Map.entry("10", "десять|десяти"),
      Map.entry("11", "одиннадцать|одиннадцати"), Map.entry("12", "двенадцать|двенадцати"),
      Map.entry("13", "тринадцать|тринадцати"), Map.entry("14", "четырнадцать|четырнадцати"),
      Map.entry("15", "пятнадцать|пятнадцати"), Map.entry("16", "шестнадцать|шестнадцати"),
      Map.entry("17", "семнадцать|семнадцати"), Map.entry("18", "восемнадцать|восемнадцати"),
      Map.entry("19", "девятнадцать|девятнадцати"), Map.entry("20", "двадцать|двадцати"));
  private static final Map<String, String> LEVEL_PREFIXES = Map.of(
      "1", "одно", "2", "двух|дву", "3", "трех", "4", "четырех", "5", "пяти",
      "6", "шести", "7", "семи", "8", "восьми", "9", "девяти", "10", "десяти");

  static boolean supports(String field, String value, String quote) {
    boolean levels = field.equals("house.levels");
    if (!levels && !field.equals("house.capacity")) return false;
    String source = quote.toLowerCase(Locale.ROOT).replace('ё', 'е');
    String words = COUNTS.get(value);
    String units = levels ? "уровень|уровн(?:я|ей|ях|е)|этаж(?:а|ей|ах|е)?"
        : "человек(?:а)?|гост(?:ь|я|ей)|жильц(?:а|ов)|проживающ\\p{L}*";
    if (words != null && contains(source, "(?:" + words + ")\\s+(?:" + units + ")")) return true;
    String prefix = LEVEL_PREFIXES.get(value);
    return levels && prefix != null && contains(source, "(?:" + prefix
        + ")(?:этажн|уровнев)\\p{L}*(?=\\s+(?:дом|коттедж|дач)\\p{L}*|\\s*$)");
  }

  private static boolean contains(String source, String expression) {
    return Pattern.compile("(?iu)(?<![\\p{L}\\d])(?:" + expression + ")(?!\\p{L})")
        .matcher(source).find();
  }
}
