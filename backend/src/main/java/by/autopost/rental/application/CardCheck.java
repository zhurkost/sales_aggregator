package by.autopost.rental.application;

import by.autopost.rental.engine.CardTransfer;
import by.autopost.rental.engine.Issue;
import by.autopost.rental.model.Value;
import java.util.List;
import java.util.Map;

/** «Проверка карточки»: what each chosen platform receives and what is still to correct. */
public record CardCheck(List<PlatformCheck> platforms) {
  /**
   * @param values the prepared native values
   * @param checksPassed no remarks: the only case the extension may press the final button
   * @param form what the extension fills, with the address parts and the photos
   * @param manual what the user enters on the platform by hand, with the reason
   */
  public record PlatformCheck(
      String platform,
      Map<String, Value> values,
      List<Issue> issues,
      boolean checksPassed,
      List<CardTransfer.FormValue> form,
      List<CardTransfer.ManualValue> manual) {}
}
