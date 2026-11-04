package by.autopost.rental.application;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

/** The extension receives only the saved snapshot in the authenticated workspace. */
@Service
public final class RentalPublicationService {
  private final RentalDraftService drafts;
  private final RentalCatalog catalog;

  public RentalPublicationService(RentalDraftService drafts, RentalCatalog catalog) {
    this.drafts = drafts;
    this.catalog = catalog;
  }

  public ObjectNode configuration(String workspace, JsonNode input) {
    if (!input.isObject()) throw new ApiException(400, "Некорректная карточка.");
    String id = clean(input, "id", 100);
    if (!input.path("draft").isObject()) throw new ApiException(400, "Некорректная карточка.");
    var saved = drafts.get(workspace, id);
    if (!saved.path("draft").equals(input.path("draft")))
      throw new ApiException(
          409, "Карточка изменилась. Дождитесь сохранения и повторите публикацию.");
    var result = catalog.browser(saved.path("draft"));
    result.put("id", id);
    result.set("revision", saved.path("revision"));
    return result;
  }
}
