package by.autopost.rental.model;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.Locale;

public final class Values {
  public static BigDecimal decimal(JsonNode input, boolean integer) {
    if (!input.isTextual()) throw new IllegalArgumentException("Введите число текстом.");
    String value = input.asText().strip();
    if (value.length() > 64
        || !(value.matches("[+-]?\\d+(?:[.,]\\d+)?")
            || value.matches("[+-]?\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+(?:[.,]\\d+)?")))
      throw new IllegalArgumentException(
          "Нужно однозначное число: например, 45,5. Без диапазона или единицы измерения.");
    BigDecimal number =
        new BigDecimal(value.replaceAll("[ \\u00a0\\u202f]", "").replace(',', '.'))
            .stripTrailingZeros();
    if (integer && number.scale() > 0)
      throw new IllegalArgumentException(
          "Площадка принимает только целое число; исправьте сумму без автоматического округления.");
    if (number.abs().compareTo(new BigDecimal("9007199254740991")) > 0)
      throw new IllegalArgumentException("Число слишком велико.");
    return number;
  }

  public static String phone(JsonNode input, String format) {
    if (!input.isTextual())
      throw new IllegalArgumentException("Телефон должен оставаться строкой.");
    String value = input.asText().strip();
    if (!value.matches("[+0-9 ()\\-\\u00a0]+"))
      throw new IllegalArgumentException(
          "Проверьте телефон: только номер, без добавочного и букв.");
    value = value.replaceAll("[ ()\\-\\u00a0]", "");
    if (value.matches("(?:25|29|33|44|17)\\d{7}")) value = "+375" + value;
    if (value.matches("375(?:25|29|33|44|17)\\d{7}")) value = "+" + value;
    if (!value.matches("\\+[1-9]\\d{7,14}"))
      throw new IllegalArgumentException("Укажите полный телефон с кодом страны, например +375…");
    if (format.equals("BY_NATIONAL")) {
      if (!value.matches("\\+375(?:25|29|33|44|17)\\d{7}"))
        throw new IllegalArgumentException(
            "Для этой площадки нужен белорусский телефон допустимого формата.");
      return value.substring(4);
    }
    if (!format.equals("E164"))
      throw new IllegalArgumentException("Формат телефона площадки ещё не подтверждён.");
    return value;
  }

  public static boolean missing(JsonNode value) {
    return value == null
        || value.isMissingNode()
        || value.isNull()
        || value.isTextual() && value.asText().isBlank()
        || value.isArray() && value.isEmpty();
  }

  public static boolean equal(JsonNode a, JsonNode b) {
    if (a == null || b == null) return false;
    if (a.isNumber() && b.isNumber()) return a.decimalValue().compareTo(b.decimalValue()) == 0;
    return a.equals(b);
  }

  public static String normalized(String value) {
    return value.strip().toLowerCase(Locale.ROOT).replace('ё', 'е').replaceAll("\\s+", " ");
  }
}
