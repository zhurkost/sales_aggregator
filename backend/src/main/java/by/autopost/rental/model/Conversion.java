package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import java.util.List;
import java.util.Locale;

/**
 * How a card value becomes the value of a native field: one of the executable handlers, by its
 * {@code kind}. {@code requires} lists native fields prepared first (the currency of a price).
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "kind")
@JsonSubTypes({
  @JsonSubTypes.Type(value = Conversion.Identity.class, name = "identity"),
  @JsonSubTypes.Type(value = Conversion.Lookup.class, name = "lookup"),
  @JsonSubTypes.Type(value = Conversion.ListLookup.class, name = "list_lookup"),
  @JsonSubTypes.Type(value = Conversion.MultiLookup.class, name = "multi_lookup"),
  @JsonSubTypes.Type(value = Conversion.Decimal.class, name = "decimal"),
  @JsonSubTypes.Type(value = Conversion.Phone.class, name = "phone"),
  @JsonSubTypes.Type(value = Conversion.PlainTextHtml.class, name = "plain_text_html"),
  @JsonSubTypes.Type(value = Conversion.Files.class, name = "files")
})
public sealed interface Conversion
    permits Conversion.Identity,
        Conversion.Lookup,
        Conversion.ListLookup,
        Conversion.MultiLookup,
        Conversion.Decimal,
        Conversion.Phone,
        Conversion.PlainTextHtml,
        Conversion.Files {
  List<String> requires();

  private static List<String> list(List<String> requires) {
    return requires == null ? List.of() : List.copyOf(requires);
  }

  private static List<ValuePair> pairs(List<ValuePair> values) {
    // An explicitly empty table is valid partial coverage: lookup reports any supplied value as
    // unmapped. A missing table must not silently become that state.
    if (values == null) throw new IllegalArgumentException("нет таблицы соответствий значений");
    return List.copyOf(values);
  }

  /** One card code and the native code it becomes; {@code to} null leaves the option out. */
  record ValuePair(
      @JsonProperty(value = "from", required = true) Value from,
      @JsonProperty(value = "to", required = true) Value to) {
    public ValuePair {
      from = from == null ? Value.Null.NULL : from;
      to = to == null ? Value.Null.NULL : to;
      if (from instanceof Value.Items || to instanceof Value.Items)
        throw new IllegalArgumentException("ожидались скалярные коды вариантов");
    }
  }

  /** One card field of a combined list and its table. */
  record Member(
      @JsonProperty("common_option_id") String commonOptionId, List<ValuePair> values) {
    public Member {
      commonOptionId = commonOptionId == null ? "" : commonOptionId;
      values = pairs(values);
    }
  }

  record Identity(List<String> requires) implements Conversion {
    public Identity {
      requires = list(requires);
    }
  }

  record Lookup(List<ValuePair> values, List<String> requires) implements Conversion {
    public Lookup {
      values = pairs(values);
      requires = list(requires);
    }
  }

  record ListLookup(List<ValuePair> values, List<String> requires) implements Conversion {
    public ListLookup {
      values = pairs(values);
      requires = list(requires);
    }
  }

  /** Several card fields merged into one native list. */
  record MultiLookup(List<Member> members, List<String> requires) implements Conversion {
    public MultiLookup {
      if (members == null || members.isEmpty())
        throw new IllegalArgumentException("пустой состав multi_lookup");
      members = List.copyOf(members);
      requires = list(requires);
    }
  }

  enum NumberTarget {
    INTEGER,
    NUMBER;

    @JsonCreator
    static NumberTarget of(String code) {
      for (var target : values())
        if (target.name().toLowerCase(Locale.ROOT).equals(code)) return target;
      throw new IllegalArgumentException("неверный числовой тип назначения");
    }
  }

  /**
   * Exact decimal text to a number; a price in one of {@code integerCurrencies} (by the native
   * value of {@code currencyField}) must be whole.
   */
  record Decimal(
      NumberTarget target,
      List<String> requires,
      @JsonProperty("currency_field") String currencyField,
      @JsonProperty("integer_currencies") List<String> integerCurrencies)
      implements Conversion {
    public Decimal {
      if (target == null) throw new IllegalArgumentException("неверный числовой тип назначения");
      requires = list(requires);
      currencyField = currencyField == null ? "" : currencyField;
      integerCurrencies = list(integerCurrencies);
    }
  }

  enum PhoneFormat {
    BY_NATIONAL,
    E164;

    @JsonCreator
    static PhoneFormat of(String code) {
      for (var format : values()) if (format.name().equals(code)) return format;
      throw new IllegalArgumentException("неизвестный формат телефона");
    }
  }

  record Phone(PhoneFormat format, List<String> requires) implements Conversion {
    public Phone {
      if (format == null) throw new IllegalArgumentException("неизвестный формат телефона");
      requires = list(requires);
    }
  }

  /** Plain text to the escaped paragraph HTML a rich text editor of the form accepts. */
  record PlainTextHtml(List<String> requires) implements Conversion {
    public PlainTextHtml {
      requires = list(requires);
    }
  }

  /** HTTPS links to the original files, in their order. */
  record Files(List<String> requires) implements Conversion {
    public Files {
      requires = list(requires);
    }
  }
}
