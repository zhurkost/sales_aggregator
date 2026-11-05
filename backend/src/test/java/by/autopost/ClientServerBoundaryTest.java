package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.ai.RentalAiPolicy;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.FileReferenceRepository;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class ClientServerBoundaryTest {
  private final RentalCatalog catalog =
      new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));

  @Test
  void editorContractContainsNoExecutablePlansOrDomainConditions() {
    var editor = catalog.editor();
    assertTrue(editor.path("serverApplicability").asBoolean());
    assertFalse(editor.path("category").path("options").isEmpty());
    assertFalse(editor.path("canonicalValues").isEmpty());
    assertEquals(4, editor.path("platforms").size());
    assertNoRules(editor);
  }

  private void assertNoRules(JsonNode node) {
    Set<String> forbidden =
        Set.of(
            "rules",
            "bindings",
            "constants",
            "conversion",
            "fill_rule",
            "uiWhen",
            "when",
            "browser",
            "addressProjection",
            "expandedGroups");
    if (node.isObject())
      node.fieldNames().forEachRemaining(key -> assertFalse(forbidden.contains(key), key));
    for (var child : node) assertNoRules(child);
  }

  @Test
  void aiUsesItsOwnSchemaAndRetainsNumericValidation() {
    var schema = catalog.analysisSchema();
    assertFalse(schema.path("platforms").path("kufar").path("rules").isEmpty());
    var fields = RentalAiPolicy.fields(schema);
    assertEquals("number", fields.get("rental.total_area").path("type").asText());
    assertFalse(schema.toString().contains("choiceLabels"));
    assertFalse(schema.toString().contains("expandedGroups"));
  }

  @Test
  void applicabilityIgnoresClientSuppliedPlansAndRequiresCurrentSchema() {
    var draft =
        object(
            "modelVersion",
            2,
            "schemaVersion",
            catalog.version(),
            "platforms",
            List.of("kufar"),
            "values",
            object("rental.room_configuration", "2"),
            "extras",
            object());
    var expected = catalog.applicability(draft);
    draft.set("rules", array(List.of(object("conversion", "forged"))));
    draft.set("constants", object("rooms", "forged"));
    draft.set("applicability", object("forged", true));
    assertEquals(expected, catalog.applicability(draft));
    assertEquals(catalog.version(), expected.path("schemaVersion").asText());
    assertFalse(expected.path("platforms").path("kufar").isEmpty());
    draft.put("schemaVersion", "old");
    assertEquals(409, assertThrows(ApiException.class, () -> catalog.applicability(draft)).status);
  }
}
