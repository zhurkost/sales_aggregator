package by.autopost.rental.ai;

import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.model.CardFields;
import by.autopost.rental.model.Conversion;
import by.autopost.rental.model.FieldType;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What the AI may fill: the card fields with the type a value must have and their options, and the
 * labels of option codes. Not the description, links to files or coordinates.
 *
 * @param fields card field → its type and options
 */
public record AiCard(String cardVersion, Map<String, Field> fields, Map<String, String> valueLabels) {
  /** @param type the card field's type, or the number a platform converts its text to */
  public record Field(String id, String name, String type, List<String> choices) {}

  public static AiCard of(ReferenceSnapshot snapshot) {
    Map<String, Field> fields = new LinkedHashMap<>();
    for (var group : snapshot.cardGroups())
      for (var field : group.options()) {
        String id = field.id();
        if (id.equals(CardFields.DESCRIPTION)
            || field.type() == FieldType.FILES
            || field.type() == FieldType.CHOICE
            || id.startsWith(CardFields.LATITUDE)
            || id.startsWith(CardFields.LONGITUDE)) continue;
        String type = field.type().code();
        // A number kept as text: the platforms' plans say which number it is.
        for (String platform : snapshot.platforms())
          for (var rule : snapshot.plan(platform).fields())
            if (rule.commonOptionId().equals(id)
                && rule.conversion() instanceof Conversion.Decimal decimal)
              type = decimal.target() == Conversion.NumberTarget.INTEGER ? "integer" : "number";
        fields.put(id, new Field(id, field.name(), type, snapshot.card().choices(id)));
      }
    return new AiCard(snapshot.cardVersion(), fields, snapshot.card().valueLabels());
  }
}
