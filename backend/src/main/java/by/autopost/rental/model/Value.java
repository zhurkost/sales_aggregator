package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * One value of a card field, of a native form field or an option code: text, number, yes/no, a
 * list of values or an explicit null (a code that means "leave the option out"). Numbers compare
 * by their value; {@code integral} says whether the JSON number was written without a fraction.
 */
public sealed interface Value permits Value.Text, Value.Num, Value.Bool, Value.Items, Value.Null {
  /** The JSON form of the value. */
  @JsonValue
  Object json();

  /** No value at all: null, blank text or an empty list. */
  default boolean blank() {
    return false;
  }

  /** The value as a condition or a lookup compares it with another one. */
  default boolean same(Value other) {
    return equals(other);
  }

  /** The text a code becomes as a key of a label table; empty for lists and null. */
  default String text() {
    return "";
  }

  static boolean missing(Value value) {
    return value == null || value.blank();
  }

  static boolean same(Value a, Value b) {
    return a != null && b != null && a.same(b);
  }

  static Text text(String value) {
    return new Text(value);
  }

  static Num integer(BigInteger value) {
    return new Num(new BigDecimal(value), true);
  }

  static Num decimal(BigDecimal value) {
    return new Num(value, false);
  }

  /** The value of parsed JSON: a string, a number, a boolean, a list of these or null. */
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  static Value of(Object raw) {
    if (raw == null) return Null.NULL;
    if (raw instanceof String s) return new Text(s);
    if (raw instanceof Boolean b) return new Bool(b);
    if (raw instanceof BigDecimal d) return new Num(d, false);
    if (raw instanceof Double || raw instanceof Float)
      return new Num(BigDecimal.valueOf(((Number) raw).doubleValue()), false);
    if (raw instanceof BigInteger i) return integer(i);
    if (raw instanceof Integer || raw instanceof Long || raw instanceof Short)
      return new Num(BigDecimal.valueOf(((Number) raw).longValue()), true);
    if (raw instanceof List<?> list) {
      List<Value> items = new ArrayList<>();
      for (Object item : list) items.add(of(item));
      return new Items(items);
    }
    if (raw instanceof Map<?, ?>) throw new IllegalArgumentException("значение не может быть объектом");
    throw new IllegalArgumentException("неизвестный вид значения");
  }

  record Text(String value) implements Value {
    public Text {
      if (value == null) throw new IllegalArgumentException("пустой текст");
    }

    @Override
    public Object json() {
      return value;
    }

    @Override
    public boolean blank() {
      return value.isBlank();
    }

    @Override
    public String text() {
      return value;
    }
  }

  /** A number; two numbers are the same when their values are equal, whatever their scale. */
  record Num(BigDecimal value, boolean integral) implements Value {
    public Num {
      if (value == null) throw new IllegalArgumentException("пустое число");
    }

    @Override
    public Object json() {
      return integral ? value.toBigIntegerExact() : value;
    }

    @Override
    public String text() {
      return integral ? value.toBigIntegerExact().toString() : value.toString();
    }

    @Override
    public boolean equals(Object other) {
      return other instanceof Num n && value.compareTo(n.value) == 0;
    }

    @Override
    public int hashCode() {
      return value.signum() == 0 ? 0 : value.stripTrailingZeros().hashCode();
    }
  }

  record Bool(boolean value) implements Value {
    @Override
    public Object json() {
      return value;
    }

    @Override
    public String text() {
      return Boolean.toString(value);
    }
  }

  record Items(List<Value> items) implements Value {
    public Items {
      items = Collections.unmodifiableList(new ArrayList<>(items));
      if (items.contains(null)) throw new IllegalArgumentException("пустой элемент списка");
    }

    @Override
    public Object json() {
      return items;
    }

    @Override
    public boolean blank() {
      return items.isEmpty();
    }
  }

  /** JSON null: in a lookup table, the code that leaves the option out. */
  enum Null implements Value {
    NULL;

    @Override
    public Object json() {
      return null;
    }

    @Override
    public boolean blank() {
      return true;
    }
  }
}
