package by.autopost.rental.application;

import static by.autopost.shared.Json.*;

import by.autopost.rental.card.CardMigration;
import by.autopost.shared.ApiException;
import by.autopost.shared.Json;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RentalDraftService {
  private final RentalDraftRepository drafts;
  private final RentalPhotoRepository photos;
  private final RentalPublicationRepository publications;

  public RentalDraftService(
      RentalDraftRepository drafts,
      RentalPhotoRepository photos,
      RentalPublicationRepository publications) {
    this.drafts = drafts;
    this.photos = photos;
    this.publications = publications;
  }

  /** Where a card stands on one platform, as «Мои квартиры» shows it. */
  public record PlatformPublication(
      String id,
      String platform,
      PublicationStatus status,
      String message,
      String url,
      String updated) {}

  public ObjectNode list(String workspace) {
    Map<String, List<PlatformPublication>> published = new HashMap<>();
    for (var last : publications.latest(workspace))
      published
          .computeIfAbsent(last.draftId(), id -> new ArrayList<>())
          .add(
              new PlatformPublication(
                  last.id(),
                  last.platform(),
                  last.status(),
                  last.message(),
                  last.url(),
                  last.updated()));
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
              row.updated(),
              "publications",
              published.getOrDefault(row.id(), List.of())));
    return object("drafts", items);
  }

  public ObjectNode get(String workspace, String id) {
    var row =
        drafts
            .find(workspace, id)
            .orElseThrow(() -> new ApiException(404, "Карточка аренды не найдена."));
    // The stored card is returned as saved; an older card model waits for the migration.
    JsonNode draft = parse(row.data());
    if (!draft.isObject()) throw new ApiException(400, "Некорректная карточка.");
    CardMigration.requireCurrent(draft);
    return object(
        "id", id, "revision", row.revision(), "draft", draft, "photos", photos.list(workspace, id));
  }

  /** The current revision of a card, without reading it. */
  public int revision(String workspace, String id) {
    return drafts
        .find(workspace, id)
        .orElseThrow(() -> new ApiException(404, "Карточка аренды не найдена."))
        .revision();
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
    int revision = version.asInt();
    if (revision == 0 && drafts.count(workspace) >= 500)
      throw new ApiException(400, "Достигнут лимит карточек аренды.");
    var next =
        RentalDraftRepository.StoredDraft.of(id, revision + 1, draft, Instant.now().toString());
    boolean saved =
        revision == 0 ? drafts.insert(workspace, next) : drafts.update(workspace, next, revision);
    if (!saved)
      throw new ApiException(
          409, "Карточка изменена в другой вкладке. Сохраните свои правки перед обновлением.");
    return object("id", id, "revision", revision + 1);
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
    // What is stored with the card goes with it.
    photos.removeAll(workspace, id);
    publications.removeAll(workspace, id);
    return object("deleted", true, "id", id);
  }
}
