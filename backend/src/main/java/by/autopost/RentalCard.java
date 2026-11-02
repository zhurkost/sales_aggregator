package by.autopost;

import static by.autopost.Json.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

/** Canonical card v2. Source dictionaries remain private; this layer never performs publication. */
class RentalCard {
  final RentalCatalog catalog;
  RentalCard(RentalCatalog catalog) { this.catalog = catalog; }

  static void decorate(ObjectNode editor, JsonNode card) {
    editor.set("card", card.deepCopy());
    ArrayNode groups = array();
    for (var group : editor.path("category").path("options")) {
      if (text(group, "id").equals("group.address_projection")) continue;
      ObjectNode copy = group.deepCopy();
      for (var f : copy.path("options")) {
        ArrayNode uses = array();
        editor.path("platforms").fields().forEachRemaining(platform -> {
          for (var row : platform.getValue().path("rules")) {
            List<String> sources = sources(row);
            if (sources.contains(text(f, "id")))
              uses.add(object("platform", platform.getKey(), "target", text(row, "platform_option_id"), "when", platform.getValue().path("conditions").get(text(row, "platform_option_id"))));
          }
        });
        ((ObjectNode) f).set("uses", uses);
      }
      groups.add(copy);
    }
    ((ObjectNode) editor.path("category")).set("options", groups);
  }

  static List<String> sources(JsonNode row) {
    List<String> ids = new ArrayList<>();
    if (!text(row, "common_option_id").isBlank()) ids.add(text(row, "common_option_id"));
    for (var m : row.path("conversion").path("members")) ids.add(text(m, "common_option_id"));
    return ids;
  }

