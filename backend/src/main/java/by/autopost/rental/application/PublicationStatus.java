package by.autopost.rental.application;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;
import java.util.Optional;

/**
 * Where the publication of one launch on one platform stands, as the extension reports it. The
 * server alone decides which change is allowed.
 */
public enum PublicationStatus {
  /** The extension opened the form and fills it. */
  OPENED,
  /** The extension filled what it could; the user finishes on the platform. */
  FILLED,
  /** The extension pressed the final button once. Whether the ad is published is not known. */
  SUBMITTED,
  /** The user has to act on the platform: sign in, CAPTCHA, payment, a step not recognised. */
  NEEDS_ACTION,
  /** Stopped in Autopost, or the browser did not accept the launch. */
  STOPPED;

  @JsonValue
  public String code() {
    return name().toLowerCase(Locale.ROOT);
  }

  public static PublicationStatus of(String code) {
    for (var status : values()) if (status.code().equals(code)) return status;
    throw new ApiException(400, "Неизвестный статус публикации.");
  }

  /**
   * Why this status cannot become {@code next}, or empty when it can. A submission happens once
   * and is never undone; a stopped launch only opens again (the extension resumes it).
   */
  public Optional<String> refusal(PublicationStatus next) {
    if (this == SUBMITTED) return Optional.of("Подача на эту площадку уже выполнена.");
    if (this == STOPPED && next != OPENED && next != STOPPED)
      return Optional.of("Задание остановлено в Автопосте. Передайте карточку заново.");
    return Optional.empty();
  }
}
