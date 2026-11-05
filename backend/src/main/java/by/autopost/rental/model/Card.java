package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The card of one apartment as the server reads it: its card model, values by card field, the
 * chosen platforms, the one address and the earlier values kept for the owner ({@code legacy}).
 * The editor stores more (AI evidence, resolved legacy values); the stored card keeps them, the
 * server does not read them.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Card(
    Integer modelVersion,
    String cardVersion,
    Map<String, Value> values,
    List<String> platforms,
    Address address,
    List<Legacy> legacy) {
  public Card {
    cardVersion = cardVersion == null ? "" : cardVersion;
    Map<String, Value> present = new LinkedHashMap<>();
    // A field set to null has no value, as an absent one.
    if (values != null) values.forEach((k, v) -> {
      if (v != null && v != Value.Null.NULL) present.put(k, v);
    });
    values = Collections.unmodifiableMap(present);
    platforms = platforms == null ? List.of() : List.copyOf(platforms);
    address = address == null ? Address.NONE : address;
    legacy = legacy == null ? List.of() : List.copyOf(legacy);
  }

  /** A card saved before the current card model; it has to be migrated before use. */
  public boolean outdated() {
    return modelVersion == null || modelVersion < ReferenceContract.CARD_MODEL_VERSION;
  }

  public Value value(String field) {
    return values.get(field);
  }

  /** An earlier value the one-time migration kept for the owner to resolve. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Legacy(String platform, String field) {
    public Legacy {
      platform = platform == null ? "" : platform;
      field = field == null ? "" : field;
    }
  }
}
