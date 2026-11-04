package by.autopost.rental.catalog;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Defensive copies prevent a migration or editor from modifying the shared catalog.
 *
 * <p>Two versions: {@code cardVersion} covers what a card sees and stores (common and card.json)
 * and is compared by the editor, preparation and AI; {@code integrationVersion} covers how cards
 * reach the forms (manifest, source schemas, plans, browser recipes) and goes to the extension
 * only, so a selector fix never stops an open editor.
 */
public final class ReferenceSnapshot {
  private final String categoryId, cardVersion, integrationVersion;
  private final JsonNode common, card;
  private final Map<String, JsonNode> schemas, plans, browsers;

  public JsonNode browser(String platform) {
    return get(browsers, platform);
  }

  public ReferenceSnapshot(
      String categoryId,
      JsonNode common,
      JsonNode card,
      Map<String, JsonNode> schemas,
      Map<String, JsonNode> plans,
      Map<String, JsonNode> browsers,
      String cardVersion,
      String integrationVersion) {
    this.browsers = copy(browsers);
    this.categoryId = categoryId;
    this.common = common.deepCopy();
    this.card = card.deepCopy();
    this.schemas = copy(schemas);
    this.plans = copy(plans);
    this.cardVersion = cardVersion;
    this.integrationVersion = integrationVersion;
  }

  private static Map<String, JsonNode> copy(Map<String, JsonNode> source) {
    Map<String, JsonNode> result = new TreeMap<>();
    source.forEach((k, v) -> result.put(k, v.deepCopy()));
    return Collections.unmodifiableMap(result);
  }

  public String categoryId() {
    return categoryId;
  }

  public String cardVersion() {
    return cardVersion;
  }

  public String integrationVersion() {
    return integrationVersion;
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

  public JsonNode schema(String platform) {
    return get(schemas, platform);
  }

  public JsonNode plan(String platform) {
    return get(plans, platform);
  }

  private JsonNode get(Map<String, JsonNode> source, String key) {
    if (!source.containsKey(key)) throw new ApiException(400, "Неизвестная площадка.");
    return source.get(key).deepCopy();
  }
}
