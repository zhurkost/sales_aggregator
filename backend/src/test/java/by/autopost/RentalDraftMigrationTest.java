package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalDraftMigration;
import by.autopost.rental.application.RentalDraftRepository;
import by.autopost.rental.application.RentalDraftRepository.StoredDraft;
import by.autopost.rental.catalog.FileReferenceRepository;
import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.persistence.JdbcRentalDraftRepository;
import by.autopost.rental.persistence.RentalDraftMigrationCommand;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class RentalDraftMigrationTest {
  static final String BUNDLE = "src/test/resources/reference-example";
  @TempDir Path dir;
  final ReferenceSnapshot catalog = new FileReferenceRepository(BUNDLE).snapshot();

  JdbcRentalDraftRepository repository() {
    return new JdbcRentalDraftRepository(
        new JdbcTemplate(
            new DriverManagerDataSource("jdbc:sqlite:" + dir.resolve("workspace.sqlite"))));
  }

  /** A card of model 1: platform extras, no modelVersion. */
  static JsonNode oldCard(JsonNode extras, JsonNode values) {
    return object(
        "schemaVersion",
        "old",
        "values",
        values,
        "extras",
        object("example", extras),
        "platforms",
        List.of("example"));
  }

  static final JsonNode CURRENT =
      object(
          "modelVersion",
          2,
          "cardVersion",
          "stale-but-current-model",
          "values",
          object("listing.title", "Новая"),
          "extras",
          object(),
          "platforms",
          List.of("example"),
          "address",
          object("label", "Минск, Ленина, 10"));

  void store(RentalDraftRepository drafts, String workspace, String id, int revision, String data) {
    assertTrue(
        drafts.insert(
            workspace, new StoredDraft(id, revision, data, "", "", "2026-11-0" + revision)));
  }

  Map<String, StoredDraft> rows(RentalDraftRepository drafts) {
    Map<String, StoredDraft> rows = new TreeMap<>();
    for (String workspace : drafts.workspaces())
      for (var listed : drafts.list(workspace))
        rows.put(workspace + "/" + listed.id(), drafts.find(workspace, listed.id()).orElseThrow());
    return rows;
  }

  @Test
  void oldCardsAreConvertedOnceAndCurrentCardsAreNotTouched() {
    var drafts = repository();
    // Unambiguous old values become card values; an unmapped one is kept in legacy.
    store(
        drafts,
        "ws",
        "old",
        3,
        oldCard(
                object("currency", 2, "rent", "1500", "floor", "3"),
                object("listing.title", "Старая"))
            .toString());
    store(drafts, "other", "old-clean", 1, oldCard(object("currency", "01"), object()).toString());
    store(drafts, "ws", "current", 5, CURRENT.toString());
    store(drafts, "ws", "broken", 1, "not json");
    var before = rows(drafts);

    var report = new RentalDraftMigration(drafts, catalog).run();

    assertEquals(
        new RentalDraftMigration.Report(4, 2, 1, 1, List.of("broken"), List.of()), report);
    var after = rows(drafts);
    var old = parse(after.get("ws/old").data());
    assertEquals(4, after.get("ws/old").revision());
    assertEquals(2, old.path("modelVersion").asInt());
    assertEquals(catalog.cardVersion(), text(old, "cardVersion"));
    assertFalse(old.has("schemaVersion"));
    assertEquals("USD", text(old.path("values"), "rental.currency"));
    assertEquals("1500", text(old.path("values"), "rental.price"));
    assertTrue(old.path("extras").isEmpty());
    assertEquals(1, old.path("legacy").size());
    assertEquals("floor", text(old.path("legacy").get(0), "field"));
    // The list keeps its order and shows the migrated title.
    assertEquals(before.get("ws/old").updated(), after.get("ws/old").updated());
    assertEquals("Старая", after.get("ws/old").title());
    assertEquals(
        "BYN", text(parse(after.get("other/old-clean").data()).path("values"), "rental.currency"));
    assertEquals(before.get("ws/current"), after.get("ws/current"));
    assertEquals(before.get("ws/broken"), after.get("ws/broken"));
  }

  @Test
  void secondRunChangesNothing() {
    var drafts = repository();
    store(drafts, "ws", "old", 1, oldCard(object("floor", "3"), object()).toString());
    store(drafts, "ws", "current", 2, CURRENT.toString());
    assertEquals(1, new RentalDraftMigration(drafts, catalog).run().migrated());
    var first = rows(drafts);
    var again = new RentalDraftMigration(drafts, catalog).run();
    assertEquals(new RentalDraftMigration.Report(2, 0, 0, 0, List.of(), List.of()), again);
    assertEquals(first, rows(drafts));
  }

  @Test
  void aSaveDuringTheMigrationIsNeverOverwritten() {
    var drafts = repository();
    store(drafts, "ws", "old", 1, oldCard(object("floor", "3"), object()).toString());
    // The running release still writes the version under its old name.
    var saved = (ObjectNode) CURRENT.deepCopy();
    saved.remove("cardVersion");
    saved.put("schemaVersion", "saved-by-the-owner");
    ((ObjectNode) saved.path("values")).put("listing.title", "Правка владельца");
    var racing =
        new Delegating(drafts) {
          boolean raced;

          @Override
          public boolean update(String workspace, StoredDraft draft, int revision) {
            if (!raced) {
              raced = true;
              // The running release saves the card right before the migration writes it.
              assertTrue(
                  super.update(
                      workspace, StoredDraft.of(draft.id(), revision + 1, saved, "now"), revision));
            }
            return super.update(workspace, draft, revision);
          }
        };
    var report = new RentalDraftMigration(racing, catalog).run();
    assertEquals(1, report.migrated());
    assertTrue(report.conflicts().isEmpty());
    var row = drafts.find("ws", "old").orElseThrow();
    // The owner's save is kept; only its version moves to the new name.
    assertEquals(3, row.revision());
    var expected = saved.deepCopy();
    expected.remove("schemaVersion");
    expected.put("cardVersion", catalog.cardVersion());
    assertEquals(expected, parse(row.data()));
  }

  @Test
  void cardsOfTheCurrentModelMoveFromSchemaVersionToCardVersionOnce() {
    var drafts = repository();
    var before = (ObjectNode) CURRENT.deepCopy();
    before.remove("cardVersion");
    before.put("schemaVersion", "hash-of-every-rule-and-selector");
    before.set("legacy", array().add(object("platform", "example", "field", "floor", "value", 3)));
    store(drafts, "ws", "saved-before", 4, before.toString());
    store(drafts, "ws", "current", 2, CURRENT.toString());
    var stored = rows(drafts);

    var report = new RentalDraftMigration(drafts, catalog).run();

    // Renamed cards add nothing to legacy: their old values were resolved before.
    assertEquals(new RentalDraftMigration.Report(2, 1, 0, 0, List.of(), List.of()), report);
    var row = drafts.find("ws", "saved-before").orElseThrow();
    assertEquals(5, row.revision());
    assertEquals(stored.get("ws/saved-before").updated(), row.updated());
    var expected = before.deepCopy();
    expected.remove("schemaVersion");
    expected.put("cardVersion", catalog.cardVersion());
    assertEquals(expected, parse(row.data()));
    // A stale cardVersion is a card of the current model: «Обновить поля карточки» handles it.
    assertEquals(stored.get("ws/current"), drafts.find("ws", "current").orElseThrow());
    assertEquals(0, new RentalDraftMigration(drafts, catalog).run().migrated());
  }

  @Test
  void commandMigratesTheGivenDatabaseWithTheGivenBundle() throws Exception {
    var drafts = repository();
    store(drafts, "ws", "old", 1, oldCard(object("currency", 2), object()).toString());
    String database = "--database=" + dir.resolve("workspace.sqlite");
    var report =
        RentalDraftMigrationCommand.run(
            RentalDraftMigrationCommand.FLAG, database, "--rental-reference=" + BUNDLE);
    assertEquals(1, report.migrated());
    var migrated = parse(drafts.find("ws", "old").orElseThrow().data());
    assertEquals(2, migrated.path("modelVersion").asInt());

    Path missing = dir.resolve("missing.sqlite");
    assertThrows(
        IllegalArgumentException.class,
        () ->
            RentalDraftMigrationCommand.run(
                RentalDraftMigrationCommand.FLAG,
                "--database=" + missing,
                "--rental-reference=" + BUNDLE));
    assertFalse(Files.exists(missing), "the command never creates an empty database");
    assertThrows(
        IllegalArgumentException.class,
        () -> RentalDraftMigrationCommand.run(RentalDraftMigrationCommand.FLAG, database));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            RentalDraftMigrationCommand.run(
                RentalDraftMigrationCommand.FLAG,
                database,
                "--rental-reference=" + BUNDLE,
                "--dry-run"));
  }

  @Test
  void databaseWithoutRentalCardsIsLeftAsIs() throws Exception {
    Path database = dir.resolve("ads-only.sqlite");
    var jdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:" + database));
    jdbc.execute("CREATE TABLE ads(id TEXT PRIMARY KEY)");
    var report =
        RentalDraftMigrationCommand.run(
            RentalDraftMigrationCommand.FLAG,
            "--database=" + database,
            "--rental-reference=" + BUNDLE);
    assertEquals(0, report.drafts());
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT count(*) FROM sqlite_master WHERE name='rental_drafts'", Integer.class));
  }

  /** Forwards every call; a test overrides one of them. */
  static class Delegating implements RentalDraftRepository {
    final RentalDraftRepository target;

    Delegating(RentalDraftRepository target) {
      this.target = target;
    }

    public List<String> workspaces() {
      return target.workspaces();
    }

    public List<ListedDraft> list(String workspace) {
      return target.list(workspace);
    }

    public Optional<StoredDraft> find(String workspace, String id) {
      return target.find(workspace, id);
    }

    public long count(String workspace) {
      return target.count(workspace);
    }

    public boolean insert(String workspace, StoredDraft draft) {
      return target.insert(workspace, draft);
    }

    public boolean update(String workspace, StoredDraft draft, int revision) {
      return target.update(workspace, draft, revision);
    }

    public boolean delete(String workspace, String id, int revision) {
      return target.delete(workspace, id, revision);
    }
  }
}
