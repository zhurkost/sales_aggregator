package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;

/** Type of a card field or a native form field; {@code CHOICE} is one option of an enum. */
public enum FieldType {
  GROUP,
  TEXT,
  INTEGER,
  NUMBER,
  BOOLEAN,
  DATE,
  DATETIME,
  ENUM,
  MULTI_ENUM,
  CHOICE,
  FILES;

  @JsonValue
  public String code() {
    return name().toLowerCase(Locale.ROOT);
  }

  @JsonCreator
  public static FieldType of(String code) {
    for (var type : values()) if (type.code().equals(code)) return type;
    throw new IllegalArgumentException("неизвестный тип поля " + code);
  }

  /** A field whose value is one or several option codes. */
  public boolean coded() {
    return this == ENUM || this == MULTI_ENUM;
  }
}
