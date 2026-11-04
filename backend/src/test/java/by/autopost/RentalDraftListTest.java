package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalDraftService;
import by.autopost.rental.persistence.JdbcRentalDraftRepository;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class RentalDraftListTest {
  @TempDir Path dir;

  JdbcTemplate database() {
    return new JdbcTemplate(
        new DriverManagerDataSource("jdbc:sqlite:" + dir.resolve("workspace.sqlite")));
  }

  Map<String, JsonNode> byId(JsonNode list) {
    Map<String, JsonNode> rows = new HashMap<>();
    for (var row : list.path("drafts")) rows.put(text(row, "id"), row);
    return rows;
  }

  @Test
  void listReadsStoredColumnsAndNeverParsesCardData() {
    var jdbc = database();
    var service =
        new RentalDraftService(new JdbcRentalDraftRepository(jdbc));
    var draft =
        object(
            "values",
            object("listing.title", "Двушка у метро"),
            "address",
            object("label", "г Минск, ул Брикета, д 18"));
    service.save("ws", "flat", object("revision", 0, "draft", draft));
    service.save("other", "foreign", object("revision", 0, "draft", draft));
    // A list must not depend on the card body: an unreadable body still lists by its columns.
    jdbc.update("UPDATE rental_drafts SET data='not json' WHERE id='flat'");
    var row = byId(service.list("ws")).get("flat");
    assertEquals(1, service.list("ws").path("drafts").size());
    assertEquals("Двушка у метро", text(row, "title"));
    assertEquals("г Минск, ул Брикета, д 18", text(row, "address"));
    assertEquals(1, row.path("revision").asInt());
  }

  @Test
  void openingReturnsTheSavedCardUnchanged() {
    var service = new RentalDraftService(new JdbcRentalDraftRepository(database()));
    var draft =
        object(
            "modelVersion",
            2,
            "schemaVersion",
            "rules-of-an-older-release",
            "values",
            object("listing.title", "Двушка", "location.street", "Old street"),
            "extras",
            object("kufar", object("rooms", 2)),
            "platforms",
            List.of("kufar"));
    service.save("ws", "flat", object("revision", 0, "draft", draft));
    var opened = service.get("ws", "flat");
    assertEquals(draft, opened.path("draft"));
    assertEquals(draft, service.get("ws", "flat").path("draft"));
  }

  @Test
  void oldCardModelIsNotOpenedUntilMigrated() {
    var service = new RentalDraftService(new JdbcRentalDraftRepository(database()));
    service.save(
        "ws", "flat", object("revision", 0, "draft", object("values", object("rooms", "2"))));
    var error = assertThrows(ApiException.class, () -> service.get("ws", "flat"));
    assertEquals(409, error.status);
    assertEquals("Карточку нужно перенести командой миграции.", error.getMessage());
  }

  @Test
  void saveRewritesTitleAndAddressOfTheList() {
    var service =
        new RentalDraftService(new JdbcRentalDraftRepository(database()));
    service.save(
        "ws",
        "flat",
        object("revision", 0, "draft", object("values", object("listing.title", "A"))));
    service.save(
        "ws",
        "flat",
        object(
            "revision",
            1,
            "draft",
            object(
                "values",
                object("listing.title", "B"),
                "address",
                object("label", "Минск, Ленина, 10"))));
    var row = byId(service.list("ws")).get("flat");
    assertEquals("B", text(row, "title"));
    assertEquals("Минск, Ленина, 10", text(row, "address"));
    assertEquals(2, row.path("revision").asInt());
  }

  @Test
  void existingRowsReceiveTitleAndAddressOnceWhenColumnsAreAdded() {
    var jdbc = database();
    // The table as created before the columns existed.
    jdbc.execute(
        "CREATE TABLE rental_drafts(id TEXT NOT NULL,workspace_id TEXT NOT NULL"
            + " REFERENCES profiles(id),revision INTEGER NOT NULL,data TEXT NOT NULL,updated TEXT"
            + " NOT NULL,PRIMARY KEY(workspace_id,id))");
    String insert =
        "INSERT INTO rental_drafts(id,workspace_id,revision,data,updated) VALUES(?,?,?,?,?)";
    jdbc.update(
        insert,
        "full",
        "ws",
        3,
        object(
                "values",
                object("listing.title", "Квартира \"у парка\""),
                "address",
                object("label", "Минск, Ленина, 10"))
            .toString(),
        "2026-11-03T10:00:00Z");
    jdbc.update(insert, "empty", "ws", 1, object("values", object()).toString(), "2026-11-02");
    jdbc.update(
        insert,
        "odd",
        "ws",
        1,
        object("values", List.of("listing.title"), "address", object("label", 5)).toString(),
        "2026-11-01");
    new JdbcRentalDraftRepository(jdbc);
    var columns =
        jdbc.queryForList("SELECT id,title,address_label FROM rental_drafts ORDER BY id");
    assertEquals(
        List.of(
            Map.of("id", "empty", "title", "", "address_label", ""),
            Map.of(
                "id",
                "full",
                "title",
                "Квартира \"у парка\"",
                "address_label",
                "Минск, Ленина, 10"),
            Map.of("id", "odd", "title", "", "address_label", "")),
        columns);
    // The backfill runs only when the columns are added, not on every start.
    jdbc.update("UPDATE rental_drafts SET title='kept' WHERE id='full'");
    new JdbcRentalDraftRepository(jdbc);
    assertEquals(
        "kept",
        jdbc.queryForObject("SELECT title FROM rental_drafts WHERE id='full'", String.class));
  }
}
