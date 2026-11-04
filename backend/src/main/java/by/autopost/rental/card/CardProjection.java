package by.autopost.rental.card;

import static by.autopost.rental.model.MappingSources.sources;
import static by.autopost.rental.model.SchemaFields.*;
import static by.autopost.shared.Json.*;

import by.autopost.rental.model.Values;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class CardProjection {
  /** The address object is the only source: stale projected values never reach preparation. */
  public static void projectAddress(ObjectNode values, JsonNode address, JsonNode card) {
    card.path("addressProjection").fieldNames().forEachRemaining(values::remove);
    card.path("addressProjection")
        .fields()
        .forEachRemaining(
            e -> {
              String part = e.getValue().asText();
              if ((part.equals("latitude") || part.equals("longitude"))
                  && (!address.path("confirmed").asBoolean()
                      || !text(address, "precision").equals("0"))) return;
              if (!Values.missing(address.get(part)))
                values.set(e.getKey(), address.get(part).deepCopy());
            });
  }

  public static void annotate(ObjectNode prepared, JsonNode plan, JsonNode input) {
    ArrayNode issues = (ArrayNode) prepared.get("issues");
    Map<String, List<String>> sources = new HashMap<>();
    for (var row : plan.path("fields")) sources.put(text(row, "platform_option_id"), sources(row));
    Set<String> address = new HashSet<>();
    for (var f : plan.path("address_bound_fields")) address.add(f.asText());
    for (var i : issues) {
      String field = text(i, "field");
      if (!i.has("source"))
        ((ObjectNode) i)
            .put(
                "source",
                address.contains(field)
                    ? "address"
                    : sources.getOrDefault(field, List.of()).stream().findFirst().orElse(""));
      JsonNode mapping =
          list(plan.path("fields")).stream()
              .filter(row -> text(row, "platform_option_id").equals(field))
              .findFirst()
              .orElse(object());
      if (text(i, "code").equals("required")
          && text(mapping.path("conversion"), "kind").equals("multi_lookup")) {
        ((ObjectNode) i).put("source", text(mapping, "editor_group"));
        ((ObjectNode) i).put("code", "required_list");
        ((ObjectNode) i)
            .put(
                "message",
                "Площадке нужен хотя бы один подходящий вариант в разделе «"
                    + text(mapping, "editor_group_name")
                    + "».");
      }
      if (address.contains(field))
        ((ObjectNode) i)
            .put(
                "message",
                text(input.path("address"), "label").isBlank()
                    ? "Укажите адрес квартиры в едином блоке адреса."
                    : "Адрес сохранён один раз. Его сопоставление со справочником этой площадки"
                        + " пока требует проверки на площадке.");
      else if (plan.path("deferred_fields").has(field))
        ((ObjectNode) i).put("message", plan.path("deferred_fields").path(field).asText());
    }
    // Cross-field facts must be valid even if only one marketplace is selected.
    try {
      var values = input.path("values");
      if (!Values.missing(values.get("rental.floor"))
          && !Values.missing(values.get("building.total_floors"))
          && Values.decimal(values.get("rental.floor"), true)
                  .compareTo(Values.decimal(values.get("building.total_floors"), true))
              > 0)
        issues.add(
            object(
                "field",
                "rental.floor",
                "source",
                "rental.floor",
                "code",
                "floor",
                "message",
                "Этаж квартиры не может быть выше этажности дома."));
    } catch (IllegalArgumentException ignored) {
      /* Each platform validates its own numeric/enum domain. */
    }
    for (var legacy : input.path("legacy"))
      if (text(legacy, "platform").isBlank()
          || text(legacy, "platform").equals(text(plan, "platform")))
        issues.add(
            object(
                "field",
                text(legacy, "field"),
                "source",
                "legacy",
                "code",
                "legacy",
                "message",
                "Сверьте сохранённые сведения из прежней карточки."));
    prepared.put("dataReady", issues.isEmpty());
  }
}
