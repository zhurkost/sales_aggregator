package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.*;
import by.autopost.shared.ApiException;
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
  void ambiguousLookupIsRejectedButExplicitPartialCoverageCannotInventCodes() throws Exception {
    var repo = fixture();
    var plan = read("example.plan.json");
    var conversion = (ObjectNode) plan.path("fields").get(1).path("conversion");
    ((ArrayNode) conversion.path("values")).add(object("from", "BYN", "to", "different"));
    write("example.plan.json", plan);
    assertThrows(ApiException.class, repo::snapshot);
    conversion.set("values", array());
    write("example.plan.json", plan);
    var catalog = new RentalCatalog(repo);
    var result =
        catalog
            .prepare(
                object(
                    "modelVersion",
                    2,
                    "schemaVersion",
                    catalog.version(),
                    "values",
                    object("rental.currency", "BYN"),
                    "platforms",
                    List.of("example")))
            .path("platforms")
            .get(0);
    assertFalse(result.path("values").has("currency"));
    assertFalse(result.path("dataReady").asBoolean());
  }

  @Test
  void malformedNumericTargetsDoNotSilentlyBecomeDecimalNumbers() throws Exception {
    var repo = fixture();
    var plan = read("example.plan.json");
    ((ObjectNode) plan.path("fields").get(0).path("conversion")).put("target", "invented");
    write("example.plan.json", plan);
    assertThrows(ApiException.class, repo::snapshot);
  }

  @TempDir Path dir;
  long timestamp = System.currentTimeMillis();

  FileReferenceRepository fixture() throws Exception {
    try (var paths = Files.list(Path.of("src/test/resources/reference-example"))) {
      for (Path p : paths.toList()) Files.copy(p, dir.resolve(p.getFileName()));
    }
    return new FileReferenceRepository(dir.toString());
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
    var plan = (ObjectNode) read("example.plan.json");
    plan.put("schema_hash", Hashing.sha256(data.toString()));
    write("example.plan.json", plan);
  }

  @Test
  void flatFactsAreAdaptedWithoutChangingSourcesOrLosingCodeTypes() throws Exception {
    var repo = fixture();
    String original = Files.readString(dir.resolve("example.schema.json"));
    var catalog = new RentalCatalog(repo);
    for (String code : List.of("BYN", "USD")) {
      var result =
          catalog
              .prepare(
                  object(
                      "schemaVersion",
                      catalog.version(),
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
    assertEquals(original, Files.readString(dir.resolve("example.schema.json")));
    assertTrue(
        repo.snapshot()
            .schema("example")
            .get(0)
            .path("options")
            .get(0)
            .path("fill_rule")
            .path("required")
            .asBoolean());
  }

  @Test
  void snapshotsAreDefensiveAndCachedUntilFilesChange() throws Exception {
    var repo = fixture();
    var first = repo.snapshot();
    assertSame(first, repo.snapshot());
    ((ObjectNode) first.plan("example")).put("platform", "corrupt");
    assertEquals("example", repo.snapshot().plan("example").path("platform").asText());
    var card = (ObjectNode) read("card.json");
    card.put("editorLabel", "new label");
    write("card.json", card);
    assertNotEquals(first.version(), repo.snapshot().version());
    assertFalse(first.card().has("editorLabel"));
  }

  @Test
  void staleHashesCannotActivatePartiallyUpdatedMappings() throws Exception {
    var repo = fixture();
    repo.snapshot();
    var source = read("example.schema.json");
    ((ObjectNode) source.get(0).path("options").get(0)).put("name", "changed");
    write("example.schema.json", source);
    assertEquals(409, assertThrows(ApiException.class, repo::snapshot).status);
  }

  @Test
  void unknownSourcesAndUnsupportedHandlersFailBeforeEditor() throws Exception {
    var repo = fixture();
    var plan = read("example.plan.json");
    var row = (ObjectNode) plan.path("fields").get(0);
    row.put("common_option_id", "invented.field");
    write("example.plan.json", plan);
    assertThrows(ApiException.class, repo::snapshot);
    row.put("common_option_id", "rental.price");
    ((ObjectNode) row.path("conversion")).put("kind", "javascript");
    write("example.plan.json", plan);
    assertThrows(ApiException.class, repo::snapshot);
  }

  @Test
  void detectsDependencyCyclesAndDanglingConditions() throws Exception {
    var repo = fixture();
    var source = read("example.schema.json");
    var rent = (ObjectNode) source.get(0).path("options").get(0);
    var currency = (ObjectNode) source.get(0).path("options").get(1);
    rent.set("when", object("option_id", "missing", "operator", "exists"));
    schema(source);
    assertThrows(ApiException.class, repo::snapshot);
    rent.set("when", object("option_id", "currency", "operator", "exists"));
    currency.set("when", object("option_id", "rent", "operator", "exists"));
    schema(source);
    assertThrows(ApiException.class, repo::snapshot);
  }

  @Test
  void newSchemaRequiresExplicitCompletenessAndSeparateBinding() throws Exception {
    var repo = fixture();
    var source = read("example.schema.json");
    var currency = (ObjectNode) source.get(0).path("options").get(1);
    currency.remove("options_complete");
    schema(source);
    assertThrows(ApiException.class, repo::snapshot);
    currency.put("options_complete", false);
    schema(source);
    assertDoesNotThrow(repo::snapshot);
    var manifest = read("manifest.json");
    ((ObjectNode) manifest.path("platforms").path("example")).remove("binding");
    write("manifest.json", manifest);
    assertThrows(ApiException.class, repo::snapshot);
  }

  @Test
  void incompleteBindingsAreNotMistakenForReadyAdapters() throws Exception {
    var repo = fixture();
    var binding = read("example.binding.json");
    var row = (ObjectNode) binding.path("fields").get(0);
    row.put("status", "ready");
    write("example.binding.json", binding);
    assertThrows(ApiException.class, repo::snapshot);
    row.put("status", "needs_review");
    write("example.binding.json", binding);
    assertDoesNotThrow(repo::snapshot);
    ((ArrayNode) binding.path("fields")).remove(1);
    write("example.binding.json", binding);
    assertThrows(ApiException.class, repo::snapshot);
  }

  @Test
  void pathsCannotEscapePrivateBundle() throws Exception {
    var repo = fixture();
    var manifest = (ObjectNode) read("manifest.json");
    manifest.put("common", "../outside.json");
    write("manifest.json", manifest);
    assertThrows(ApiException.class, repo::snapshot);
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
                    "schemaVersion",
                    first.version(),
                    "modelVersion",
                    2,
                    "values",
                    object("rental.price", "100", "rental.currency", "BYN"),
                    "platforms",
                    List.of("example"))));
    assertEquals(1, calls[0]);
  }
}
