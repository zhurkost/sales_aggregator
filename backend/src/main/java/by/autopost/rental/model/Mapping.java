package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The preparation plan of one platform ({@code runtime/preparation_<id>.json}): how card values
 * become the values of its native fields, the native fields it fixes, the address parts and
 * coordinates, cross-field checks and the remarks it always makes.
 */
public record Mapping(
    @JsonProperty("runtime_version") String runtimeVersion,
    @JsonProperty("category_id") String categoryId,
    String platform,
    List<MappingRule> fields,
    Map<String, Value> constants,
    List<AddressRule> addresses,
    List<CoordinateRule> coordinates,
    List<CrossCheck> checks,
    List<ReviewNote> review,
    @JsonProperty("address_bound_fields") List<String> addressBoundFields,
    @JsonProperty("deferred_fields") Map<String, String> deferredFields) {
  public Mapping {
    runtimeVersion = runtimeVersion == null ? "" : runtimeVersion;
    platform = platform == null ? "" : platform;
    fields = copy(fields);
    constants = values(constants);
    addresses = copy(addresses);
    coordinates = copy(coordinates);
    checks = copy(checks);
    review = copy(review);
    addressBoundFields = copy(addressBoundFields);
    deferredFields = ordered(deferredFields);
  }

  private static <T> List<T> copy(List<T> list) {
    return list == null ? List.of() : List.copyOf(list);
  }

  /** A JSON null constant is the explicit null code. */
  private static Map<String, Value> values(Map<String, Value> map) {
    if (map == null) return Map.of();
    Map<String, Value> result = new LinkedHashMap<>();
    map.forEach((k, v) -> result.put(k, v == null ? Value.Null.NULL : v));
    return Collections.unmodifiableMap(result);
  }

  private static <T> Map<String, T> ordered(Map<String, T> map) {
    return map == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(map));
  }

  /** A native address field filled from one part of the confirmed address. */
  public record AddressRule(
      @JsonProperty("platform_option_id") String platformOptionId,
      String part,
      @JsonProperty("scalar_verified") Boolean scalarVerified) {
    public AddressRule {
      platformOptionId = platformOptionId == null ? "" : platformOptionId;
      part = part == null ? "" : part;
    }

    public boolean verified() {
      return Boolean.TRUE.equals(scalarVerified);
    }
  }

  /** A native field of the house point: {@code latitude}, {@code longitude} or {@code pair}. */
  public record CoordinateRule(
      @JsonProperty("platform_option_id") String platformOptionId, String axis) {
    public CoordinateRule {
      platformOptionId = platformOptionId == null ? "" : platformOptionId;
      axis = axis == null ? "" : axis;
    }
  }

  /** {@code left} may not be greater than {@code right}. */
  public record CrossCheck(String left, String right, String message) {
    public CrossCheck {
      left = left == null ? "" : left;
      right = right == null ? "" : right;
      message = message == null ? "" : message;
    }
  }

  /** A remark the plan makes about a filled field, or always without a field. */
  public record ReviewNote(String field, String message) {
    public ReviewNote {
      field = field == null ? "" : field;
      message = message == null ? "" : message;
    }
  }
}
