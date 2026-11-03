package by.autopost.rental.application;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import by.autopost.shared.Json;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RentalDraftService {
  private final RentalDraftRepository drafts;
  private final RentalCatalog catalog;

  public RentalDraftService(RentalDraftRepository drafts, RentalCatalog catalog) {
    this.drafts = drafts;
    this.catalog = catalog;
  }

  public ObjectNode list(String workspace) {
    ArrayNode items = array();
    for (var row : drafts.list(workspace))
      items.add(
          object(
              "id",
              row.id(),
              "revision",
              row.revision(),
              "title",
              row.title(),
              "address",
              row.addressLabel(),
              "updatedAt",
              row.updated()));
    return object("drafts", items);
  }

  public ObjectNode get(String workspace, String id) {
    var row =
        drafts
            .find(workspace, id)
            .orElseThrow(() -> new ApiException(404, "Карточка аренды не найдена."));
    return object("id", id, "revision", row.revision(), "draft", readableDraft(parse(row.data())));
  }

  private JsonNode readableDraft(JsonNode data) {
    try {
      return catalog.normalize(data);
    } catch (ApiException e) {
      if (e.status == 503) return data;
      throw e;
    }
  }

  @Transactional
  public ObjectNode save(String workspace, String id, JsonNode input) {
    JsonNode version = input.path("revision"), draft = input.path("draft");
    if (!Json.id(id)
        || !draft.isObject()
        || !version.isIntegralNumber()
        || !version.canConvertToInt()
        || version.asInt() < 0
        || version.asInt() == Integer.MAX_VALUE)
      throw new ApiException(400, "Некорректная карточка.");
    if (draft.toString().length() > 250000)
      throw new ApiException(413, "Карточка слишком большая.");
    int revision = version.asInt();
    if (revision == 0 && drafts.count(workspace) >= 500)
      throw new ApiException(400, "Достигнут лимит карточек аренды.");
    var next =
        new RentalDraftRepository.StoredDraft(
            id,
            revision + 1,
            draft.toString(),
            textual(draft.path("values").path("listing.title")),
            textual(draft.path("address").path("label")),
            Instant.now().toString());
    boolean saved =
        revision == 0 ? drafts.insert(workspace, next) : drafts.update(workspace, next, revision);
    if (!saved)
      throw new ApiException(
          409, "Карточка изменена в другой вкладке. Сохраните свои правки перед обновлением.");
    return object("id", id, "revision", revision + 1);
  }

  /** The list shows only text; any other JSON value is not a title or an address. */
  private static String textual(JsonNode value) {
    return value.isTextual() ? value.asText() : "";
  }

  @Transactional
  public ObjectNode delete(String workspace, String id, JsonNode input) {
    JsonNode version = input.path("revision");
    if (!Json.id(id)
        || !version.isIntegralNumber()
        || !version.canConvertToInt()
        || version.asInt() < 1) throw new ApiException(400, "Некорректная версия карточки.");
    if (!drafts.delete(workspace, id, version.asInt())) {
      if (drafts.find(workspace, id).isEmpty())
        throw new ApiException(404, "Карточка аренды не найдена.");
      throw new ApiException(
          409,
          "Квартира изменена в другой вкладке. Откройте её заново и проверьте перед удалением.");
    }
    return object("deleted", true, "id", id);
  }
}
