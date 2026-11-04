package by.autopost.rental.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * What one prepared card sends to a platform's form and what its user enters there by hand. The
 * values are the prepared native values (or address parts), as the response shows them.
 */
public record CardTransfer(List<FormValue> form, List<ManualValue> manual) {
  public CardTransfer {
    form = List.copyOf(form);
    manual = List.copyOf(manual);
  }

  /** A value a recipe control fills. */
  public record FormValue(String field, String name, JsonNode value) {}

  /** A prepared value the form does not receive; the plan says why. */
  public record ManualValue(String field, String name, JsonNode value, String reason) {}
}
