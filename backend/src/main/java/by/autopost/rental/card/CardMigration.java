package by.autopost.rental.card;

import static by.autopost.rental.model.SchemaFields.*;
import static by.autopost.rental.model.Values.*;
import static by.autopost.shared.Json.*;

import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.model.Values;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

public final class CardMigration {
  private final ReferenceSnapshot catalog;

  public CardMigration(ReferenceSnapshot catalog) {
    this.catalog = catalog;
  }

  public ObjectNode normalize(JsonNode original) {
    ObjectNode card = original.deepCopy();
    ObjectNode values =
        card.path("values").isObject() ? (ObjectNode) card.get("values") : object();
    card.set("values", values);
    ArrayNode legacy = card.path("legacy").isArray() ? (ArrayNode) card.get("legacy") : array();
    card.set("legacy", legacy);
    ObjectNode address =
        card.path("address").isObject() ? (ObjectNode) card.get("address") : object();
    JsonNode projection = catalog.card().path("addressProjection");
    if (card.path("modelVersion").asInt() < 2) {
      projection
          .fields()
          .forEachRemaining(
              e -> {
                JsonNode v = values.path(e.getKey());
                if (Values.missing(v)) return;
                String part = e.getValue().asText();
                if (part.equals("latitude") || part.equals("longitude")) {
                  if (!Values.equal(address.get(part), v) || !address.path("confirmed").asBoolean())
                    preserve(
                        legacy,
                        "",
                        e.getKey(),
                        "",
                        v,
                        null,
                        "Прежние координаты сохранены в истории. Их связь с текущим адресом не"
                            + " подтверждена.");
                  return;
                }
                // v1 generated these strings from the same selected address; they are not
                // conflicts.
                String derived =
                    part.equals("settlement")
                        ? String.join(
                            ", ",
                            new LinkedHashSet<>(
                                List.of(
                                        text(address, "region"),
                                        text(address, "district"),
                                        text(address, "settlement"))
                                    .stream()
                                    .filter(x -> !x.isBlank())
                                    .toList()))
                        : part.equals("house")
                            ? text(address, "house")
                                + (text(address, "block").isBlank()
                                    ? ""
                                    : " "
                                        + (text(address, "blockType").isBlank()
                                            ? "корп."
                                            : text(address, "blockType"))
                                        + " "
                                        + text(address, "block"))
                            : text(address, part);
                if (!derived.isBlank() && v.isTextual() && derived.equals(v.asText())) return;
                if (Values.missing(address.get(part))) address.set(part, v.deepCopy());
                else if (!Values.equal(address.get(part), v))
                  preserve(
                      legacy,
                      "",
                      e.getKey(),
                      "address." + part,
                      v,
                      v,
                      "Прежняя запись адреса отличается от выбранного адреса. Проверьте её.");
              });
      if (!address.isEmpty()) {
        if (!address.has("provider")) address.put("provider", "manual");
        if (!address.has("confirmed")) address.put("confirmed", false);
        if (!address.has("countryIso")) address.put("countryIso", "BY");
        if (text(address, "label").isBlank()) address.put("label", addressLabel(address));
        card.set("address", address);
      }
    }
    // Address object is the only editable source. Legacy projections never reach preparation.
    projection.fieldNames().forEachRemaining(values::remove);
    ObjectNode extras = object();
    if (card.path("extras").isObject())
      card
          .path("extras")
          .fields()
          .forEachRemaining(
              platform -> {
                String p = platform.getKey();
                JsonNode plan = catalog.platforms().contains(p) ? catalog.plan(p) : object();
                Map<String, JsonNode> rules = new HashMap<>();
                for (var r : plan.path("fields")) rules.put(text(r, "platform_option_id"), r);
                platform
                    .getValue()
                    .fields()
                    .forEachRemaining(
                        entry -> {
                          String target = entry.getKey();
                          JsonNode v = entry.getValue();
                          if (Values.missing(v)) return;
                          if (plan.path("constants").has(target)
                              && Values.equal(plan.path("constants").get(target), v)) return;
                          JsonNode row = rules.get(target);
                          if (row == null) {
                            preserve(
                                legacy,
                                p,
                                target,
                                "",
                                v,
                                null,
                                "Прежнее значение сохранено для сверки; автоматически использовать"
                                    + " его пока нельзя.");
                            return;
                          }
                          var cv = row.path("conversion");
                          if (text(cv, "kind").equals("multi_lookup") && v.isArray()) {
                            List<ObjectNode> transfers = new ArrayList<>();
                            boolean ambiguous = false;
                            for (var selected : v) {
                              List<ObjectNode> candidates = new ArrayList<>();
                              if (!selected.isNull() && !selected.isContainerNode())
                                for (var member : cv.path("members")) {
                                  JsonNode candidate = reverse(member.path("values"), selected);
                                  if (candidate != null)
                                    candidates.add(
                                        object(
                                            "source",
                                            text(member, "common_option_id"),
                                            "value",
                                            candidate,
                                            "old",
                                            selected));
                                }
                              if (candidates.size() != 1) ambiguous = true;
                              else transfers.add(candidates.get(0));
                            }
                            // An unordered native list cannot tell which of several canonical slots
                            // it came from.
                            // Preflight the entire list before assigning anything, including the
                            // unambiguous items.
                            if (ambiguous)
                              preserve(
                                  legacy,
                                  p,
                                  target,
                                  "",
                                  v,
                                  null,
                                  "Прежний список нельзя однозначно распределить по полям."
                                      + " Проверьте его в общей карточке.");
                            else
                              for (var transfer : transfers)
                                migrate(
                                    values,
                                    legacy,
                                    p,
                                    target,
                                    text(transfer, "source"),
                                    transfer.get("old"),
                                    transfer.get("value"));
                          } else {
                            JsonNode candidate =
                                switch (text(cv, "kind")) {
                                  case "lookup" -> reverse(cv.path("values"), v);
                                  case "list_lookup" -> reverseList(cv.path("values"), v);
                                  case "identity", "files", "phone" -> v.deepCopy();
                                  case "decimal" -> TextNode.valueOf(v.asText());
                                  default -> null;
                                };
                            migrate(
                                values,
                                legacy,
                                p,
                                target,
                                text(row, "common_option_id"),
                                v,
                                candidate);
                          }
                        });
              });
    card.set("extras", extras);
    card.put("modelVersion", 2);
    card.put("schemaVersion", catalog.version());
    return card;
  }

