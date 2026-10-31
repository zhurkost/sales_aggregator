package by.autopost;

import static by.autopost.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.net.URI;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Component;

/**
 * Pure business rules. Catalogues are the same snapshots used by the Angular client and extension.
 */
@Component
class Domain {
  final JsonNode catalog, taxonomy, fields;

  Domain() throws Exception {
    catalog = MAPPER.readTree(getClass().getResourceAsStream("/domain.json"));
    taxonomy = MAPPER.readTree(getClass().getResourceAsStream("/data/taxonomy.json"));
    fields = MAPPER.readTree(getClass().getResourceAsStream("/data/category-fields.json"));
  }

  JsonNode category(String id) {
    String canonical = taxonomy.path("aliases").path(id).asText(id);
    return list(taxonomy.path("nodes")).stream()
        .filter(n -> text(n, "id").equals(canonical))
        .findFirst()
        .orElse(null);
  }

  ObjectNode listing(JsonNode input) {
    ObjectNode out = catalog.path("emptyListing").deepCopy();
    out.fieldNames()
        .forEachRemaining(
            k -> {
              if (!k.equals("category")) {
                JsonNode v = input == null ? null : input.get(k);
                String s = v != null && (v.isTextual() || v.isNumber()) ? v.asText().trim() : "";
                out.put(
                    k,
                    s.substring(
                        0,
                        Math.min(
                            s.length(),
                            k.equals("description")
                                ? 8000
                                : k.equals("compatibility")
                                    ? 500
                                    : k.equals("title") ? 120 : 100)));
              }
            });
    String group = text(input, "category");
    out.put("category", Set.of("cars", "parts", "general").contains(group) ? group : "cars");
    for (String k : List.of("year", "price", "mileage"))
      out.put(k, text(out, k).replaceAll("[\\s\u00a0]", ""));
    out.put("engine", text(out, "engine").replace(',', '.'));
    String currency = text(out, "currency").toUpperCase(Locale.ROOT);
    out.put("currency", Set.of("USD", "BYN", "EUR").contains(currency) ? currency : "");
    if (text(out, "category").equals("parts")) {
      for (String k : List.of("mileage", "engine", "fuel", "transmission", "body", "drive", "vin"))
        out.put(k, "");
      validOption(out, "condition", List.of("Новая", "Б/у", "На восстановление"));
      validOption(out, "priceUnit", List.of("За штуку", "За комплект", "За пару"));
      validOption(out, "availability", List.of("В наличии", "Под заказ", "Нет в наличии"));
    }
    return out;
  }

  private void validOption(ObjectNode n, String k, List<String> options) {
    if (!options.contains(text(n, k))) n.put(k, "");
  }

  String title(JsonNode listing) {
    String title = text(listing, "title");
    if (!title.isEmpty()) return title;
    var keys =
        text(listing, "category").equals("parts")
            ? List.of("partName", "brand", "model", "partNumber")
            : List.of("brand", "model", "year");
    return String.join(
        " ", keys.stream().map(k -> text(listing, k)).filter(v -> !v.isEmpty()).toList());
  }

  List<JsonNode> platforms(JsonNode listing) {
    return list(catalog.path("platforms").path(text(listing, "category")));
  }

  String canonical(String platform) {
    return platform.replaceAll("-(parts|general)$", "").replaceAll("^avby$", "av");
  }

  ObjectNode overrides(JsonNode input) {
    ObjectNode result = object();
    if (input != null && input.isObject())
      input
          .fields()
          .forEachRemaining(
              e -> {
                if (e.getValue().isTextual()
                    && taxonomy.path("options").path(e.getKey()).has(e.getValue().asText()))
                  result.set(e.getKey(), e.getValue());
              });
    return result;
  }

  JsonNode mapping(String id, String platform, JsonNode overrides) {
    JsonNode option = taxonomy.path("options").path(platform).path(text(overrides, platform));
    if (!option.isMissingNode()) return option;
    JsonNode cat = category(id);
    return cat == null ? null : cat.path("mappings").get(platform);
  }

