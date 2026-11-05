package by.autopost.rental.model;

import java.util.Map;

/**
 * The card fields and groups the code itself reads; every other field is data only. The editor
 * gets the string constants as {@code frontend/src/app/rental/card-fields.generated.ts} ({@code
 * node scripts/rental-card-fields.mjs}); a test keeps both the same.
 */
public final class CardFields {
  private CardFields() {}

  /** The group the editor shows on the card itself; the others open in «Все параметры». */
  public static final String MAIN_GROUP = "group.main";

  /** Values derived from the address; the editor does not show this group. */
  public static final String ADDRESS_GROUP = "group.address_projection";

  public static final String TITLE = "listing.title";
  public static final String DESCRIPTION = "listing.description";
  public static final String LATITUDE = "location.latitude";
  public static final String LONGITUDE = "location.longitude";
  public static final String FLOOR = "rental.floor";
  public static final String TOTAL_FLOORS = "building.total_floors";
  public static final String CURRENCY = "rental.currency";

  /** Units the editor adds to the label of a numeric card field kept as text. */
  static final Map<String, String> UNITS =
      Map.of(
          "rental.total_area", "м²",
          "rental.living_area", "м²",
          "rental.kitchen_area", "м²");

  /** Roles the editor styles: the monthly price stands out among the main facts. */
  static final Map<String, String> ROLES = Map.of("rental.monthly_price", "price");

  /** The unit of a card field, null without one. */
  public static String unit(String field) {
    return UNITS.get(field);
  }

  /** The role of a card field, null without one. */
  public static String role(String field) {
    return ROLES.get(field);
  }
}
