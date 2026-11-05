package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A source schema of a platform's form, or the fields of the card (common): format 1.2, one leaf
 * category for this editor. Immutable; its fields are indexed once.
 */
public final class Schema {
  /** One category of the schema and its fields. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Category(
      String id, String name, List<Category> categories, List<FieldDef> options) {
    public Category {
      categories = categories == null ? List.of() : List.copyOf(categories);
      options = options == null ? List.of() : List.copyOf(options);
    }
  }

  private final List<Category> categories;
  private final Map<String, FieldDef> fields;

  public Schema(List<Category> categories) {
    this.categories = List.copyOf(categories);
    Map<String, FieldDef> index = new LinkedHashMap<>();
    for (var category : this.categories) index.putAll(FieldDef.index(category.options()));
    this.fields = Collections.unmodifiableMap(index);
  }

  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  static Schema of(List<Category> categories) {
    if (categories == null) throw new IllegalArgumentException("схема — список категорий");
    return new Schema(categories);
  }

  public List<Category> categories() {
    return categories;
  }

  /** Every field by id, groups included, in schema order; choices are not fields. */
  public Map<String, FieldDef> fields() {
    return fields;
  }

  public FieldDef field(String id) {
    return fields.get(id);
  }
}
