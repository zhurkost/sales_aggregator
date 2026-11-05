package by.autopost;

import static by.autopost.shared.Json.MAPPER;

import by.autopost.rental.application.CardDocument;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.model.Card;
import by.autopost.shared.Json;
import com.fasterxml.jackson.databind.JsonNode;

/** Cards as the editor sends them and answers as the client reads them: JSON. */
final class RentalJson {
  private RentalJson() {}

  static Card card(JsonNode draft) {
    return Json.typed(draft, Card.class);
  }

  static CardDocument document(JsonNode draft) {
    return new CardDocument(draft.toString(), card(draft));
  }

  /** The answer as the client receives it, raw card documents included. */
  static JsonNode tree(Object answer) {
    try {
      return Json.TYPED.readTree(MAPPER.writeValueAsString(answer));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static JsonNode prepare(RentalCatalog catalog, JsonNode draft, int photos) {
    return tree(catalog.prepare(card(draft), photos));
  }

  static JsonNode browser(RentalCatalog catalog, JsonNode draft, int photos) {
    return tree(catalog.browser(card(draft), photos));
  }

  static JsonNode editor(RentalCatalog catalog) {
    return tree(catalog.editor());
  }
}
