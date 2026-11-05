package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.*;
import by.autopost.rental.engine.CardChecks;
import by.autopost.rental.engine.Issue;
import by.autopost.rental.model.*;
import by.autopost.rental.persistence.CardMigration;
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
    ObjectNode registry = object(), manifestPlatforms = object();
    for (String p : List.of("one", "two", "three", "four", "fifth")) {
      registry.set(p, object("name", "Marketplace " + p));
      manifestPlatforms.set(
          p,
          object(
              "schema",
              p + "/apartments_long_term_rent_" + p + ".json",
              "plan",
              "runtime/preparation_" + p + ".json",
              "browser",
              "runtime/browser_" + p + ".json"));
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
      write(
          "runtime/browser_" + p + ".json",
          object(
              "format",
              1,
              "platform",
              p,
              "startUrl",
              "https://" + p + ".example/new",
              "ready",
              List.of(object("selector", "form")),
              "controls",
              List.of(object("field", "rooms", "action", "choices", "selector", "[name=rooms]")),
              "setup",
              List.of(),
              "next",
              List.of(),
              "submit",
              List.of()));
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
    write(
        "manifest.json",
        object(
            "format_version",
            1,
            "source_schema_version",
            "1.2",
            "category_id",
            "apartments_long_term_rent",
            "common",
            "integration/apartments_long_term_rent_common.json",
            "card",
            "runtime/card.json",
            "platforms",
            manifestPlatforms));
    return new RentalCatalog(new FileReferenceRepository(dir.toString()));
  }

  /** The one-time conversion with the current fixture files. */
  CardMigration migration() {
    return new CardMigration(new FileReferenceRepository(dir.toString()).snapshot());
  }

  @Test
  void canonicalValuesComeOnlyFromCardJson() throws Exception {
    fixture();
    // The former fallback read them from integration/integration-audit.json.
    write("integration/integration-audit.json", object("field_evidence", List.of()));
    ObjectNode card = (ObjectNode) MAPPER.readTree(dir.resolve("runtime/card.json").toFile());
    card.remove("canonicalValues");
    write("runtime/card.json", card);
    var error =
        assertThrows(
            ReferenceBundleException.class, () -> new FileReferenceRepository(dir.toString()));
    assertTrue(error.getMessage().startsWith(dir.resolve("runtime/card.json") + ": "));
    assertTrue(error.getMessage().contains("canonicalValues"), error.getMessage());
  }

  @Test
  void bundleWithoutManifestIsNotLoadedFromDefaultPaths() throws Exception {
    fixture();
    Files.delete(dir.resolve("manifest.json"));
    var error =
        assertThrows(
            ReferenceBundleException.class, () -> new FileReferenceRepository(dir.toString()));
    assertEquals(dir.resolve("manifest.json") + ": файл не найден", error.getMessage());
  }

  @Test
  void fifthMarketplaceUsesSameEditorAndPreparationWithoutCodeChanges() throws Exception {
    RentalCatalog catalog = fixture();
    var editor = RentalJson.editor(catalog);
    assertEquals(5, editor.path("platforms").size());
    assertEquals(1, editor.path("groups").get(0).path("fields").size());
    // The one card field is shown for each platform alone, as the server decides.
    for (String platform : List.of("one", "two", "three", "four", "fifth"))
      assertEquals(
          List.of("rental.rooms"),
          catalog
              .fields(
                  RentalJson.card(
                      object("modelVersion", 2, "values", object(), "platforms", List.of(platform))))
              .fields()
              .stream()
              .map(f -> f.id())
              .toList(),
          platform);
    var result =
        RentalJson.prepare(
            catalog,
            object(
                "modelVersion",
                2,
                "cardVersion",
                catalog.cardVersion(),
                "values",
                object("rental.rooms", "two"),
                "extras",
                object(),
                "platforms",
                List.of("one", "two", "three", "four", "fifth")),
            0);
    assertEquals(5, result.path("platforms").size());
    for (var p : result.path("platforms")) assertEquals(2, p.path("values").path("rooms").asInt());
  }

  @Test
  void migrationPreservesConflictsAndRemovesStaleNativeAddress() throws Exception {
    var c = fixture();
    var old =
        object(
            "cardVersion",
            "old",
            "values",
            object("rental.rooms", "one", "location.street", "Old street"),
            "address",
            object("street", "New street", "confirmed", false),
            "extras",
            object("one", object("rooms", 2, "address", "Old native address")),
            "platforms",
            List.of("one"));
    var migrated = migration().normalize(old);
    assertEquals("one", migrated.path("values").path("rental.rooms").asText());
    assertFalse(migrated.path("values").has("location.street"));
    assertTrue(migrated.path("extras").isEmpty());
    assertEquals(3, migrated.path("legacy").size());
    assertEquals(migrated, migration().normalize(migrated));
    var output = RentalJson.prepare(c, migrated, 0).path("platforms").get(0);
    assertFalse(output.path("values").has("address"));
    assertFalse(output.path("checksPassed").asBoolean());
    assertEquals("Old native address", old.path("extras").path("one").path("address").asText());
  }

  @Test
  void unambiguousLegacyValueBecomesCanonicalAndSurvivesSecondOpen() throws Exception {
    fixture();
    var migrated =
        migration()
            .normalize(
                object(
                    "values",
                    object(),
                    "extras",
                    object("fifth", object("rooms", 2)),
                    "platforms",
                    List.of("fifth")));
    assertEquals("two", migrated.path("values").path("rental.rooms").asText());
    assertTrue(migrated.path("legacy").isEmpty());
    assertEquals(migrated, migration().normalize(migrated));
  }

  @Test
  void oldDerivedAddressStringsDoNotAskForTheSameAddressAgain() throws Exception {
    fixture();
    ObjectNode card = (ObjectNode) MAPPER.readTree(dir.resolve("runtime/card.json").toFile());
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
    var migrated = migration().normalize(old);
    assertTrue(migrated.path("legacy").isEmpty());
    assertEquals("City", migrated.path("address").path("settlement").asText());
    var unconfirmed =
        migration()
            .normalize(object("values", object("location.latitude", "53.9"), "extras", object()));
    assertEquals("53.9", unconfirmed.path("legacy").get(0).path("value").asText());
  }

  @Test
  void ambiguousListsAndNullCodesNeverInventSeveralCanonicalFacts() throws Exception {
    fixture();
    ObjectNode plan =
        (ObjectNode) MAPPER.readTree(dir.resolve("runtime/preparation_one.json").toFile());
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
    var snapshot = new FileReferenceRepository(dir.toString()).snapshot();
    // An earlier plan that the current schema no longer validates: built by hand.
    Map<String, ReferenceSnapshot.Platform> platforms = new HashMap<>();
    for (String p : snapshot.platforms()) platforms.put(p, snapshot.platform(p));
    var one = snapshot.platform("one");
    platforms.put(
        "one",
        new ReferenceSnapshot.Platform(
            "one",
            one.schema(),
            ReferenceJson.parse(plan, Mapping.class),
            one.form(),
            one.coverage()));
    var migration =
        new CardMigration(
            new ReferenceSnapshot(
                snapshot.categoryId(),
                snapshot.common(),
                snapshot.card(),
                platforms,
                snapshot.cardVersion(),
                snapshot.integrationVersion()));

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
  void oldCardModelIsNeitherPreparedNorAcceptedUntilMigrated() throws Exception {
    var c = fixture();
    var old =
        object(
            "cardVersion",
            c.cardVersion(),
            "values",
            object("rental.rooms", "two"),
            "extras",
            object("one", object("rooms", 2)),
            "platforms",
            List.of("one"));
    for (Runnable call :
        List.<Runnable>of(
            () -> c.prepare(RentalJson.card(old), 0), () -> c.acceptRules(RentalJson.card(old)))) {
      var error = assertThrows(ApiException.class, call::run);
      assertEquals(409, error.status);
      assertEquals("Карточку нужно перенести командой миграции.", error.getMessage());
    }
  }

  @Test
  void acceptingNewRulesKeepsTheCardAndOnlyMovesItsVersion() throws Exception {
    var c = fixture();
    var card =
        object(
            "modelVersion",
            2,
            "cardVersion",
            "previous",
            "values",
            object("rental.rooms", "two"),
            "extras",
            object(),
            "legacy",
            List.of(object("platform", "one", "field", "rooms", "value", 3)),
            "platforms",
            List.of("one"));
    // The card document stays as it is: the editor endpoint only puts this version into it.
    assertEquals(c.cardVersion(), c.acceptRules(RentalJson.card(card)));
  }

  @Test
  void projectedAddressValuesComeOnlyFromTheAddress() throws Exception {
    fixture();
    var model = new FileReferenceRepository(dir.toString()).snapshot().card();
    var values = object("location.street", "Old street", "rental.rooms", "two");
    assertEquals(
        Map.of("rental.rooms", Value.text("two")),
        CardChecks.values(RentalJson.card(object("values", values)), model));
    assertEquals(
        Value.text("New street"),
        CardChecks.values(
                RentalJson.card(object("values", values, "address", object("street", "New street"))),
                model)
            .get("location.street"));
  }

  @Test
  void cardOfAnotherCardModelVersionIsNotPreparedUntilItsFieldsAreUpdated() throws Exception {
    var c = fixture();
    var card =
        object(
            "modelVersion",
            2,
            "cardVersion",
            "old",
            "values",
            object(),
            "platforms",
            List.of("fifth"));
    var error = assertThrows(ApiException.class, () -> c.prepare(RentalJson.card(card), 0));
    assertEquals(409, error.status);
    assertEquals("Правила обновились. Обновите поля карточки.", error.getMessage());
    card.put("cardVersion", c.acceptRules(RentalJson.card(card)));
    assertDoesNotThrow(() -> c.prepare(RentalJson.card(card), 0));
  }

  @Test
  void canonicalFloorCheckDoesNotDependOnSelectedMarketplace() {
    var issues =
        CardChecks.annotate(
            List.<Issue>of(),
            ReferenceJson.parse(object("platform", "example"), Mapping.class),
            RentalJson.card(object("values", object("rental.floor", "9", "building.total_floors", "5"))));
    assertEquals(1, issues.size());
    assertEquals("rental.floor", issues.get(0).source());
  }
}
