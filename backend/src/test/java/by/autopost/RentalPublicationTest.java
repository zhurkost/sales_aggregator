package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import by.autopost.rental.application.*;
import by.autopost.rental.catalog.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.junit.jupiter.api.Test;

class RentalPublicationTest {
  final RentalCatalog catalog =
      new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));

  ObjectNode partial() {
    return object(
        "schemaVersion",
        catalog.version(),
        "modelVersion",
        2,
        "values",
        object(
            "listing.description",
            "Сдам квартиру на длительный срок",
            "rental.monthly_rent",
            "0",
            "rental.currency",
            "BYN"),
        "extras",
        object(),
        "platforms",
        List.of("kufar", "onliner", "realt", "domovita"),
        "address",
        object(
            "label",
            "Минск, Ленина, 10",
            "settlement",
            "Минск",
            "street",
            "Ленина",
            "house",
            "10",
            "confirmed",
            true));
  }

  @Test
  void missingRequiredFieldsDoNotBlockAnySelectedPlatformAndAddressesAreQueriesNotCodes() {
    var draft = partial();
    var check = catalog.prepare(draft);
    assertTrue(
        list(check.path("platforms")).stream().anyMatch(p -> !p.path("dataReady").asBoolean()));
    var launch = catalog.browser(draft);
    assertEquals(4, launch.path("jobs").size());
    for (var job : launch.path("jobs")) {
      assertTrue(text(job, "startUrl").startsWith("https://"));
      var controls = list(job.path("controls"));
      assertTrue(controls.stream().anyMatch(c -> text(c, "action").equals("files")));
      assertTrue(
          controls.stream()
              .anyMatch(c -> c.has("addressPart") && text(c, "value").contains("Минск")));
      assertFalse(
          controls.stream()
              .anyMatch(c -> text(c, "name").equals("Телефон") && text(c, "value").isBlank()));
    }
  }

  @Test
  void onlySavedSnapshotInOwnWorkspaceCanBeLaunched() {
    var drafts = mock(RentalDraftService.class);
    var service = new RentalPublicationService(drafts, catalog);
    var draft = partial();
    String id = UUID.randomUUID().toString();
    when(drafts.get("owner", id))
        .thenReturn(object("id", id, "revision", 3, "draft", catalog.normalize(draft)));
    when(drafts.get("other", id)).thenThrow(new ApiException(404, "Не найдено"));
    var request = object("id", id, "draft", draft);
    assertEquals(3, service.configuration("owner", request).path("revision").asInt());
    assertThrows(ApiException.class, () -> service.configuration("other", request));
    ((ObjectNode) request.path("draft").path("values"))
        .put("listing.description", "Изменено после сохранения");
    assertThrows(ApiException.class, () -> service.configuration("owner", request));
  }

  @Test
  void browserContractRejectsUnknownFieldsAndExecutableActions() {
    var snapshot =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot();
    var recipe = (ObjectNode) snapshot.browser("kufar");
    ((ObjectNode) recipe.path("controls").get(0)).put("action", "eval");
    assertThrows(
        ApiException.class,
        () -> new BrowserRecipeValidator().validate("kufar", snapshot.schema("kufar"), recipe));
    var other = (ObjectNode) snapshot.browser("kufar");
    ((ObjectNode) other.path("controls").get(0)).put("field", "unknown");
    assertThrows(
        ApiException.class,
        () -> new BrowserRecipeValidator().validate("kufar", snapshot.schema("kufar"), other));
  }
}
