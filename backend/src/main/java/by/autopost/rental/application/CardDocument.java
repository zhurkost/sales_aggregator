package by.autopost.rental.application;

import by.autopost.rental.model.Card;
import by.autopost.rental.model.CardFields;
import by.autopost.rental.model.Value;

/**
 * A card as the editor stores it: the JSON document, kept as written (it carries the editor's own
 * facts too), and the typed card the server reads from it.
 */
public record CardDocument(String json, Card card) {
  /** The title «Мои квартиры» shows: only text is a title. */
  public String title() {
    return card.value(CardFields.TITLE) instanceof Value.Text text ? text.value() : "";
  }

  public String addressLabel() {
    return card.address().label();
  }
}
