package by.autopost.rental.application;

import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.model.CardFields;
import by.autopost.rental.model.CardModel;
import by.autopost.rental.model.FieldType;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What the editor draws: the groups of card fields with their names, types and display
 * properties, the card model it needs on its own (labels, the facts of the confirmed house, the
 * fields derived from the address, profile contacts) and the names of the platforms. No rule of a
 * platform: which fields apply, are required and get to a form is {@link FieldStates}.
 */
public record EditorSchema(
    List<Group> groups,
    CardView card,
    Map<String, PlatformView> platforms,
    String cardVersion,
    boolean addressSuggestions,
    int photoLimit) {
  public record Group(String id, String name, List<Field> fields) {}

  /**
   * @param unit added to the label (м²)
   * @param role how the editor styles the field: {@code price}
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Field(String id, String name, FieldType type, String unit, String role) {}

  /**
   * @param addressFields card fields derived from the address: a change of the address drops them
   */
  public record CardView(
      int version,
      Map<String, String> valueLabels,
      List<String> addressDependentFacts,
      List<String> addressFields,
      List<CardModel.ProfileDefault> profileDefaults) {}

  /** @param labels native field → its name on the form, for earlier values of the card */
  public record PlatformView(String name, Map<String, String> labels) {}

  /** The editor of the server's own settings. */
  public EditorSchema with(boolean addressSuggestions, int photoLimit) {
    return new EditorSchema(groups, card, platforms, cardVersion, addressSuggestions, photoLimit);
  }

  static EditorSchema of(ReferenceSnapshot snapshot) {
    var groups =
        snapshot.cardGroups().stream()
            .map(
                group ->
                    new Group(
                        group.id(),
                        group.name(),
                        group.options().stream()
                            .filter(f -> f.type() != FieldType.CHOICE)
                            .map(
                                f ->
                                    new Field(
                                        f.id(),
                                        f.name(),
                                        f.type(),
                                        CardFields.unit(f.id()),
                                        CardFields.role(f.id())))
                            .toList()))
            .toList();
    var model = snapshot.card();
    var card =
        new CardView(
            model.version(),
            model.valueLabels(),
            model.addressDependentFacts(),
            List.copyOf(model.addressProjection().keySet()),
            model.profileDefaults());
    Map<String, PlatformView> platforms = new LinkedHashMap<>();
    for (String p : snapshot.platforms()) {
      Map<String, String> labels = new LinkedHashMap<>();
      snapshot.schema(p).fields().forEach((id, field) -> labels.put(id, field.name()));
      platforms.put(p, new PlatformView(model.platformName(p), labels));
    }
    return new EditorSchema(groups, card, platforms, snapshot.cardVersion(), false, 0);
  }
}
