package by.autopost.rental.application;

import java.util.List;
import java.util.Optional;

/** Persistence port. Every operation is scoped to an authenticated workspace. */
public interface RentalDraftRepository {
  /** A saved card; title and address label are copied from it for the list. */
  record StoredDraft(
      String id, int revision, String data, String title, String addressLabel, String updated) {}

  /** One row of «Мои квартиры»; the card body is not read. */
  record ListedDraft(String id, int revision, String title, String addressLabel, String updated) {}

  List<ListedDraft> list(String workspace);

  Optional<StoredDraft> find(String workspace, String id);

  long count(String workspace);

  boolean insert(String workspace, StoredDraft draft);

  boolean update(String workspace, StoredDraft draft, int expectedRevision);

  boolean delete(String workspace, String id, int expectedRevision);
}
