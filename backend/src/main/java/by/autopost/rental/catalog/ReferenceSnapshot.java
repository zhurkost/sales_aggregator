package by.autopost.rental.catalog;

import by.autopost.rental.engine.PlatformCoverage;
import by.autopost.rental.model.CardFields;
import by.autopost.rental.model.CardModel;
import by.autopost.rental.model.FieldDef;
import by.autopost.rental.model.FormRecipe;
import by.autopost.rental.model.Mapping;
import by.autopost.rental.model.Schema;
import by.autopost.shared.ApiException;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * The reference bundle of this release, parsed into immutable records once: every operation reads
 * the same instance and nothing can change it.
 *
 * <p>Two versions: {@code cardVersion} covers what a card sees and stores (common and card.json)
 * and is compared by the editor, preparation and AI; {@code integrationVersion} covers how cards
 * reach the forms (manifest, source schemas, plans, browser recipes) and goes to the extension
 * only, so a selector fix never stops an open editor.
 */
public final class ReferenceSnapshot {
  /** One platform: its source schema, plan, form recipe and their coverage. */
  public record Platform(
      String id, Schema schema, Mapping plan, FormRecipe form, PlatformCoverage coverage) {}

  private final String categoryId, cardVersion, integrationVersion;
  private final Schema common;
  private final CardModel card;
  private final Map<String, Platform> platforms;

  public ReferenceSnapshot(
      String categoryId,
      Schema common,
      CardModel card,
      Map<String, Platform> platforms,
      String cardVersion,
      String integrationVersion) {
    this.categoryId = categoryId;
    this.common = common;
    this.card = card;
    this.platforms = Collections.unmodifiableMap(new TreeMap<>(platforms));
    this.cardVersion = cardVersion;
    this.integrationVersion = integrationVersion;
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

  /** Platform ids in alphabetical order. */
  public Set<String> platforms() {
    return platforms.keySet();
  }

  /** The fields of the card (common). */
  public Schema common() {
    return common;
  }

  /** The groups of card fields the editor shows, without the values derived from the address. */
  public List<FieldDef> cardGroups() {
    return common.categories().get(0).options().stream()
        .filter(group -> !group.id().equals(CardFields.ADDRESS_GROUP))
        .toList();
  }

  public CardModel card() {
    return card;
  }

  public Platform platform(String id) {
    var platform = platforms.get(id);
    if (platform == null) throw new ApiException(400, "Неизвестная площадка.");
    return platform;
  }

  public Schema schema(String platform) {
    return platform(platform).schema();
  }

  public Mapping plan(String platform) {
    return platform(platform).plan();
  }

  public FormRecipe form(String platform) {
    return platform(platform).form();
  }

  /** How the plan of a platform reaches its form, computed when the bundle was loaded. */
  public PlatformCoverage coverage(String platform) {
    return platform(platform).coverage();
  }
}
