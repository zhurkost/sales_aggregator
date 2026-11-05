package by.autopost.rental.application;

import java.util.List;

/**
 * The card fields the editor shows for one card and its chosen platforms, in the order of the card
 * groups, computed by the same preparation as the check. A field no platform maps is always shown;
 * a field mapped only to native fields that do not apply with the card's values, or only to
 * platforms that are not chosen, is not.
 */
public record FieldStates(List<FieldState> fields) {
  /**
   * @param required a chosen platform requires the native field it fills, and it applies
   * @param transferred a chosen platform's form receives the value or a field it fills depends on
   *     it; true for a field no platform maps, which is not marked
   * @param choices the options of the card field; empty for a field without options
   */
  public record FieldState(
      String id, boolean required, boolean transferred, List<String> choices) {}
}
