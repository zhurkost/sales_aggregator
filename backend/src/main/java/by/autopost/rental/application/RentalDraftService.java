package by.autopost.rental.application;

import by.autopost.rental.model.Card;
import by.autopost.shared.ApiException;
import by.autopost.shared.Json;
import com.fasterxml.jackson.annotation.JsonRawValue;
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

  /** One row of «Мои квартиры». */
  public record Listed(
      String id,
      int revision,
      String title,
      String address,
      String updatedAt,
      List<PlatformPublication> publications) {}

  public record Drafts(List<Listed> drafts) {}

  /** A card as the editor opens it: the stored document as written, and its photos. */
  public record Opened(
      String id, int revision, @JsonRawValue String draft, List<RentalPhotoRepository.PhotoInfo> photos) {}

  /** A stored card and its revision. */
  public record Stored(String id, int revision, Card card) {}

  public record Saved(String id, int revision) {}

  public record Deleted(boolean deleted, String id) {}

  public Drafts list(String workspace) {
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
    List<Listed> items = new ArrayList<>();
    for (var row : drafts.list(workspace))
      items.add(
          new Listed(
              row.id(),
              row.revision(),
              row.title(),
              row.addressLabel(),
              row.updated(),
              published.getOrDefault(row.id(), List.of())));
    return new Drafts(items);
  }

  public Opened get(String workspace, String id) {
    var row = find(workspace, id);
    // The stored card is returned as saved; an older card model waits for the migration.
    Cards.requireCurrent(card(row.data()));
    return new Opened(id, row.revision(), row.data(), photos.list(workspace, id));
  }

  /** The stored card the server reads: for a launch, which uses only what was saved. */
  public Stored stored(String workspace, String id) {
    var row = find(workspace, id);
    return new Stored(id, row.revision(), card(row.data()));
  }

  private RentalDraftRepository.StoredDraft find(String workspace, String id) {
    return drafts
        .find(workspace, id)
        .orElseThrow(() -> new ApiException(404, "Карточка аренды не найдена."));
  }

  private static Card card(String data) {
    try {
      return Json.typed(data, Card.class);
    } catch (IllegalArgumentException e) {
      throw new ApiException(400, "Некорректная карточка.");
    }
  }

  /** The current revision of a card, without reading it. */
  public int revision(String workspace, String id) {
    return find(workspace, id).revision();
  }

  /** @param revision the revision the editor saw, 0 for a new card */
  @Transactional
  public Saved save(String workspace, String id, int revision, CardDocument draft) {
    if (!Json.id(id) || revision < 0 || revision == Integer.MAX_VALUE)
      throw new ApiException(400, "Некорректная карточка.");
    if (revision == 0 && drafts.count(workspace) >= 500)
      throw new ApiException(400, "Достигнут лимит карточек аренды.");
    var next =
        RentalDraftRepository.StoredDraft.of(id, revision + 1, draft, Instant.now().toString());
    boolean saved =
        revision == 0 ? drafts.insert(workspace, next) : drafts.update(workspace, next, revision);
    if (!saved)
      throw new ApiException(
          409, "Карточка изменена в другой вкладке. Сохраните свои правки перед обновлением.");
    return new Saved(id, revision + 1);
  }

  @Transactional
  public Deleted delete(String workspace, String id, int revision) {
    if (!Json.id(id) || revision < 1) throw new ApiException(400, "Некорректная версия карточки.");
    if (!drafts.delete(workspace, id, revision)) {
      if (drafts.find(workspace, id).isEmpty())
        throw new ApiException(404, "Карточка аренды не найдена.");
      throw new ApiException(
          409,
          "Квартира изменена в другой вкладке. Откройте её заново и проверьте перед удалением.");
    }
    // What is stored with the card goes with it.
    photos.removeAll(workspace, id);
    publications.removeAll(workspace, id);
    return new Deleted(true, id);
  }
}
