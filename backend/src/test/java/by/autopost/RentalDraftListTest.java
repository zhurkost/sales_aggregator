package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.application.RentalDraftService;
import by.autopost.rental.persistence.JdbcRentalDraftRepository;
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
        new RentalDraftService(new JdbcRentalDraftRepository(jdbc), mock(RentalCatalog.class));
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
  void saveRewritesTitleAndAddressOfTheList() {
    var service =
        new RentalDraftService(
            new JdbcRentalDraftRepository(database()), mock(RentalCatalog.class));
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
