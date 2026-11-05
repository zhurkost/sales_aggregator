package by.autopost.rental.model;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code card.json}: the card model beside its fields (common) — the version of the stored card,
 * the names of the platforms, the options and labels of card fields, the address projection and
 * the facts that belong to the confirmed house.
 *
 * @param addressProjection card field → the address part it is derived from
 */
public record CardModel(
    Integer version,
    List<ProfileDefault> profileDefaults,
    Map<String, String> valueLabels,
    Map<String, PlatformName> platforms,
    Map<String, List<String>> canonicalValues,
    Map<String, String> addressProjection,
    List<String> addressDependentFacts) {
  public CardModel {
    profileDefaults = profileDefaults == null ? List.of() : List.copyOf(profileDefaults);
    valueLabels = ordered(valueLabels);
    platforms = platforms == null ? null : ordered(platforms);
    if (canonicalValues != null) {
      Map<String, List<String>> lists = new LinkedHashMap<>();
      canonicalValues.forEach((k, v) -> lists.put(k, List.copyOf(v)));
      canonicalValues = Collections.unmodifiableMap(lists);
    }
    addressProjection = ordered(addressProjection);
    addressDependentFacts =
        addressDependentFacts == null ? List.of() : List.copyOf(addressDependentFacts);
  }

  private static <T> Map<String, T> ordered(Map<String, T> map) {
    return map == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(map));
  }

  /** A contact of the owner's profile that fills an absent text field of a new card. */
  public record ProfileDefault(String setting, String field) {}

  public record PlatformName(String name) {}

  /** The name of a platform, its id without one. */
  public String platformName(String platform) {
    var entry = platforms == null ? null : platforms.get(platform);
    return entry == null || entry.name() == null ? platform : entry.name();
  }

  /** The options of a card field; none for a field without options. */
  public List<String> choices(String field) {
    return canonicalValues == null ? List.of() : canonicalValues.getOrDefault(field, List.of());
  }
}
