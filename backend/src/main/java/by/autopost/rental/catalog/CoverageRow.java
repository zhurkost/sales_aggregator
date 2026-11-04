package by.autopost.rental.catalog;

import java.util.List;

/**
 * One field of a platform plan: card fields → native field → form element → how it reaches the
 * form.
 *
 * @param sources card fields the value is prepared from; {@code address.<part>} for the address;
 *     empty for constants and deferred fields
 * @param element the recipe control that fills the field, empty without one
 * @param addressPart the address part the control takes its value from, empty for card values
 * @param reason why the user enters the field by hand or why it is deferred; the value of a
 *     constant; empty otherwise
 */
public record CoverageRow(
    List<String> sources,
    String field,
    String name,
    String element,
    String addressPart,
    Transfer transfer,
    String reason) {
  public CoverageRow {
    sources = List.copyOf(sources);
  }

  /** The recipe fills this field: transferred, or a constant with a control of its own. */
  public boolean inForm() {
    return !element.isEmpty();
  }
}
