package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.*;
import by.autopost.shared.Hashing;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ReferenceBundleTest {
  @Test
  void committedMarketplaceBundleIsComplete() {
    var repository = new FileReferenceRepository("../data/rental/apartments_long_term_rent");
    var snapshot = repository.snapshot();
    assertEquals(Set.of("kufar", "onliner", "realt", "domovita"), snapshot.platforms());
    assertFalse(new RentalCatalog(repository).editor().path("category").path("options").isEmpty());
    assertEquals(
        3, new RentalCatalog(repository).editor().path("card").path("profileDefaults").size());
  }

  @Test
  void buildingTheEditorLeavesTheOperationsCopyAsLoaded() {
    var snapshot =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot();
    var common = snapshot.common().deepCopy();
    var editor = new EditorSchemaBuilder().build(snapshot);
    assertFalse(editor.toString().contains("group.address_projection"));
    assertEquals(common, snapshot.common());
  }

  @Test
  void profileDefaultsRejectUnknownSourcesAndFields() throws Exception {
    fixture();
    var card = (ObjectNode) read("card.json");
    card.set("profileDefaults", array().add(object("setting", "phone", "field", "missing")));
    write("card.json", card);
    broken();
    card.set(
        "profileDefaults", array().add(object("setting", "password", "field", "rental.currency")));
    write("card.json", card);
    broken();
  }

  @Test
  void cardModelOtherThanVersion2IsRejected() throws Exception {
    fixture();
    var card = (ObjectNode) read("card.json");
    card.put("version", 1);
    write("card.json", card);
    var error = broken();
    assertTrue(error.getMessage().contains("версии 2"), error.getMessage());
  }

  @Test
  void ambiguousLookupIsRejectedButExplicitPartialCoverageCannotInventCodes() throws Exception {
    fixture();
    var plan = read("example.plan.json");
    var conversion = (ObjectNode) plan.path("fields").get(1).path("conversion");
    ((ArrayNode) conversion.path("values")).add(object("from", "BYN", "to", "different"));
    write("example.plan.json", plan);
    broken();
    conversion.set("values", array());
    write("example.plan.json", plan);
    var catalog = new RentalCatalog(load());
    var result =
        catalog
            .prepare(
                object(
                    "modelVersion",
                    2,
                    "cardVersion",
                    catalog.cardVersion(),
                    "values",
                    object("rental.currency", "BYN"),
                    "platforms",
                    List.of("example")))
            .path("platforms")
            .get(0);
    assertFalse(result.path("values").has("currency"));
    assertFalse(result.path("checksPassed").asBoolean());
  }

  @Test
  void planAndCardRejectKeysTheServerDoesNotRead() throws Exception {
    var edits =
        Map.<String, java.util.function.Consumer<ObjectNode>>of(
            "on_unmapped",
            plan ->
                ((ObjectNode) plan.path("fields").get(1).path("conversion"))
                    .put("on_unmapped", "needs_review"),
            "comment",
            plan -> ((ObjectNode) plan.path("fields").get(0)).put("comment", "draft"),
            "note",
            plan -> plan.put("note", "checked by hand"),
            "label",
            plan ->
                ((ObjectNode) plan.path("fields").get(1).path("conversion").path("values").get(0))
                    .put("label", "рубли"),
            "severity",
            plan ->
                plan.set(
                    "review", array().add(object("field", "", "message", "x", "severity", "low"))));
    fixture();
    var original = (ObjectNode) read("example.plan.json");
    for (var edit : edits.entrySet()) {
      var plan = original.deepCopy();
      edit.getValue().accept(plan);
      write("example.plan.json", plan);
      unknownKey(edit.getKey());
    }
    write("example.plan.json", original);
    assertDoesNotThrow(this::load);
    var card = (ObjectNode) read("card.json");
    card.put("expandedGroups", "group.main");
    write("card.json", card);
    unknownKey("expandedGroups");
  }

  void unknownKey(String key) {
    var error = broken();
    assertTrue(error.getMessage().contains("неизвестный ключ " + key), error.getMessage());
  }

  @Test
  void malformedNumericTargetsDoNotSilentlyBecomeDecimalNumbers() throws Exception {
    fixture();
    var plan = read("example.plan.json");
    ((ObjectNode) plan.path("fields").get(0).path("conversion")).put("target", "invented");
    write("example.plan.json", plan);
    broken();
  }

  @TempDir Path dir;
  long timestamp = System.currentTimeMillis();

  FileReferenceRepository fixture() throws Exception {
    try (var paths = Files.list(Path.of("src/test/resources/reference-example"))) {
      for (Path p : paths.toList()) Files.copy(p, dir.resolve(p.getFileName()));
    }
    return load();
  }

  /** Loads the fixture files as the start of a release does. */
  FileReferenceRepository load() {
    return new FileReferenceRepository(dir.toString());
  }

  /** The edited fixture is rejected as a whole, as at the start of a release. */
  ReferenceBundleException broken() {
    return assertThrows(ReferenceBundleException.class, this::load);
  }

  JsonNode read(String file) throws Exception {
    return MAPPER.readTree(dir.resolve(file).toFile());
  }

  void write(String file, JsonNode data) throws Exception {
    Files.writeString(dir.resolve(file), data.toString());
    Files.setLastModifiedTime(dir.resolve(file), FileTime.fromMillis(++timestamp));
  }

  void schema(JsonNode data) throws Exception {
    write("example.schema.json", data);
  }

  @Test
  void optionCodesKeepTheirJsonTypes() throws Exception {
    var catalog = new RentalCatalog(fixture());
    for (String code : List.of("BYN", "USD")) {
      var result =
          catalog
              .prepare(
                  object(
                      "cardVersion",
                      catalog.cardVersion(),
                      "modelVersion",
                      2,
                      "values",
                      object("rental.price", "1 500,50", "rental.currency", code),
                      "platforms",
                      List.of("example")))
              .path("platforms")
              .get(0);
      assertEquals("1500.5", result.path("values").path("rent").asText());
      assertEquals(
          code.equals("BYN") ? TextNode.valueOf("01") : IntNode.valueOf(2),
          result.path("values").path("currency"));
      assertFalse(result.path("publicationReady").asBoolean());
    }
  }

  @Test
  void recipePlanAndSchemaEditsChangeOnlyTheIntegrationVersion() throws Exception {
    fixture();
    var before = new FileReferenceRepository(dir.toString()).snapshot();
    Map<String, java.util.function.Consumer<Map<String, JsonNode>>> integration =
        Map.of(
            "selector",
            files ->
                control((ObjectNode) files.get("example.browser.json"), 0)
                    .put("selector", "input[name=price]"),
            "plan",
            files ->
                ((ObjectNode) files.get("example.plan.json"))
                    .set("review", array().add(object("field", "rent", "message", "Проверьте"))),
            "schema label",
            files -> firstField(files.get("example.schema.json")).put("name", "Арендная плата"));
    Map<String, java.util.function.Consumer<Map<String, JsonNode>>> cardModel =
        Map.of(
            "card.json",
            files ->
                ((ObjectNode) files.get("card.json"))
                    .set("valueLabels", object("BYN", "Белорусский рубль")),
            "common",
            files -> firstField(files.get("common.json")).put("name", "Главное"));
    for (var edits : List.of(integration, cardModel))
      for (var edit : edits.entrySet()) {
        var after = edited(edit.getValue());
        assertEquals(
            edits == integration,
            before.cardVersion().equals(after.cardVersion()),
            edit.getKey() + ": card version");
        assertEquals(
            edits == cardModel,
            before.integrationVersion().equals(after.integrationVersion()),
            edit.getKey() + ": integration version");
      }
  }

  @Test
  void openCardKeepsSavingCheckingAndLaunchingAfterASelectorFix() throws Exception {
    fixture();
    var storage = RentalStorage.at(dir.resolve("drafts.sqlite"));
    var drafts = storage.draftService();
    var before = new RentalCatalog(new FileReferenceRepository(dir.toString()));
    // The editor stamps the card with the version of the card model it shows.
    var card =
        object(
            "cardVersion",
            text(before.editor(), "cardVersion"),
            "modelVersion",
            2,
            "values",
            object("rental.price", "1500", "rental.currency", "BYN"),
            "platforms",
            List.of("example"));
    String id = UUID.randomUUID().toString();
    drafts.save("owner", id, object("revision", 0, "draft", card));
    var launched =
        storage.publicationService(before)
            .configuration("owner", object("id", id, "draft", card));
    // The next release fixes a selector; the editor opened before it stays usable.
    var recipe = (ObjectNode) read("example.browser.json");
    control(recipe, 0).put("selector", "input[name=price]");
    write("example.browser.json", recipe);
    var after = new RentalCatalog(new FileReferenceRepository(dir.toString()));
    ((ObjectNode) card.path("values")).put("rental.price", "1600");
    var saved = drafts.save("owner", id, object("revision", 1, "draft", card));
    assertEquals(2, saved.path("revision").asInt());
    var check = after.prepare(card).path("platforms").get(0);
    assertTrue(check.path("issues").isEmpty(), check.toString());
    assertEquals(1600, check.path("values").path("rent").asInt());
    var relaunched =
        storage.publicationService(after)
            .configuration("owner", object("id", id, "draft", card));
    var rent = relaunched.path("jobs").get(0).path("controls").get(0);
    assertEquals("input[name=price]", text(rent, "selector"));
    assertNotEquals(text(launched, "integrationVersion"), text(relaunched, "integrationVersion"));
    assertFalse(relaunched.has("schemaVersion"));
    assertEquals(text(before.editor(), "cardVersion"), text(after.editor(), "cardVersion"));
  }

  /** The bundle as one edit leaves it; the fixture files are restored afterwards. */
  ReferenceSnapshot edited(java.util.function.Consumer<Map<String, JsonNode>> edit)
      throws Exception {
    Map<String, JsonNode> files = new HashMap<>(), originals = new HashMap<>();
    for (String name :
        List.of(
            "example.browser.json",
            "example.plan.json",
            "example.schema.json",
            "card.json",
            "common.json")) {
      files.put(name, read(name));
      originals.put(name, read(name));
    }
    edit.accept(files);
    for (var file : files.entrySet()) write(file.getKey(), file.getValue());
    try {
      return new FileReferenceRepository(dir.toString()).snapshot();
    } finally {
      for (var file : originals.entrySet()) write(file.getKey(), file.getValue());
    }
  }

  static ObjectNode control(ObjectNode recipe, int index) {
    return (ObjectNode) recipe.path("controls").get(index);
  }

  /** The first field of a schema or common file: one category with its options. */
  static ObjectNode firstField(JsonNode schema) {
    return (ObjectNode) schema.get(0).path("options").get(0);
  }

  @Test
  void browserJobCarriesChecksPassedOfItsOwnPreparation() throws Exception {
    fixture();
    var catalog = new RentalCatalog(load());
    for (var values :
        List.of(
            object("rental.price", "1500", "rental.currency", "BYN"),
            object("rental.currency", "BYN"))) {
      var draft =
          object(
              "cardVersion",
              catalog.cardVersion(),
              "modelVersion",
              2,
              "values",
              values,
              "platforms",
              List.of("example"));
      boolean clean = catalog.prepare(draft).path("platforms").get(0).path("issues").isEmpty();
      var job = catalog.browser(draft).path("jobs").get(0);
      assertTrue(job.path("checksPassed").isBoolean(), values.toString());
      assertFalse(job.has("dataReady"), values.toString());
      assertEquals(clean, job.path("checksPassed").asBoolean(), values.toString());
      assertEquals(values.has("rental.price"), clean, values.toString());
    }
  }

  @Test
  void filesAreReadOnceAndEachOperationCopiesThemOnce() throws Exception {
    var repo = fixture();
    var first = repo.snapshot();
    // One copy per operation, not one per call.
    assertSame(first.plan("example"), first.plan("example"));
    assertSame(first.card(), first.card());
    ((ObjectNode) first.plan("example")).put("platform", "corrupt");
    var second = repo.snapshot();
    assertNotSame(first.plan("example"), second.plan("example"));
    assertEquals("example", text(second.plan("example"), "platform"));
    // The running release never reads the files again: a new bundle is a new release.
    write("card.json", object("version", 1));
    Files.delete(dir.resolve("manifest.json"));
    var later = repo.snapshot();
    assertEquals(first.cardVersion(), later.cardVersion());
    assertEquals(2, later.card().path("version").asInt());
    assertEquals(Set.of("example"), later.platforms());
  }

  @Test
  void planThatMapsARemovedNativeFieldIsRejectedByName() throws Exception {
    fixture();
    var source = read("example.schema.json");
    // A label edit leaves every reference valid: the bundle stays usable.
    ((ObjectNode) source.get(0).path("options").get(0)).put("name", "Арендная плата");
    schema(source);
    assertDoesNotThrow(this::load);
    ((ArrayNode) source.get(0).path("options")).remove(0);
    schema(source);
    var error = broken();
    // The error names the file to fix and the field it still maps.
    assertTrue(
        error.getMessage().startsWith(dir.resolve("example.plan.json") + ": "), error.getMessage());
    assertTrue(error.getMessage().contains("неизвестное целевое поле rent"), error.getMessage());
  }

  @Test
  void plansCarryNoHashesOfTheirSchemas() throws Exception {
    var committed = Path.of("../data/rental/apartments_long_term_rent/runtime");
    try (var files = Files.list(committed)) {
      var plans = files.filter(p -> p.getFileName().toString().startsWith("preparation_")).toList();
      assertEquals(4, plans.size());
      for (Path plan : plans)
        for (String key : List.of("schema_hash", "common_hash"))
          assertFalse(MAPPER.readTree(plan.toFile()).has(key), plan + " " + key);
    }
    fixture();
    var plan = (ObjectNode) read("example.plan.json");
    assertFalse(plan.has("schema_hash") || plan.has("common_hash"));
    for (String key : List.of("schema_hash", "common_hash")) {
      var stamped = plan.deepCopy().put(key, Hashing.sha256(read("common.json").toString()));
      write("example.plan.json", stamped);
      unknownKey(key);
    }
  }

  @Test
  void unknownSourcesAndUnsupportedHandlersFailBeforeEditor() throws Exception {
    fixture();
    var plan = read("example.plan.json");
    var row = (ObjectNode) plan.path("fields").get(0);
    row.put("common_option_id", "invented.field");
    write("example.plan.json", plan);
    broken();
    row.put("common_option_id", "rental.price");
    ((ObjectNode) row.path("conversion")).put("kind", "javascript");
    write("example.plan.json", plan);
    broken();
  }

  @Test
  void detectsDependencyCyclesAndDanglingConditions() throws Exception {
    fixture();
    var source = read("example.schema.json");
    var rent = (ObjectNode) source.get(0).path("options").get(0);
    var currency = (ObjectNode) source.get(0).path("options").get(1);
    var rentRule = (ObjectNode) rent.path("fill_rule");
    rentRule.set("when", object("option_id", "missing", "operator", "exists"));
    schema(source);
    broken();
    rentRule.set("when", object("option_id", "currency", "operator", "exists"));
    ((ObjectNode) currency.path("fill_rule"))
        .set("when", object("option_id", "rent", "operator", "exists"));
    schema(source);
    broken();
  }

  @Test
  void onlyFormat12SourceSchemasAreAccepted() throws Exception {
    fixture();
    var manifest = (ObjectNode) read("manifest.json");
    manifest.put("source_schema_version", "2.1");
    write("manifest.json", manifest);
    broken();
    manifest.put("source_schema_version", "1.2");
    write("manifest.json", manifest);
    assertDoesNotThrow(this::load);
    // A 2.1-style flat fact would be ignored by the 1.2 engine, so it is rejected.
    var source = read("example.schema.json");
    ((ObjectNode) source.get(0).path("options").get(1)).put("required", true);
    schema(source);
    var error = broken();
    assertTrue(error.getMessage().contains("fill_rule"), error.getMessage());
  }

  @Test
  void manifestRejectsKeysItDoesNotRead() throws Exception {
    fixture();
    var manifest = (ObjectNode) read("manifest.json");
    ((ObjectNode) manifest.path("platforms").path("example"))
        .put("binding", "example.binding.json");
    write("manifest.json", manifest);
    var error = broken();
    assertTrue(error.getMessage().contains("неизвестный ключ binding"), error.getMessage());
  }

  @Test
  void everyPlatformNeedsABrowserRecipe() throws Exception {
    fixture();
    var manifest = (ObjectNode) read("manifest.json");
    ((ObjectNode) manifest.path("platforms").path("example")).remove("browser");
    write("manifest.json", manifest);
    var error = broken();
    assertTrue(
        error.getMessage().contains("не указан путь browser площадки example"), error.getMessage());
  }

  @Test
  void pathsCannotEscapePrivateBundle() throws Exception {
    fixture();
    var manifest = (ObjectNode) read("manifest.json");
    manifest.put("common", "../outside.json");
    write("manifest.json", manifest);
    assertTrue(broken().getMessage().contains("путь выходит за каталог комплекта"));
  }

  @Test
  void preparationUsesOneSnapshotEvenIfRepositoryChangesMidRequest() throws Exception {
    var first = fixture().snapshot();
    int[] calls = {0};
    var catalog =
        new RentalCatalog(
            () -> {
              if (++calls[0] > 1) throw new AssertionError("second snapshot in one operation");
              return first;
            });
    assertDoesNotThrow(
        () ->
            catalog.prepare(
                object(
                    "cardVersion",
                    first.cardVersion(),
                    "modelVersion",
                    2,
                    "values",
                    object("rental.price", "100", "rental.currency", "BYN"),
                    "platforms",
                    List.of("example"))));
    assertEquals(1, calls[0]);
  }
}
