package by.autopost.rental.address;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.Map;

/** One DaData suggestion, read once from the provider response. */
public record DadataSuggestion(
    String value,
    String unrestrictedValue,
    String countryIso,
    String fiasId,
    String region,
    String district,
    String city,
    String cityWithType,
    String settlement,
    String settlementWithType,
    String street,
    String streetWithType,
    String house,
    String block,
    String blockType,
    String precision,
    String latitude,
    String longitude) {

  public static DadataSuggestion parse(JsonNode item) {
    JsonNode d = item.path("data");
    return new DadataSuggestion(
        text(item, "value"),
        text(item, "unrestricted_value"),
        text(d, "country_iso_code"),
        text(d, "fias_id"),
        text(d, "region_with_type"),
        text(d, "area_with_type"),
        text(d, "city"),
        text(d, "city_with_type"),
        text(d, "settlement"),
        text(d, "settlement_with_type"),
        text(d, "street"),
        text(d, "street_with_type"),
        text(d, "house"),
        text(d, "block"),
        text(d, "block_type"),
        text(d, "qc_geo"),
        text(d, "geo_lat"),
        text(d, "geo_lon"));
  }

  boolean belarus() {
    return countryIso.equals("BY");
  }

  /** The full provider label is the most precise query for a repeated lookup. */
  String confirmationQuery() {
    return unrestrictedValue.isEmpty() ? value : unrestrictedValue;
  }

  /** Raw components a confirmation must not change. */
  Map<String, String> parts() {
    Map<String, String> parts = new LinkedHashMap<>();
    parts.put("city", city);
    parts.put("settlement", settlement);
    parts.put("street", street);
    parts.put("house", house);
    parts.put("block", block);
    return parts;
  }

  /** The address shape stored in a rental card; an OSM ID is never a marketplace ID. */
  public ObjectNode address() {
    String place = settlementWithType;
    if (place.isEmpty()) place = cityWithType;
    if (place.isEmpty()) place = city;
    ObjectNode a =
        object(
            "provider",
            "dadata",
            "sourceId",
            fiasId,
            "label",
            value,
            "countryIso",
            "BY",
            "region",
            region,
            "district",
            district,
            "settlement",
            place,
            "street",
            streetWithType,
            "house",
            house,
            "block",
            block,
            "blockType",
            blockType,
            "precision",
            precision,
            "confirmed",
            false,
            "level",
            house.isEmpty() ? (street.isEmpty() ? "settlement" : "street") : "house");
    // Foreign Belarus addresses legitimately have fias_level=-1. Assess actual parts, not Russian
    // levels.
    if (latitude.matches("-?\\d+(?:\\.\\d+)?")) a.put("latitude", latitude);
    if (longitude.matches("-?\\d+(?:\\.\\d+)?")) a.put("longitude", longitude);
    return a;
  }
}