  List<JsonNode> rules(JsonNode listing, JsonNode values, JsonNode overrides) {
    JsonNode mapping = mapping(text(listing, "taxonomyId"), "kufar", overrides);
    var rules = rawRules(listing, mapping);
    ObjectNode selections = values != null && values.isObject() ? values.deepCopy() : object();
    for (var rule : rules) {
      String source = text(listing, catalog.path("baseFieldKeys").path(text(rule, "key")).asText());
      if (!source.isEmpty()) {
        var opts = list(rule.path("options"));
        var opt =
            opts.stream().filter(o -> norm(o.path(1).asText()).equals(norm(source))).findFirst();
        if (opt.isPresent() || opts.isEmpty())
          selections.put(text(rule, "key"), opt.isPresent() ? opt.get().path(0).asText() : source);
      }
    }
    if (mapping != null)
      for (var fixed : list(mapping.path("attributes")))
        selections.put(text(fixed, "key"), text(fixed, "value"));
    Map<String, JsonNode> selected = new LinkedHashMap<>();
    for (var rule : rules) {
      String key = text(rule, "key");
      if (Set.of("coordinates", "other_parameters", "re_object_checked", "responsible_account_id")
          .contains(key)) continue;
      boolean applies =
          list(rule.path("depends")).stream()
              .allMatch(
                  dep ->
                      dep.path("values").isArray()
                          ? has(dep.path("values"), text(selections, text(dep, "key")))
                          : !text(selections, text(dep, "key")).isEmpty());
      if (applies) selected.putIfAbsent(key, rule);
    }
    return new ArrayList<>(selected.values());
  }

  private List<JsonNode> rawRules(JsonNode listing, JsonNode mapping) {
    List<JsonNode> all = new ArrayList<>();
    if (mapping != null) all.addAll(list(fields.path("kufar").path(text(mapping, "id"))));
    all.addAll(list(fields.path("extra").path(text(listing, "taxonomyId"))));
    return all;
  }

  private String norm(String s) {
    return s.toLowerCase(Locale.ROOT)
        .replace('ё', 'е')
        .replaceAll("[\\s.,/()-]+", "")
        .replaceAll("^нов(?:ая|ый|ое)$", "новое");
  }

  ObjectNode attributes(JsonNode listing, JsonNode raw, JsonNode overrides) {
    ObjectNode result = object();
    JsonNode mapping = mapping(text(listing, "taxonomyId"), "kufar", overrides);
    Set<String> allowed = new HashSet<>();
    rawRules(listing, mapping).forEach(r -> allowed.add(text(r, "key")));
    if (raw != null && raw.isObject()) {
      var iterator = raw.fields();
      int count = 0;
      while (iterator.hasNext() && count++ < 80) {
        var e = iterator.next();
        String value = e.getValue().asText("");
        if (allowed.contains(e.getKey())
            && !catalog.path("baseFieldKeys").has(e.getKey())
            && e.getValue().isTextual()
            && value.length() <= 300
            && !value.matches("(?s).*[\\x00-\\x1f].*")) result.put(e.getKey(), value.trim());
      }
    }
    for (int pass = 0; pass < 8; pass++) {
      List<JsonNode> applicable = rules(listing, result, overrides);
      List<String> remove = new ArrayList<>();
      result
          .fields()
          .forEachRemaining(
              e -> {
                var rule =
                    applicable.stream()
                        .filter(r -> text(r, "key").equals(e.getKey()))
                        .findFirst()
                        .orElse(null);
                if (e.getValue().asText().isEmpty()
                    || rule == null
                    || mapping != null
                        && list(mapping.path("attributes")).stream()
                            .anyMatch(a -> text(a, "key").equals(e.getKey()))
                    || rule.path("options").size() > 0
                        && list(rule.path("options")).stream()
                            .noneMatch(o -> o.path(0).asText().equals(e.getValue().asText())))
                  remove.add(e.getKey());
              });
      if (remove.isEmpty()) break;
      result.remove(remove);
    }
    return result;
  }

