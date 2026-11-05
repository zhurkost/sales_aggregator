package by.autopost.rental.application;

import java.util.List;
import java.util.Optional;

/** Persistence port. Every operation except {@link #workspaces()} is scoped to a workspace. */
public interface RentalDraftRepository {
  /** A saved card; title and address label are copied from it for the list. */
  record StoredDraft(
      String id, int revision, String data, String title, String addressLabel, String updated) {
    public static StoredDraft of(String id, int revision, CardDocument draft, String updated) {
      return new StoredDraft(
          id, revision, draft.json(), draft.title(), draft.addressLabel(), updated);
    }
  }

  /** One row of «Мои квартиры»; the card body is not read. */
  record ListedDraft(String id, int revision, String title, String addressLabel, String updated) {}

  /** Workspaces that have cards. Only the one-time card migration walks all of them. */
  List<String> workspaces();

  List<ListedDraft> list(String workspace);

  Optional<StoredDraft> find(String workspace, String id);

  long count(String workspace);

  boolean insert(String workspace, StoredDraft draft);

  boolean update(String workspace, StoredDraft draft, int expectedRevision);

  /**
   * A change stored next to the card (its photos) is a new revision of the card: the revision goes
   * up by one if it is still {@code expectedRevision}; the card data stays as it is.
   */
  boolean touch(String workspace, String id, int expectedRevision, String updated);

  boolean delete(String workspace, String id, int expectedRevision);
}
