package by.autopost.rental.application;

import static by.autopost.shared.Json.parse;

import by.autopost.rental.card.CardMigration;
import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/**
 * One-time conversion of stored cards older than the current card model, for the command
 * --migrate-rental-drafts; cards of the current model only move from {@code schemaVersion} to
 * {@code cardVersion} and lose {@code localPhotoIds}. Each card is written with the expected
 * revision, so a save made at the same moment is never overwritten; current cards are not touched.
 */
public final class RentalDraftMigration {
  /**
   * What one run did. {@code legacyValues} counts the ambiguous old values kept in {@code legacy}
   * for the owner to resolve in the editor; the lists hold card IDs only.
   */
  public record Report(
      int drafts,
      int migrated,
      int withLegacy,
      int legacyValues,
      List<String> unreadable,
      List<String> conflicts) {}

  private enum Outcome {
    CURRENT,
    MIGRATED,
    UNREADABLE,
    CONFLICT
  }

  private record Result(Outcome outcome, int legacy) {}

  private static final int ATTEMPTS = 3;
  private final RentalDraftRepository drafts;
  private final CardMigration migration;

  public RentalDraftMigration(RentalDraftRepository drafts, ReferenceSnapshot catalog) {
    this.drafts = drafts;
    this.migration = new CardMigration(catalog);
  }

  public Report run() {
    int total = 0, migrated = 0, withLegacy = 0, legacyValues = 0;
    List<String> unreadable = new ArrayList<>(), conflicts = new ArrayList<>();
    for (String workspace : drafts.workspaces())
      for (var listed : drafts.list(workspace)) {
        total++;
        var result = migrate(workspace, listed.id());
        switch (result.outcome()) {
          case MIGRATED -> {
            migrated++;
            if (result.legacy() > 0) withLegacy++;
            legacyValues += result.legacy();
          }
          case UNREADABLE -> unreadable.add(listed.id());
          case CONFLICT -> conflicts.add(listed.id());
          case CURRENT -> {}
        }
      }
    return new Report(
        total, migrated, withLegacy, legacyValues, List.copyOf(unreadable), List.copyOf(conflicts));
  }

  private Result migrate(String workspace, String id) {
    for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
      var row = drafts.find(workspace, id).orElse(null);
      if (row == null) return new Result(Outcome.CURRENT, 0);
      JsonNode data;
      try {
        data = parse(row.data());
      } catch (ApiException e) {
        return new Result(Outcome.UNREADABLE, 0);
      }
      if (!data.isObject()) return new Result(Outcome.UNREADABLE, 0);
      if (!CardMigration.migrationNeeded(data)) return new Result(Outcome.CURRENT, 0);
      boolean outdated = CardMigration.outdated(data);
      var next = outdated ? migration.normalize(data) : migration.tidy(data);
      // The list order follows the owner's saves, so the migration keeps the saved time.
      var stored =
          RentalDraftRepository.StoredDraft.of(id, row.revision() + 1, next, row.updated());
      // Only a model conversion leaves new ambiguous values in legacy.
      if (drafts.update(workspace, stored, row.revision()))
        return new Result(Outcome.MIGRATED, outdated ? next.path("legacy").size() : 0);
    }
    return new Result(Outcome.CONFLICT, 0);
  }
}
