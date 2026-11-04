package by.autopost.rental.application;

import by.autopost.rental.application.RentalPhotoRepository.PhotoFile;
import by.autopost.rental.application.RentalPhotoRepository.PhotoInfo;
import by.autopost.shared.ApiException;
import java.time.Instant;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Photos of a card, stored on the server with the same limits as the photos of ordinary ads: up to
 * 12, JPG, PNG or WebP, each a data URL of at most 350 000 characters (the editor compresses to
 * 1600 px). Every change is a new revision of the card, so a launch of a revision always has the
 * photos it was launched with.
 */
@Service
public class RentalPhotoService {
  public static final int LIMIT = 12;
  static final int DATA_URL_CHARACTERS = 350_000;
  private static final Pattern DATA_URL =
      Pattern.compile("data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})");

  /** A photo the editor uploads: its file name and the compressed image as a data URL. */
  public record NewPhoto(String name, String dataUrl) {}

  /** The photos of the card after a change, and the card revision the change produced. */
  public record Photos(int revision, List<PhotoInfo> photos) {}

  /** A photo for the extension, which puts it into the form's file input. */
  public record ExtensionPhoto(String id, String name, String dataUrl) {}

  private final RentalDraftRepository drafts;
  private final RentalPhotoRepository photos;

  public RentalPhotoService(RentalDraftRepository drafts, RentalPhotoRepository photos) {
    this.drafts = drafts;
    this.photos = photos;
  }

  public List<PhotoInfo> list(String workspace, String draft) {
    return photos.list(workspace, draft);
  }

  public int count(String workspace, String draft) {
    return photos.count(workspace, draft);
  }

  public PhotoFile file(String workspace, String draft, String id) {
    return photos
        .file(workspace, draft, id)
        .orElseThrow(() -> new ApiException(404, "Фотография не найдена."));
  }

  public List<ExtensionPhoto> forExtension(String workspace, String draft) {
    return photos.files(workspace, draft).stream()
        .map(
            p ->
                new ExtensionPhoto(
                    p.id(),
                    p.name(),
                    "data:" + p.type() + ";base64," + Base64.getEncoder().encodeToString(p.data())))
        .toList();
  }

  @Transactional
  public Photos add(String workspace, String draft, Integer revision, List<NewPhoto> added) {
    if (added == null || added.isEmpty())
      throw new ApiException(400, "Выберите фотографии.");
    var files = added.stream().map(RentalPhotoService::decode).toList();
    if (photos.count(workspace, draft) + files.size() > LIMIT)
      throw new ApiException(400, "У квартиры может быть до " + LIMIT + " фотографий.");
    int next = revise(workspace, draft, revision);
    photos.append(workspace, draft, files, Instant.now().toString());
    return new Photos(next, photos.list(workspace, draft));
  }

  @Transactional
  public Photos remove(String workspace, String draft, Integer revision, String id) {
    if (id == null || photos.file(workspace, draft, id).isEmpty())
      throw new ApiException(404, "Фотография не найдена.");
    int next = revise(workspace, draft, revision);
    photos.remove(workspace, draft, id);
    return new Photos(next, photos.list(workspace, draft));
  }

  @Transactional
  public Photos reorder(String workspace, String draft, Integer revision, List<String> order) {
    var current = photos.list(workspace, draft).stream().map(PhotoInfo::id).toList();
    if (order == null
        || order.size() != current.size()
        || !new HashSet<>(order).equals(new HashSet<>(current)))
      throw new ApiException(400, "Порядок должен перечислять все фотографии квартиры.");
    int next = revise(workspace, draft, revision);
    photos.order(workspace, draft, order);
    return new Photos(next, photos.list(workspace, draft));
  }

  /** Raises the card revision if it is still the one the editor saw. */
  private int revise(String workspace, String draft, Integer revision) {
    if (revision == null || revision < 1)
      throw new ApiException(400, "Некорректная версия карточки.");
    if (!drafts.touch(workspace, draft, revision, Instant.now().toString())) {
      if (drafts.find(workspace, draft).isEmpty())
        throw new ApiException(404, "Карточка аренды не найдена.");
      throw new ApiException(
          409, "Карточка изменена в другой вкладке. Сохраните свои правки перед обновлением.");
    }
    return revision + 1;
  }

  static PhotoFile decode(NewPhoto photo) {
    String dataUrl = photo == null ? null : photo.dataUrl();
    var match =
        dataUrl == null || dataUrl.length() > DATA_URL_CHARACTERS
            ? null
            : DATA_URL.matcher(dataUrl);
    if (match == null || !match.matches())
      throw new ApiException(400, "Фото: JPG, PNG или WebP, сжатые редактором до 1600 px.");
    byte[] data;
    try {
      data = Base64.getDecoder().decode(match.group(2));
    } catch (IllegalArgumentException e) {
      throw new ApiException(400, "Фото: JPG, PNG или WebP, сжатые редактором до 1600 px.");
    }
    // The bytes are served back as an image: they must be the image the data URL claims.
    if (!signature(match.group(1), data))
      throw new ApiException(400, "Файл не является фотографией JPG, PNG или WebP.");
    String name =
        photo.name() == null ? "" : photo.name().replaceAll("[\\p{Cntrl}/\\\\]", "").strip();
    if (name.length() > 160) name = name.substring(0, 160);
    return new PhotoFile(
        UUID.randomUUID().toString(), name.isEmpty() ? "photo.jpg" : name, match.group(1), data);
  }

  private static boolean signature(String type, byte[] data) {
    return switch (type) {
      case "image/jpeg" -> starts(data, 0, 0xFF, 0xD8, 0xFF);
      case "image/png" -> starts(data, 0, 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A);
      default -> starts(data, 0, 'R', 'I', 'F', 'F') && starts(data, 8, 'W', 'E', 'B', 'P');
    };
  }

  private static boolean starts(byte[] data, int offset, int... expected) {
    if (data.length < offset + expected.length) return false;
    for (int i = 0; i < expected.length; i++)
      if (data[offset + i] != (byte) expected[i]) return false;
    return true;
  }
}
