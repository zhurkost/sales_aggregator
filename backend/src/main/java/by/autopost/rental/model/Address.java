package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * The one address of a card: the label and parts the user confirmed (or typed by hand) and, for a
 * confirmed house, its point. The server reads only these keys; the rest stays in the stored card.
 *
 * @param precision {@code "0"} for the point of the house itself
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Address(
    String label,
    String region,
    String district,
    String settlement,
    String street,
    String house,
    String block,
    String latitude,
    String longitude,
    String precision,
    Boolean confirmed) {
  public static final Address NONE =
      new Address(null, null, null, null, null, null, null, null, null, null, null);

  public Address {
    label = text(label);
    region = text(region);
    district = text(district);
    settlement = text(settlement);
    street = text(street);
    house = text(house);
    block = text(block);
    latitude = text(latitude);
    longitude = text(longitude);
    precision = text(precision);
  }

  private static String text(String value) {
    return value == null ? "" : value;
  }

  public boolean isConfirmed() {
    return Boolean.TRUE.equals(confirmed);
  }

  /** The confirmed point of the house itself. */
  public boolean exactPoint() {
    return isConfirmed() && precision.equals("0");
  }

  /** One part by its name, as the card model and the recipes name the parts; empty if unknown. */
  public String part(String name) {
    return switch (name) {
      case "label" -> label;
      case "region" -> region;
      case "district" -> district;
      case "settlement" -> settlement;
      case "street" -> street;
      case "house" -> house;
      case "block" -> block;
      case "latitude" -> latitude;
      case "longitude" -> longitude;
      default -> "";
    };
  }
}
