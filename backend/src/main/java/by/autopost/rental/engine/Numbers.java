package by.autopost.rental.engine;

import by.autopost.rental.model.Value;
import java.math.BigDecimal;
import java.util.Locale;

/** Exact numbers and telephone numbers from what a person typed. */
public final class Numbers {
  private Numbers() {}

  /** A number written as text: «45,5», «1 500»; never a range or a unit, never rounded. */
  public static BigDecimal decimal(Value input, boolean integer) {
    if (!(input instanceof Value.Text text))
      throw new IllegalArgumentException("Введите число текстом.");
    return decimal(text.value(), integer);
  }

  public static BigDecimal decimal(String input, boolean integer) {
    String value = input.strip();
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

  /** {@code BY_NATIONAL}: the nine digits after +375; {@code E164}: +country and number. */
  public static String phone(Value input, String format) {
    if (!(input instanceof Value.Text text))
      throw new IllegalArgumentException("Телефон должен оставаться строкой.");
    String value = text.value().strip();
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

  /** Comparison form of a name: case, ё and spacing do not matter. */
  public static String normalized(String value) {
    return value.strip().toLowerCase(Locale.ROOT).replace('ё', 'е').replaceAll("\\s+", " ");
  }
}
