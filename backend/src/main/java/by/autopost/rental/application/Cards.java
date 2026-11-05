package by.autopost.rental.application;

import by.autopost.rental.model.Card;
import by.autopost.shared.ApiException;

/** Rules every use of a stored card follows. */
final class Cards {
  private Cards() {}

  /** Reading, checking and publishing accept only cards of the current model. */
  static void requireCurrent(Card card) {
    if (card.outdated()) throw new ApiException(409, "Карточку нужно перенести командой миграции.");
  }
}
