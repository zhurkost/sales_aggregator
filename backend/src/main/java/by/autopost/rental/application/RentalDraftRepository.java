package by.autopost.rental.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Optional;

/** Persistence port. Every operation except {@link #workspaces()} is scoped to a workspace. */
public interface RentalDraftRepository {
  /** A saved card; title and address label are copied from it for the list. */
  record StoredDraft(
      String id, int revision, String data, String title, String addressLabel, String updated) {
    public static StoredDraft of(String id, int revision, JsonNode draft, String updated) {
      return new StoredDraft(
          id,
          revision,
          draft.toString(),
          textual(draft.path("values").path("listing.title")),
          textual(draft.path("address").path("label")),
          updated);
    }

    /** The list shows only text; any other JSON value is not a title or an address. */
    private static String textual(JsonNode value) {
      return value.isTextual() ? value.asText() : "";
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

  boolean delete(String workspace, String id, int expectedRevision);
}