  public static JsonNode reverse(JsonNode pairs, JsonNode v) {
    if (v == null || v.isNull() || v.isContainerNode()) return null;
    var matches =
        list(pairs).stream()
            .filter(p -> Values.equal(p.path("to"), v))
            .map(p -> p.path("from"))
            .distinct()
            .toList();
    return matches.size() == 1 ? matches.get(0).deepCopy() : null;
  }

  public static JsonNode reverseList(JsonNode pairs, JsonNode v) {
    if (!v.isArray()) return null;
    ArrayNode result = array();
    for (var item : v) {
      var mapped = reverse(pairs, item);
      if (mapped == null) return null;
      result.add(mapped);
    }
    return result;
  }

  public static void migrate(
      ObjectNode values,
      ArrayNode legacy,
      String p,
      String target,
      String source,
      JsonNode old,
      JsonNode candidate) {
    if (candidate != null && !source.isBlank()) {
      if (Values.missing(values.get(source))) {
        values.set(source, candidate.deepCopy());
        return;
      }
      if (Values.equal(values.get(source), candidate)) return;
    }
    preserve(
        legacy,
        p,
        target,
        source,
        old,
        candidate,
        candidate == null
            ? "Нужно сверить прежнее значение."
            : "Прежнее уточнение отличается от общей карточки. Выберите верное значение один раз.");
  }

  public static void preserve(
      ArrayNode legacy,
      String p,
      String target,
      String source,
      JsonNode old,
      JsonNode candidate,
      String message) {
    ObjectNode entry =
        object(
            "platform",
            p,
            "field",
            target,
            "source",
            source,
            "value",
            old,
            "candidate",
            candidate,
            "message",
            message);
    if (list(legacy).stream().noneMatch(entry::equals)) legacy.add(entry);
  }

  public static String addressLabel(JsonNode a) {
    List<String> xs = new ArrayList<>();
    for (String p : List.of("region", "district", "settlement", "street", "house", "block"))
      if (!text(a, p).isBlank()) xs.add(text(a, p));
    return String.join(", ", xs);
  }
}
