package by.autopost.rental.engine;

import java.util.List;

/**
 * What one prepared card sends to a platform's form and what its user enters there by hand, as
 * the check shows them: the name of each native field and its value as text (option names, the
 * description as typed, the address part).
 */
public record CardTransfer(List<FormValue> form, List<ManualValue> manual) {
  public CardTransfer {
    form = List.copyOf(form);
    manual = List.copyOf(manual);
  }

  /** A value a recipe control fills. */
  public record FormValue(String field, String name, String text) {}

  /** A prepared value the form does not receive; the plan says why. */
  public record ManualValue(String field, String name, String text, String reason) {}
}