  ObjectNode normalize(JsonNode original) {
    ObjectNode draft = original.deepCopy();
    ObjectNode values = draft.path("values").isObject() ? (ObjectNode) draft.get("values") : object();
    draft.set("values", values);
    ArrayNode legacy = draft.path("legacy").isArray() ? (ArrayNode) draft.get("legacy") : array();
    draft.set("legacy", legacy);
    ObjectNode address = draft.path("address").isObject() ? (ObjectNode) draft.get("address") : object();
    JsonNode projection = catalog.card().path("addressProjection");
    if (draft.path("modelVersion").asInt() < 2) {
      projection.fields().forEachRemaining(e -> {
        JsonNode v = values.path(e.getKey());
        if (PreparationEngine.missing(v)) return;
        String part = e.getValue().asText();
        if (part.equals("latitude") || part.equals("longitude")) {
          if (!PreparationEngine.equal(address.get(part), v) || !address.path("confirmed").asBoolean())
            preserve(legacy, "", e.getKey(), "", v, null, "Прежние координаты сохранены в истории. Их связь с текущим адресом не подтверждена.");
          return;
        }
        // v1 generated these strings from the same selected address; they are not conflicts.
        String derived = part.equals("settlement")
            ? String.join(", ", new LinkedHashSet<>(List.of(text(address, "region"), text(address, "district"), text(address, "settlement")).stream().filter(x -> !x.isBlank()).toList()))
            : part.equals("house") ? text(address, "house") + (text(address, "block").isBlank() ? "" : " " + (text(address, "blockType").isBlank() ? "корп." : text(address, "blockType")) + " " + text(address, "block")) : text(address, part);
        if (!derived.isBlank() && v.isTextual() && derived.equals(v.asText())) return;
        if (PreparationEngine.missing(address.get(part))) address.set(part, v.deepCopy());
        else if (!PreparationEngine.equal(address.get(part), v))
          preserve(legacy, "", e.getKey(), "address." + part, v, v,
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
    // Address object is the only editable source. Legacy projections never reach preparation.
    projection.fieldNames().forEachRemaining(values::remove);
    ObjectNode extras = object();
    if (draft.path("extras").isObject()) draft.path("extras").fields().forEachRemaining(platform -> {
      String p = platform.getKey();
      JsonNode plan = catalog.platforms().contains(p) ? catalog.plan(p) : object();
      Map<String, JsonNode> rules = new HashMap<>();
      for (var r : plan.path("fields")) rules.put(text(r, "platform_option_id"), r);
      platform.getValue().fields().forEachRemaining(entry -> {
        String target = entry.getKey(); JsonNode v = entry.getValue();
        if (PreparationEngine.missing(v)) return;
        if (plan.path("constants").has(target) && PreparationEngine.equal(plan.path("constants").get(target), v)) return;
        JsonNode row = rules.get(target);
        if (row == null) {
          preserve(legacy, p, target, "", v, null,
              "Прежнее значение сохранено для сверки; автоматически использовать его пока нельзя.");
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
                if (candidate != null) candidates.add(object("source", text(member, "common_option_id"), "value", candidate, "old", selected));
              }
            if (candidates.size() != 1) ambiguous = true;
            else transfers.add(candidates.get(0));
          }
          // An unordered native list cannot tell which of several canonical slots it came from.
          // Preflight the entire list before assigning anything, including the unambiguous items.
          if (ambiguous) preserve(legacy, p, target, "", v, null,
              "Прежний список нельзя однозначно распределить по полям. Проверьте его в общей карточке.");
          else for (var transfer : transfers)
            migrate(values, legacy, p, target, text(transfer, "source"), transfer.get("old"), transfer.get("value"));
        } else {
          JsonNode candidate = switch (text(cv, "kind")) {
            case "lookup" -> reverse(cv.path("values"), v);
            case "list_lookup" -> reverseList(cv.path("values"), v);
            case "identity", "files", "phone" -> v.deepCopy();
            case "decimal" -> TextNode.valueOf(v.asText());
            default -> null;
          };
          migrate(values, legacy, p, target, text(row, "common_option_id"), v, candidate);
        }
      });
    });
    draft.set("extras", extras);
    draft.put("modelVersion", 2);
    draft.put("schemaVersion", catalog.version());
    return draft;
  }

  static JsonNode reverse(JsonNode pairs, JsonNode v) {
    if (v == null || v.isNull() || v.isContainerNode()) return null;
    var matches = list(pairs).stream().filter(p -> PreparationEngine.equal(p.path("to"), v)).map(p -> p.path("from")).distinct().toList();
    return matches.size() == 1 ? matches.get(0).deepCopy() : null;
  }
  static JsonNode reverseList(JsonNode pairs, JsonNode v) {
    if (!v.isArray()) return null;
    ArrayNode result = array();
    for (var item : v) { var mapped = reverse(pairs, item); if (mapped == null) return null; result.add(mapped); }
    return result;
  }
  static void migrate(ObjectNode values, ArrayNode legacy, String p, String target, String source, JsonNode old, JsonNode candidate) {
    if (candidate != null && !source.isBlank()) {
      if (PreparationEngine.missing(values.get(source))) { values.set(source, candidate.deepCopy()); return; }
      if (PreparationEngine.equal(values.get(source), candidate)) return;
    }
    preserve(legacy, p, target, source, old, candidate,
        candidate == null ? "Нужно сверить прежнее значение." : "Прежнее уточнение отличается от общей карточки. Выберите верное значение один раз.");
  }
  static void preserve(ArrayNode legacy, String p, String target, String source, JsonNode old, JsonNode candidate, String message) {
    ObjectNode entry = object("platform", p, "field", target, "source", source, "value", old, "candidate", candidate, "message", message);
    if (list(legacy).stream().noneMatch(entry::equals)) legacy.add(entry);
  }
  static String addressLabel(JsonNode a) {
    List<String> xs = new ArrayList<>();
    for (String p : List.of("region", "district", "settlement", "street", "house", "block"))
      if (!text(a, p).isBlank()) xs.add(text(a, p));
    return String.join(", ", xs);
  }
  static void projectAddress(ObjectNode values, JsonNode address, JsonNode card) {
    card.path("addressProjection").fields().forEachRemaining(e -> {
      String part = e.getValue().asText();
      if ((part.equals("latitude") || part.equals("longitude")) && (!address.path("confirmed").asBoolean() || !text(address, "precision").equals("0"))) return;
      if (!PreparationEngine.missing(address.get(part))) values.set(e.getKey(), address.get(part).deepCopy());
    });
  }
  static void annotate(ObjectNode prepared, JsonNode plan, JsonNode input) {
    ArrayNode issues = (ArrayNode) prepared.get("issues");
    Map<String, List<String>> sources = new HashMap<>();
    for (var row : plan.path("fields")) sources.put(text(row, "platform_option_id"), sources(row));
    Set<String> address = new HashSet<>();
    for (var f : plan.path("address_bound_fields")) address.add(f.asText());
    for (var i : issues) {
      String field = text(i, "field");
      if (!i.has("source")) ((ObjectNode) i).put("source", address.contains(field) ? "address" : sources.getOrDefault(field, List.of()).stream().findFirst().orElse(""));
      JsonNode mapping = list(plan.path("fields")).stream().filter(row -> text(row, "platform_option_id").equals(field)).findFirst().orElse(object());
      if (text(i, "code").equals("required") && text(mapping.path("conversion"), "kind").equals("multi_lookup")) {
        ((ObjectNode) i).put("source", text(mapping, "editor_group"));
        ((ObjectNode) i).put("code", "required_list");
        ((ObjectNode) i).put("message", "Площадке нужен хотя бы один подходящий вариант в разделе «" + text(mapping, "editor_group_name") + "».");
      }
      if (address.contains(field)) ((ObjectNode) i).put("message", text(input.path("address"), "label").isBlank()
          ? "Укажите адрес квартиры в едином блоке адреса."
          : "Адрес сохранён один раз. Его сопоставление со справочником этой площадки пока требует проверки на площадке.");
      else if (plan.path("deferred_fields").has(field)) ((ObjectNode) i).put("message", plan.path("deferred_fields").path(field).asText());
    }
    // Cross-field facts must be valid even if only one marketplace is selected.
    try {
      var values = input.path("values");
      if (!PreparationEngine.missing(values.get("rental.floor")) && !PreparationEngine.missing(values.get("building.total_floors"))
          && PreparationEngine.decimal(values.get("rental.floor"), true).compareTo(PreparationEngine.decimal(values.get("building.total_floors"), true)) > 0)
        issues.add(object("field", "rental.floor", "source", "rental.floor", "code", "floor", "message", "Этаж квартиры не может быть выше этажности дома."));
    } catch (IllegalArgumentException ignored) { /* Each platform validates its own numeric/enum domain. */ }
    for (var legacy : input.path("legacy"))
      if (text(legacy, "platform").isBlank() || text(legacy, "platform").equals(text(plan, "platform")))
        issues.add(object("field", text(legacy, "field"), "source", "legacy", "code", "legacy", "message", "Сверьте сохранённые сведения из прежней карточки."));
    prepared.put("dataReady", issues.isEmpty());
  }
}
