package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One field of a source schema or of the card (common), in format 1.2: its facts are in {@code
 * fill_rule}. A group holds fields, an enum holds its {@link Choice choices}. Schemas carry more
 * research facts than the server reads; only these are parsed.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record FieldDef(
    String id,
    String name,
    String description,
    FieldType type,
    @JsonProperty("fill_rule") FillRule rule,
    List<FieldDef> options) {
  public FieldDef {
    id = id == null ? "" : id;
    if (type == null) throw new IllegalArgumentException("неизвестный тип поля " + id);
    name = name == null ? "" : name;
    description = description == null ? "" : description;
    rule = rule == null ? FillRule.NONE : rule;
    options = options == null ? List.of() : List.copyOf(options);
  }

  /** The facts of a field: its option code, whether it is required, limits and conditions. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record FillRule(
      Value value,
      Boolean required,
      Validation validation,
      Condition when,
      @JsonProperty("depends_on") List<String> dependsOn) {
    static final FillRule NONE = new FillRule(null, null, null, null, null);

    public FillRule {
      validation = validation == null ? Validation.NONE : validation;
      dependsOn = dependsOn == null ? List.of() : List.copyOf(dependsOn);
    }

    public boolean mandatory() {
      return Boolean.TRUE.equals(required);
    }
  }

  /** The limits the server checks; other limits of a schema are checked by the platform. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Validation(
      BigDecimal min,
      BigDecimal max,
      @JsonProperty("exclusive_min") BigDecimal exclusiveMin,
      @JsonProperty("exclusive_max") BigDecimal exclusiveMax,
      @JsonProperty("multiple_of") BigDecimal multipleOf,
      @JsonProperty("min_length") Integer minLength,
      @JsonProperty("max_length") Integer maxLength,
      @JsonProperty("min_items") Integer minItems,
      @JsonProperty("max_items") Integer maxItems,
      String pattern) {
    static final Validation NONE =
        new Validation(null, null, null, null, null, null, null, null, null, null);
  }

  public Condition when() {
    return rule.when();
  }

  public boolean required() {
    return rule.mandatory();
  }

  /** The options of an enum or a multi_enum. */
  public List<Choice> choices() {
    List<Choice> choices = new ArrayList<>();
    for (var option : options)
      if (option.type == FieldType.CHOICE)
        choices.add(new Choice(option.id, option.name, option.rule.value(), option.rule.when()));
    return choices;
  }

  /**
   * Fields by id, groups included; a group's fields follow it. Choices are not fields.
   *
   * @param top the options of a schema category or of a group
   */
  public static Map<String, FieldDef> index(List<FieldDef> top) {
    Map<String, FieldDef> result = new LinkedHashMap<>();
    collect(top, result);
    return result;
  }

  private static void collect(List<FieldDef> options, Map<String, FieldDef> result) {
    for (var option : options) {
      if (option.type != FieldType.CHOICE) result.put(option.id, option);
      if (option.type == FieldType.GROUP) collect(option.options, result);
    }
  }
}