  ArrayNode entries(JsonNode listing, JsonNode attributes, JsonNode overrides) {
    ObjectNode values = attributes(listing, attributes, overrides);
    ArrayNode result = array();
    for (var rule : rules(listing, values, overrides)) {
      String key = text(rule, "key"), value = text(values, key);
      if (value.isEmpty()) continue;
      String label =
          list(rule.path("options")).stream()
              .filter(o -> o.path(0).asText().equals(value))
              .map(o -> o.path(1).asText())
              .findFirst()
              .orElse(value);
      ObjectNode entry =
          object(
              "key",
              key,
              "label",
              text(rule, "label"),
              "value",
              value,
              "text",
              label,
              "platform",
              rule.path("platform").asText("kufar"),
              "description",
              rule.path("description").asBoolean(true));
      if (rule.has("formName")) entry.set("formName", rule.get("formName"));
      result.add(entry);
    }
    return result;
  }

  String description(JsonNode listing, JsonNode attributes, JsonNode overrides) {
    String details =
        String.join(
            "\n",
            list(entries(listing, attributes, overrides)).stream()
                .filter(e -> e.path("description").asBoolean())
                .map(e -> text(e, "label") + ": " + text(e, "text"))
                .toList());
    return text(listing, "description")
        + (details.isEmpty() ? "" : "\n\nХарактеристики:\n" + details);
  }

  ObjectNode recipe(JsonNode input) {
    ObjectNode listing = listing(input.path("listing"));
    String id = text(listing, "taxonomyId");
    if (id.isEmpty())
      id =
          text(listing, "category").equals("cars")
              ? "auto.cars"
              : text(listing, "category").equals("parts") ? "auto.parts" : "";
    JsonNode cat = category(id);
    if (cat == null) throw new ApiException(400, "Подтвердите категорию товара.");
    listing.put("taxonomyId", text(cat, "id"));
    listing.put("category", text(cat, "group"));
    ObjectNode overrides = overrides(input.get("categoryOverrides"));
    if (input.has("categoryOverrides") && !overrides.equals(input.get("categoryOverrides")))
      throw new ApiException(400, "Категория площадки отсутствует в справочнике.");
    List<JsonNode> platforms =
        platforms(listing).stream()
            .filter(
                p ->
                    !input.has("platforms")
                        || list(input.get("platforms")).stream()
                            .anyMatch(i -> text(i, "id").equals(text(p, "id"))))
            .toList();
    ObjectNode mappings = object();
    for (var p : platforms) {
      String canonical = text(p, "canonicalId");
      JsonNode m = mapping(text(cat, "id"), canonical, overrides);
      if (m != null)
        mappings.set(
            canonical,
            object(
                "id",
                text(m, "id"),
                "path",
                m.path("path"),
                "attributes",
                m.has("attributes") ? m.get("attributes") : array()));
    }
    ArrayNode entries = array();
    for (var entry : entries(listing, input.path("attributes"), overrides))
      if (platforms.stream().anyMatch(p -> text(p, "canonicalId").equals(text(entry, "platform"))))
        entries.add(entry);
    return object(
        "protocol",
        1,
        "version",
        text(taxonomy, "version") + "/" + text(fields, "checkedAt"),
        "taxonomyId",
        text(cat, "id"),
        "category",
        text(cat, "group"),
        "mappings",
        mappings,
        "values",
        attributes(listing, input.path("attributes"), overrides),
        "entries",
        entries);
  }

