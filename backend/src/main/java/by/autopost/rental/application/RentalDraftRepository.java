package by.autopost.rental.application;

import java.util.List;
import java.util.Optional;

/** Persistence port. Every operation is scoped to an authenticated workspace. */
public interface RentalDraftRepository {
  record StoredDraft(String id, int revision, String data, String updated) {}

  List<StoredDraft> list(String workspace);

  Optional<StoredDraft> find(String workspace, String id);

  long count(String workspace);

  boolean insert(String workspace, StoredDraft draft);

  boolean update(String workspace, StoredDraft draft, int expectedRevision);

  boolean delete(String workspace, String id, int expectedRevision);
}
