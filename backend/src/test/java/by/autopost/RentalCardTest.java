package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.card.*;
import by.autopost.rental.catalog.*;
import by.autopost.rental.model.*;
import by.autopost.rental.preparation.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RentalCardTest {
  @TempDir Path dir;

  void write(String path, JsonNode value) throws Exception {
    Path target = dir.resolve(path);
    Files.createDirectories(target.getParent());
    Files.writeString(target, value.toString());
  }

  RentalCatalog fixture() throws Exception {
    JsonNode common =
        array(
            List.of(
                object(
                    "id",
                    "apartment",
                    "options",
                    List.of(
                        object(
                            "id",
                            "group.main",
                            "name",
                            "Main",
                            "type",
                            "group",
                            "options",
                            List.of(
                                object(
                                    "id",
                                    "rental.rooms",
                                    "name",
                                    "Rooms",
                                    "type",
                                    "enum",
                                    "options",
                                    List.of())))))));
    write("integration/apartments_long_term_rent_common.json", common);
    write("integration/integration-audit.json", object("field_evidence", List.of()));
    ObjectNode registry = object();
    for (String p : List.of("one", "two", "three", "four", "fifth")) {
      registry.set(p, object("name", "Marketplace " + p));
      JsonNode schema =
          array(
              List.of(
                  object(
                      "options",
                      List.of(
                          object(
                              "id",
                              "rooms",
                              "name",
                              "Rooms",
                              "type",
                              "enum",
                              "options",
                              List.of(
                                  object(
                                      "id",
                                      "rooms.two",
                                      "type",
                                      "choice",
                                      "name",
                                      "Two",
                                      "options",
                                      List.of(),
                                      "fill_rule",
                                      object("value", 2))),
                              "fill_rule",
                              object("required", true)),
                          object(
                              "id",
                              "address",
                              "name",
                              "Address",
                              "type",
                              "text",
                              "options",
                              List.of(),
                              "fill_rule",
                              object("required", true))))));
      write(p + "/apartments_long_term_rent_" + p + ".json", schema);
      write(
          "runtime/preparation_" + p + ".json",
          object(
              "runtime_version",
              "1.0",
              "platform",
              p,
              "schema_hash",
              by.autopost.shared.Hashing.sha256(schema.toString()),
              "common_hash",
              by.autopost.shared.Hashing.sha256(common.toString()),
              "address_bound_fields",
              List.of("address"),
              "fields",
              List.of(
                  object(
                      "common_option_id",
                      "rental.rooms",
                      "platform_option_id",
                      "rooms",
                      "conversion",
                      object(
                          "kind", "lookup", "values", List.of(object("from", "two", "to", 2)))))));
    }
    write(
        "runtime/card.json",
        object(
            "version",
            2,
            "platforms",
            registry,
            "canonicalValues",
            object("rental.rooms", List.of("two")),
            "addressProjection",
            object("location.street", "street")));
    return new RentalCatalog(new FileReferenceRepository(dir.toString()));
  }

  @Test
  void fifthMarketplaceUsesSameEditorAndPreparationWithoutCodeChanges() throws Exception {
    RentalCatalog catalog = fixture();
    var editor = catalog.editor();
    assertEquals(5, editor.path("platforms").size());
    assertEquals(1, editor.path("category").path("options").get(0).path("options").size());
    assertEquals(
        5,
        editor.path("category").path("options").get(0).path("options").get(0).path("uses").size());
    var result =
        catalog.prepare(
            object(
                "modelVersion",
                2,
                "schemaVersion",
                catalog.version(),
                "values",
                object("rental.rooms", "two"),
                "extras",
                object(),
                "platforms",
                List.of("one", "two", "three", "four", "fifth")));
    assertEquals(5, result.path("platforms").size());
    for (var p : result.path("platforms")) assertEquals(2, p.path("values").path("rooms").asInt());
  }

  @Test
  void migrationPreservesConflictsAndRemovesStaleNativeAddress() throws Exception {
    var c = fixture();
    var old =
        object(
            "schemaVersion",
            "old",
            "values",
            object("rental.rooms", "one", "location.street", "Old street"),
            "address",
            object("street", "New street", "confirmed", false),
            "extras",
            object("one", object("rooms", 2, "address", "Old native address")),
            "platforms",
            List.of("one"));
    var migrated = c.normalize(old);
    assertEquals("one", migrated.path("values").path("rental.rooms").asText());
    assertFalse(migrated.path("values").has("location.street"));
    assertTrue(migrated.path("extras").isEmpty());
    assertEquals(3, migrated.path("legacy").size());
    assertEquals(migrated, c.normalize(migrated));
    var output = c.prepare(migrated).path("platforms").get(0);
    assertFalse(output.path("values").has("address"));
    assertFalse(output.path("dataReady").asBoolean());
    assertEquals("Old native address", old.path("extras").path("one").path("address").asText());
  }

  @Test
  void unambiguousLegacyValueBecomesCanonicalAndSurvivesSecondOpen() throws Exception {
    var c = fixture();
    var migrated =
        c.normalize(
            object(
                "values",
                object(),
                "extras",
                object("fifth", object("rooms", 2)),
                "platforms",
                List.of("fifth")));
    assertEquals("two", migrated.path("values").path("rental.rooms").asText());
    assertTrue(migrated.path("legacy").isEmpty());
    assertEquals(migrated, c.normalize(migrated));
  }

  @Test
  void oldDerivedAddressStringsDoNotAskForTheSameAddressAgain() throws Exception {
    var c = fixture();
    ObjectNode card = (ObjectNode) c.card();
    card.set(
        "addressProjection",
        object(
            "location.settlement",
            "settlement",
            "location.house_number",
            "house",
            "location.latitude",
            "latitude"));
    write("runtime/card.json", card);
    var old =
        object(
            "values",
            object(
                "location.settlement",
                "Region, District, City",
                "location.house_number",
                "7А корп. 2",
                "location.latitude",
                "53.9"),
            "address",
            object(
                "region",
                "Region",
                "district",
                "District",
                "settlement",
                "City",
                "house",
                "7А",
                "block",
                "2",
                "latitude",
                "53.9",
                "confirmed",
                true),
            "extras",
            object());
    var migrated = c.normalize(old);
    assertTrue(migrated.path("legacy").isEmpty());
    assertEquals("City", migrated.path("address").path("settlement").asText());
    var unconfirmed =
        c.normalize(object("values", object("location.latitude", "53.9"), "extras", object()));
    assertEquals("53.9", unconfirmed.path("legacy").get(0).path("value").asText());
  }

  @Test
  void ambiguousListsAndNullCodesNeverInventSeveralCanonicalFacts() throws Exception {
    var c = fixture();
    String path = "runtime/preparation_one.json";
    ObjectNode plan = (ObjectNode) c.plan("one").deepCopy();
    ArrayNode members = array();
    for (String source : List.of("location.station1", "location.station2", "location.station3"))
      members.add(
          object(
              "common_option_id",
              source,
              "values",
              List.of(object("from", "Station A", "to", "a"), object("from", "none", "to", null))));
    ((ArrayNode) plan.get("fields"))
        .add(
            object(
                "platform_option_id",
                "stations",
                "conversion",
                object("kind", "multi_lookup", "members", members)));
    var repository = new FileReferenceRepository(dir.toString());
    var snapshot = repository.snapshot();
    Map<String, JsonNode> plans = new HashMap<>(), schemas = new HashMap<>();
    for (String p : snapshot.platforms()) {
      plans.put(p, snapshot.plan(p));
      schemas.put(p, snapshot.schema(p));
    }
    plans.put("one", plan);
    var migration =
        new CardMigration(
            new ReferenceSnapshot(
                snapshot.categoryId(),
                snapshot.common(),
                snapshot.card(),
                snapshot.audit(),
                schemas,
                plans,
                Map.of(),
                snapshot.version()));

    for (JsonNode oldList : List.of(array(List.of("a")), MAPPER.readTree("[null]"))) {
      var migrated =
          migration.normalize(
              object("values", object(), "extras", object("one", object("stations", oldList))));
      assertTrue(migrated.path("values").isEmpty());
      assertEquals(1, migrated.path("legacy").size());
      assertEquals(oldList, migrated.path("legacy").get(0).path("value"));
    }
  }

  @Test
  void staleVersionsCannotSilentlyUseNewMappings() throws Exception {
    var c = fixture();
    assertThrows(
        ApiException.class,
        () ->
            c.prepare(
                object("schemaVersion", "old", "values", object(), "platforms", List.of("fifth"))));
  }

  @Test
  void canonicalFloorCheckDoesNotDependOnSelectedMarketplace() {
    ObjectNode prepared = object("issues", array(), "dataReady", true);
    CardProjection.annotate(
        prepared,
        object("platform", "example"),
        object("values", object("rental.floor", "9", "building.total_floors", "5")));
    assertFalse(prepared.path("dataReady").asBoolean());
    assertEquals("rental.floor", prepared.path("issues").get(0).path("source").asText());
  }
}