  String safeUrl(String platform, String raw) {
    if (raw.length() > 1500) return "";
    var hosts =
        Map.of(
            "av",
            List.of("av.by", "cars.av.by"),
            "kufar",
            List.of("www.kufar.by", "kufar.by", "auto.kufar.by"),
            "bamper",
            List.of("bamper.by", "www.bamper.by"),
            "onliner",
            List.of("ab.onliner.by", "baraholka.onliner.by", "mb.onliner.by"),
            "abw",
            List.of("abw.by", "www.abw.by"),
            "flagma",
            List.of("flagma.by"),
            "drom",
            List.of("auto.drom.ru"));
    try {
      URI u = URI.create(raw);
      if (!"https".equals(u.getScheme())
          || u.getUserInfo() != null
          || u.getPort() != -1 && !Integer.valueOf(443).equals(u.getPort())
          || !hosts.getOrDefault(canonical(platform), List.of()).contains(u.getHost())) return "";
      return raw.split("#", 2)[0];
    } catch (Exception e) {
      return "";
    }
  }

  JsonNode remoteStatus(JsonNode raw) {
    try {
      Instant time = Instant.parse(text(raw, "checkedAt"));
      if (!catalog.path("remoteStatusLabel").has(text(raw, "state"))
          || time.isAfter(Instant.now().plusSeconds(300))) return null;
      return object(
          "state",
          text(raw, "state"),
          "checkedAt",
          time.toString(),
          "message",
          clean(raw, "message", 500));
    } catch (Exception e) {
      return null;
    }
  }

  ObjectNode normalize(ObjectNode record) {
    JsonNode listing = record.path("listing"), cat = category(text(listing, "taxonomyId"));
    if (cat == null || text(cat, "id").equals(text(listing, "taxonomyId"))) return record;
    ObjectNode copy = record.deepCopy();
    ((ObjectNode) copy.path("listing"))
        .put("taxonomyId", text(cat, "id"))
        .put("category", text(cat, "group"));
    var platforms = platforms(copy.path("listing"));
    java.util.function.Function<String, String> convert =
        id ->
            platforms.stream()
                .filter(p -> text(p, "canonicalId").equals(canonical(id)))
                .map(p -> text(p, "id"))
                .findFirst()
                .orElse(id);
    ArrayNode selected = array();
    for (var id : list(copy.path("selected"))) selected.add(convert.apply(id.asText()));
    copy.set("selected", selected);
    for (var job : list(copy.path("jobs")))
      ((ObjectNode) job).put("platformId", convert.apply(text(job, "platformId")));
    return copy;
  }

  ObjectNode edit(JsonNode listing, JsonNode edit) {
    ObjectNode result = listing.deepCopy();
    String mode = text(edit, "priceMode");
    if (!Set.of("keep", "percent", "fixed").contains(mode))
      throw new ApiException(400, "Неизвестное изменение цены.");
    for (String k : List.of("city", "phone", "availability")) {
      String v = clean(edit, k, 100);
      if (!v.isEmpty()) result.put(k, v);
    }
    if (!text(edit, "phone").isEmpty()
        && !text(edit, "phone").replaceAll("[\\s()-]", "").matches("\\+375\\d{9}"))
      throw new ApiException(400, "Телефон в формате +375XXXXXXXXX.");
    if (!text(edit, "availability").isEmpty()
        && !Set.of("В наличии", "Под заказ").contains(text(edit, "availability")))
      throw new ApiException(400, "Неизвестное наличие.");
    if (!mode.equals("keep")) {
      try {
        String value = text(edit, "priceValue").replace(',', '.');
        if (!value.matches("-?\\d+(?:\\.\\d{1,2})?")) throw new IllegalArgumentException();
        double v = Double.parseDouble(value);
        double price =
            mode.equals("fixed") ? v : Double.parseDouble(text(listing, "price")) * (1 + v / 100);
        long cents = Math.round((price + Math.ulp(1.0)) * 100);
        if (cents <= 0 || cents > 1_000_000_000_000L) throw new IllegalArgumentException();
        result.put(
            "price", String.format(Locale.ROOT, "%.2f", cents / 100.0).replaceAll("\\.00$", ""));
      } catch (Exception e) {
        throw new ApiException(
            400, "Результирующая цена должна быть больше нуля и не более 10 млрд.");
      }
    }
    return result;
  }
}
