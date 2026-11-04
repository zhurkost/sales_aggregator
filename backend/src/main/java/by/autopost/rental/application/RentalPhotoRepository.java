package by.autopost.rental.application;

import java.util.List;
import java.util.Optional;

/** Photos stored with a card, in their order. Every operation is scoped to a workspace. */
public interface RentalPhotoRepository {
  /** A photo of a card as the editor lists it, without its bytes. */
  record PhotoInfo(String id, String name, String type, int size) {}

  /** A photo with its bytes; {@code type} is its MIME type. */
  record PhotoFile(String id, String name, String type, byte[] data) {
    public PhotoInfo info() {
      return new PhotoInfo(id, name, type, data.length);
    }
  }

  List<PhotoInfo> list(String workspace, String draft);

  /** The photos with their bytes, in order: what the extension uploads to a form. */
  List<PhotoFile> files(String workspace, String draft);

  Optional<PhotoFile> file(String workspace, String draft, String id);

  int count(String workspace, String draft);

  /** Appends the photos after the existing ones, in the given order. */
  void append(String workspace, String draft, List<PhotoFile> photos, String created);

  boolean remove(String workspace, String draft, String id);

  /** {@code ids} is the new order of all photos of the card. */
  void order(String workspace, String draft, List<String> ids);

  void removeAll(String workspace, String draft);
}
