package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import by.autopost.shared.Hashing;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** Defensive copies prevent a migration or editor from modifying the shared catalog. */
public final class ReferenceSnapshot {
  private final String categoryId, version;
  private final JsonNode common, card, audit;
  private final Map<String, JsonNode> schemas, plans, bindings;
  private final Map<String, JsonNode> browsers;

  public JsonNode browser(String platform) {
    return get(browsers, platform);
  }

  public ReferenceSnapshot(
      String categoryId,
      JsonNode common,
      JsonNode card,
      JsonNode audit,
      Map<String, JsonNode> schemas,
      Map<String, JsonNode> plans,
      Map<String, JsonNode> bindings,
      String version) {
    this(categoryId, common, card, audit, schemas, plans, bindings, Map.of(), version);
  }

  public ReferenceSnapshot(
      String categoryId,
      JsonNode common,
      JsonNode card,
      JsonNode audit,
      Map<String, JsonNode> schemas,
      Map<String, JsonNode> plans,
      Map<String, JsonNode> bindings,
      Map<String, JsonNode> browsers,
      String version) {
    this.browsers = copy(browsers);
    this.categoryId = categoryId;
    this.common = common.deepCopy();
    this.card = card.deepCopy();
    this.audit = audit.deepCopy();
    this.schemas = copy(schemas);
    this.plans = copy(plans);
    this.bindings = copy(bindings);
    this.version = version;
  }

  private static Map<String, JsonNode> copy(Map<String, JsonNode> source) {
    Map<String, JsonNode> result = new TreeMap<>();
    source.forEach((k, v) -> result.put(k, v.deepCopy()));
    return Collections.unmodifiableMap(result);
  }

  public String categoryId() {
    return categoryId;
  }

  public String version() {
    return version;
  }

  public Set<String> platforms() {
    return schemas.keySet();
  }

  public JsonNode common() {
    return common.deepCopy();
  }

  public JsonNode card() {
    return card.deepCopy();
  }

  public JsonNode audit() {
    return audit.deepCopy();
  }

  public JsonNode schema(String platform) {
    return get(schemas, platform);
  }

  public JsonNode plan(String platform) {
    return get(plans, platform);
  }

  public JsonNode binding(String platform) {
    return bindings.getOrDefault(platform, object()).deepCopy();
  }

  private JsonNode get(Map<String, JsonNode> source, String key) {
    if (!source.containsKey(key)) throw new ApiException(400, "Неизвестная площадка.");
    return source.get(key).deepCopy();
  }

  public static String fingerprint(JsonNode common, JsonNode card, Map<String, JsonNode> plans) {
    var snapshot = object("common", common, "card", card);
    new TreeMap<>(plans).forEach(snapshot::set);
    return Hashing.sha256(snapshot.toString());
  }
}
