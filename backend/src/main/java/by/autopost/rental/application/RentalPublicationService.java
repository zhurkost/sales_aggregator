package by.autopost.rental.application;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The extension receives only the saved snapshot in the authenticated workspace, with the photos
 * stored with it.
 */
@Service
public class RentalPublicationService {
  private final RentalDraftService drafts;
  private final RentalCatalog catalog;
  private final RentalPhotoService photos;

  public RentalPublicationService(
      RentalDraftService drafts, RentalCatalog catalog, RentalPhotoService photos) {
    this.drafts = drafts;
    this.catalog = catalog;
    this.photos = photos;
  }

  /** The card, its revision and its photos are read in one transaction: one consistent launch. */
  @Transactional
  public ObjectNode configuration(String workspace, JsonNode input) {
    if (!input.isObject()) throw new ApiException(400, "Некорректная карточка.");
    String id = clean(input, "id", 100);
    if (!input.path("draft").isObject()) throw new ApiException(400, "Некорректная карточка.");
    var saved = drafts.get(workspace, id);
    if (!saved.path("draft").equals(input.path("draft")))
      throw new ApiException(
          409, "Карточка изменилась. Дождитесь сохранения и повторите публикацию.");
    var stored = photos.forExtension(workspace, id);
    var result = catalog.browser(saved.path("draft"), stored.size());
    result.put("id", id);
    result.set("revision", saved.path("revision"));
    // The extension puts these into the form's file inputs; the browser keeps no copy of its own.
    result.set("photos", MAPPER.valueToTree(stored));
    return result;
  }
}
