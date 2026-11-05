package by.autopost.rental.persistence;

import static by.autopost.shared.Json.*;

import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.model.Conversion;
import by.autopost.rental.model.MappingRule;
import by.autopost.rental.model.ReferenceContract;
import by.autopost.rental.model.Value;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Converts a card older than the current card model. It runs once per stored card, from
 * --migrate-rental-drafts; reading, checking and publishing a card never call it. A stored card of
 * an older model is a JSON document without a record of its own; the rules come from the bundle.
 */
public final class CardMigration {
  private final ReferenceSnapshot catalog;

  /** A card saved before the current card model; it has to be migrated before use. */
  public static boolean outdated(JsonNode draft) {
    return draft.path("modelVersion").asInt() < ReferenceContract.CARD_MODEL_VERSION;
  }

  /**
   * A stored card the one-time migration rewrites: an older card model, or a card of the current
   * model that still keeps the former {@code schemaVersion}, the hash of every rule and selector,
   * or {@code localPhotoIds}, the IDs of photos kept in one browser before photos were stored on
   * the server.
   */
  public static boolean migrationNeeded(JsonNode draft) {
    return outdated(draft) || draft.has("schemaVersion") || draft.has("localPhotoIds");
  }

  public CardMigration(ReferenceSnapshot catalog) {
    this.catalog = catalog;
  }

  /**
   * A card of the current model with keys of earlier releases. Saved before cardVersion existed,
   * its values already follow the card model of this release, so it takes this release's card
   * version; a cardVersion it has stays. The photos are stored on the server, so the IDs of the
   * browser's copies go. Nothing else changes.
   */
  public ObjectNode tidy(JsonNode original) {
    ObjectNode draft = original.deepCopy();
    if (draft.has("schemaVersion")) {
      draft.remove("schemaVersion");
      draft.put("cardVersion", catalog.cardVersion());
    }
    draft.remove("localPhotoIds");
    return draft;
  }

  public ObjectNode normalize(JsonNode original) {
    ObjectNode draft = original.deepCopy();
    ObjectNode values =
        draft.path("values").isObject() ? (ObjectNode) draft.get("values") : object();
    draft.set("values", values);
    ArrayNode legacy = draft.path("legacy").isArray() ? (ArrayNode) draft.get("legacy") : array();
    draft.set("legacy", legacy);
    ObjectNode address =
        draft.path("address").isObject() ? (ObjectNode) draft.get("address") : object();
    var projection = catalog.card().addressProjection();
    if (draft.path("modelVersion").asInt() < ReferenceContract.CARD_MODEL_VERSION) {
      projection.forEach(
              (key, part) -> {
                JsonNode v = values.path(key);
                if (missing(v)) return;
                if (part.equals("latitude") || part.equals("longitude")) {
                  if (!equal(address.get(part), v) || !address.path("confirmed").asBoolean())
                    preserve(
                        legacy,
                        "",
                        key,
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
                if (missing(address.get(part))) address.set(part, v.deepCopy());
                else if (!equal(address.get(part), v))
                  preserve(
                      legacy,
                      "",
                      key,
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
        draft.set("address", address);
      }
    }
    // Address object is the only editable source.
    projection.keySet().forEach(values::remove);
    if (draft.path("extras").isObject())
      draft
          .path("extras")
          .fields()
          .forEachRemaining(
              platform -> {
                String p = platform.getKey();
                var plan = catalog.platforms().contains(p) ? catalog.plan(p) : null;
                Map<String, MappingRule> rules = new HashMap<>();
                Map<String, Value> constants = plan == null ? Map.of() : plan.constants();
                if (plan != null) for (var r : plan.fields()) rules.put(r.platformOptionId(), r);
                platform
                    .getValue()
                    .fields()
                    .forEachRemaining(
                        entry -> {
                          String target = entry.getKey();
                          JsonNode v = entry.getValue();
                          if (missing(v)) return;
                          if (constants.containsKey(target)
                              && equal(json(constants.get(target)), v)) return;
                          MappingRule row = rules.get(target);
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
                          var cv = row.conversion();
                          if (cv instanceof Conversion.MultiLookup list && v.isArray()) {
                            List<ObjectNode> transfers = new ArrayList<>();
                            boolean ambiguous = false;
                            for (var selected : v) {
                              List<ObjectNode> candidates = new ArrayList<>();
                              if (!selected.isNull() && !selected.isContainerNode())
                                for (var member : list.members()) {
                                  JsonNode candidate = reverse(member.values(), selected);
                                  if (candidate != null)
                                    candidates.add(
                                        object(
                                            "source",
                                            member.commonOptionId(),
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
                                cv instanceof Conversion.Lookup lookup
                                    ? reverse(lookup.values(), v)
                                    : cv instanceof Conversion.ListLookup lookup
                                        ? reverseList(lookup.values(), v)
                                        : cv instanceof Conversion.Identity
                                                || cv instanceof Conversion.Files
                                                || cv instanceof Conversion.Phone
                                            ? v.deepCopy()
                                            : cv instanceof Conversion.Decimal
                                                ? TextNode.valueOf(v.asText())
                                                : null;
                            migrate(
                                values, legacy, p, target, row.commonOptionId(), v, candidate);
                          }
                        });
              });
    // Model 2 keeps every fact in values; platform extras are not part of it.
    draft.remove("extras");
    draft.remove("localPhotoIds");
    draft.put("modelVersion", ReferenceContract.CARD_MODEL_VERSION);
    // The card keeps only the version of the card model it was converted to.
    draft.remove("schemaVersion");
    draft.put("cardVersion", catalog.cardVersion());
    return draft;
  }

  public static JsonNode reverse(List<Conversion.ValuePair> pairs, JsonNode v) {
    if (v == null || v.isNull() || v.isContainerNode()) return null;
    var matches =
        pairs.stream()
            .filter(p -> equal(json(p.to()), v))
            .map(p -> json(p.from()))
            .distinct()
            .toList();
    return matches.size() == 1 ? matches.get(0).deepCopy() : null;
  }

  public static JsonNode reverseList(List<Conversion.ValuePair> pairs, JsonNode v) {
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
      if (missing(values.get(source))) {
        values.set(source, candidate.deepCopy());
        return;
      }
      if (equal(values.get(source), candidate)) return;
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

  /** A code of the bundle as the JSON of a stored card. */
  private static JsonNode json(Value value) {
    return TYPED.valueToTree(value);
  }

  private static boolean missing(JsonNode value) {
    return value == null
        || value.isMissingNode()
        || value.isNull()
        || value.isTextual() && value.asText().isBlank()
        || value.isArray() && value.isEmpty();
  }

  private static boolean equal(JsonNode a, JsonNode b) {
    if (a == null || b == null) return false;
    if (a.isNumber() && b.isNumber()) return a.decimalValue().compareTo(b.decimalValue()) == 0;
    return a.equals(b);
  }

  public static String addressLabel(JsonNode a) {
    List<String> xs = new ArrayList<>();
    for (String p : List.of("region", "district", "settlement", "street", "house", "block"))
      if (!text(a, p).isBlank()) xs.add(text(a, p));
    return String.join(", ", xs);
  }
}
