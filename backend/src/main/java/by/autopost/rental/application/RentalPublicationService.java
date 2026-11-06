package by.autopost.rental.application;

import static by.autopost.shared.Json.*;
import by.autopost.shared.ApiException;
import by.autopost.shared.Json;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Prepares the current form without database persistence. */
public final class RentalPublicationService {
  private final RentalCatalog catalog;
  public RentalPublicationService(RentalCatalog catalog) { this.catalog = catalog; }
  public ObjectNode configuration(JsonNode input) {
    if (!input.isObject() || input.toString().length() > 250000 ||
        !Json.id(text(input, "id")) || !input.path("card").isObject() ||
        !input.path("revision").isIntegralNumber() || !input.path("revision").canConvertToInt() ||
        input.path("revision").asInt() < 1)
      throw new ApiException(400, "Некорректные данные формы.");
    var result = catalog.browser(input.path("card"));
    result.put("id", text(input, "id"));
    result.set("revision", input.path("revision"));
    return result;
  }
}
