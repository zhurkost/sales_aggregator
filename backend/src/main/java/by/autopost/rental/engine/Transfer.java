package by.autopost.rental.engine;

import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;

/** How one field of a platform plan reaches the platform's form. */
public enum Transfer {
  /** A control of the form recipe fills it. */
  TRANSFERRED,
  /** Prepared from the card, but entered on the platform by hand; the plan says why. */
  MANUAL,
  /** Not prepared from the card: the platform derives it itself or it depends on the account. */
  DEFERRED,
  /** Fixed by the plan for this category. */
  CONSTANT,
  /** Prepared from the card with neither a form element nor a reason: the bundle is rejected. */
  PREPARED_ONLY;

  @JsonValue
  public String code() {
    return name().toLowerCase(Locale.ROOT);
  }
}
