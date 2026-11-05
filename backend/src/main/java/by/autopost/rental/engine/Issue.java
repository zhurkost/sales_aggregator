package by.autopost.rental.engine;

/**
 * A remark of the check on one platform.
 *
 * @param field the native field, empty for a remark about the whole card
 * @param source the card field or section to correct: a card field id, {@code address}, {@code
 *     photos}, {@code legacy} or a group of the editor; empty if none
 */
public record Issue(String field, String source, String code, String message) {
  public Issue withSource(String source) {
    return new Issue(field, source, code, message);
  }

  public Issue withMessage(String message) {
    return new Issue(field, source, code, message);
  }
}
