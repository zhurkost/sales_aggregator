package by.autopost.rental.catalog;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * One operation's view of the reference bundle. Each part is copied once, at its first use in the
 * operation, and the same copy is returned afterwards: what an editor or a migration changes in
 * it never reaches the loaded bundle or another operation. A view is used by one thread.
 *
 * <p>Two versions: {@code cardVersion} covers what a card sees and stores (common and card.json)
 * and is compared by the editor, preparation and AI; {@code integrationVersion} covers how cards
 * reach the forms (manifest, source schemas, plans, browser recipes) and goes to the extension
 * only, so a selector fix never stops an open editor.
 */
public final class ReferenceSnapshot {
  private final String categoryId, cardVersion, integrationVersion;
  // The loaded parts: shared by every view and never changed or handed out.
  private final JsonNode common, card;
  private final Map<String, JsonNode> schemas, plans, browsers;
  // Immutable records: shared by every view as they are.
  private final Map<String, PlatformCoverage> coverage;
  private final Map<String, JsonNode> copies = new HashMap<>();

  public ReferenceSnapshot(
      String categoryId,
      JsonNode common,
      JsonNode card,
      Map<String, JsonNode> schemas,
      Map<String, JsonNode> plans,
      Map<String, JsonNode> browsers,
      Map<String, PlatformCoverage> coverage,
      String cardVersion,
      String integrationVersion) {
    this.categoryId = categoryId;
    this.common = common.deepCopy();
    this.card = card.deepCopy();
    this.schemas = copy(schemas);
    this.plans = copy(plans);
    this.browsers = copy(browsers);
    this.coverage = Map.copyOf(coverage);
    this.cardVersion = cardVersion;
    this.integrationVersion = integrationVersion;
  }

  private ReferenceSnapshot(ReferenceSnapshot loaded) {
    categoryId = loaded.categoryId;
    common = loaded.common;
    card = loaded.card;
    schemas = loaded.schemas;
    plans = loaded.plans;
    browsers = loaded.browsers;
    coverage = loaded.coverage;
    cardVersion = loaded.cardVersion;
    integrationVersion = loaded.integrationVersion;
  }

  /** A fresh view of the same bundle for the next operation, with copies of its own. */
  public ReferenceSnapshot view() {
    return new ReferenceSnapshot(this);
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
    return copy("common", common);
  }

  public JsonNode card() {
    return copy("card", card);
  }

  public JsonNode schema(String platform) {
    return copy("schema:" + platform, get(schemas, platform));
  }

  public JsonNode plan(String platform) {
    return copy("plan:" + platform, get(plans, platform));
  }

  public JsonNode browser(String platform) {
    return copy("browser:" + platform, get(browsers, platform));
  }

  /** How the plan of a platform reaches its form, computed when the bundle was loaded. */
  public PlatformCoverage coverage(String platform) {
    if (!coverage.containsKey(platform)) throw new ApiException(400, "Неизвестная площадка.");
    return coverage.get(platform);
  }

  private JsonNode copy(String part, JsonNode loaded) {
    return copies.computeIfAbsent(part, key -> loaded.deepCopy());
  }

  private static JsonNode get(Map<String, JsonNode> source, String key) {
    if (!source.containsKey(key)) throw new ApiException(400, "Неизвестная площадка.");
    return source.get(key);
  }
}
