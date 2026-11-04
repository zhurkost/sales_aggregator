package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import by.autopost.rental.application.*;
import by.autopost.rental.catalog.*;
import by.autopost.rental.persistence.JdbcRentalDraftRepository;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class RentalPublicationTest {
  @TempDir Path dir;

  final RentalCatalog catalog =
      new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));

  ObjectNode partial() {
    return object(
        "cardVersion",
        catalog.cardVersion(),
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
      var prepared =
          list(check.path("platforms")).stream()
              .filter(p -> text(p, "platform").equals(text(job, "platform")))
              .findFirst()
              .orElseThrow();
      assertEquals(prepared.path("dataReady"), job.path("dataReady"), text(job, "platform"));
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
  void browserAddressKeepsTypesAndRegionalContextForUnambiguousSuggestions() {
    var draft = partial();
    ((ObjectNode) draft.path("address"))
        .put("settlement", "г Минск")
        .put("street", "ул Ольшевского")
        .put("region", "Минская обл")
        .put("district", "Минский р-н");
    var job =
        list(catalog.browser(draft).path("jobs")).stream()
            .filter(j -> text(j, "platform").equals("realt"))
            .findFirst()
            .orElseThrow();
    var city =
        list(job.path("controls")).stream()
            .filter(c -> text(c, "field").equals("realt.settlement"))
            .findFirst()
            .orElseThrow();
    assertEquals("г Минск", text(city, "value"));
    assertEquals("Минская обл", city.path("matchContext").get(0).asText());
    assertEquals("Минский р-н", city.path("matchContext").get(1).asText());
    assertEquals("value-and-closed", text(city.path("autocomplete"), "confirm"));
  }

  @Test
  void cityRegionFromDadataDoesNotRejectTheCitySuggestion() {
    for (String region : List.of("г Минск", "г. Минск", "город Минск")) {
      var draft = partial();
      draft.set(
          "address",
          object(
              "provider",
              "dadata",
              "sourceId",
              "way:25439815",
              "label",
              "г Минск, ул Брикета, д 18",
              "countryIso",
              "BY",
              "region",
              region,
              "district",
              "",
              "settlement",
              "г Минск",
              "street",
              "ул Брикета",
              "house",
              "18",
              "block",
              "",
              "blockType",
              "",
              "precision",
              "0",
              "confirmed",
              false,
              "level",
              "house",
              "longitude",
              "27.4150416",
              "latitude",
              "53.908548"));
      var addressBefore = draft.path("address").deepCopy();
      var job =
          list(catalog.browser(draft).path("jobs")).stream()
              .filter(j -> text(j, "platform").equals("realt"))
              .findFirst()
              .orElseThrow();
      var controls = list(job.path("controls"));
      var city =
          controls.stream()
              .filter(c -> text(c, "field").equals("realt.settlement"))
              .findFirst()
              .orElseThrow();
      assertFalse(city.has("matchContext"), "City-region is already checked against primary label");
      assertEquals("г Минск", text(city, "value"));
      assertTrue(
          controls.stream()
              .anyMatch(
                  c ->
                      text(c, "field").equals("realt.street")
                          && text(c, "value").equals("ул Брикета")));
      assertTrue(
          controls.stream()
              .anyMatch(
                  c ->
                      text(c, "field").equals("realt.house_number")
                          && text(c, "value").equals("18")));
      assertEquals(addressBefore, draft.path("address"));
    }
  }

  @Test
  void onlySavedSnapshotInOwnWorkspaceCanBeLaunched() {
    var drafts = mock(RentalDraftService.class);
    var service = new RentalPublicationService(drafts, catalog);
    var draft = partial();
    String id = UUID.randomUUID().toString();
    when(drafts.get("owner", id))
        .thenReturn(object("id", id, "revision", 3, "draft", draft.deepCopy()));
    when(drafts.get("other", id)).thenThrow(new ApiException(404, "Не найдено"));
    var request = object("id", id, "draft", draft);
    assertEquals(3, service.configuration("owner", request).path("revision").asInt());
    assertThrows(ApiException.class, () -> service.configuration("other", request));
    ((ObjectNode) request.path("draft").path("values"))
        .put("listing.description", "Изменено после сохранения");
    assertThrows(ApiException.class, () -> service.configuration("owner", request));
  }

  @Test
  void savedCardOfAnOldModelIsNeverPublished() {
    var drafts =
        new RentalDraftService(
            new JdbcRentalDraftRepository(
                new JdbcTemplate(
                    new DriverManagerDataSource("jdbc:sqlite:" + dir.resolve("drafts.sqlite")))));
    var old = partial();
    old.remove("modelVersion");
    String id = UUID.randomUUID().toString();
    drafts.save("owner", id, object("revision", 0, "draft", old));
    var service = new RentalPublicationService(drafts, catalog);
    var error =
        assertThrows(
            ApiException.class,
            () -> service.configuration("owner", object("id", id, "draft", old)));
    assertEquals(409, error.status);
    assertEquals("Карточку нужно перенести командой миграции.", error.getMessage());
    assertThrows(ApiException.class, () -> catalog.browser(old));
  }

  @Test
  void browserRecipeRejectsKeysAndTypesTheExtensionDoesNotRead() {
    var snapshot =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot();
    Map<String, java.util.function.Consumer<ObjectNode>> unknown =
        Map.of(
            "selectedClas",
            r -> control(r, 9).put("selectedClas", "chip__filled-green"),
            "observedAt",
            r -> r.put("observedAt", "2026-11-02"),
            "optionsSelector",
            r -> control(r, 0).put("optionsSelector", "[role=option]"),
            "matchText",
            r -> ((ObjectNode) r.path("submit").get(0)).put("matchText", false),
            "script",
            r -> ((ObjectNode) r.path("ready").get(0)).put("script", "alert(1)"));
    for (var edit : unknown.entrySet()) {
      var recipe = (ObjectNode) snapshot.browser("kufar").deepCopy();
      edit.getValue().accept(recipe);
      var error =
          assertThrows(
              ApiException.class,
              () ->
                  new BrowserRecipeValidator().validate("kufar", snapshot.schema("kufar"), recipe),
              edit.getKey());
      assertTrue(
          error.getMessage().contains("неизвестный ключ " + edit.getKey()), error.getMessage());
    }
    List<java.util.function.Consumer<ObjectNode>> mistyped =
        List.of(
            r -> ((ObjectNode) r.path("ready").get(0)).put("absent", "yes"),
            r -> control(r, 9).put("selectedClass", "chip filled"),
            r -> control(r, 9).put("label", ""),
            r -> control(r, 23).set("uiLabels", object("BYR", 1)),
            r -> control(r, 23).put("displaySelector", ""),
            r -> ((ObjectNode) r.path("setup").get(0)).put("matchText", "false"));
    for (var edit : mistyped) {
      var recipe = (ObjectNode) snapshot.browser("kufar").deepCopy();
      edit.accept(recipe);
      assertThrows(
          ApiException.class,
          () -> new BrowserRecipeValidator().validate("kufar", snapshot.schema("kufar"), recipe));
    }
  }

  @Test
  void richTextInAnIframeIsAKnownActionWithoutExtraKeys() {
    var snapshot =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot();
    var recipe = (ObjectNode) snapshot.browser("realt").deepCopy();
    var description =
        object(
            "field",
            "realt.description",
            "action",
            "iframe_richtext",
            "selector",
            "[id=\"description.description_ifr\"]");
    var controls = (com.fasterxml.jackson.databind.node.ArrayNode) recipe.path("controls");
    for (int i = controls.size() - 1; i >= 0; i--)
      if (text(controls.get(i), "field").equals("realt.description")) controls.remove(i);
    controls.add(description);
    assertDoesNotThrow(
        () -> new BrowserRecipeValidator().validate("realt", snapshot.schema("realt"), recipe));
    description.put("frameSelector", "body#tinymce");
    var error =
        assertThrows(
            ApiException.class,
            () -> new BrowserRecipeValidator().validate("realt", snapshot.schema("realt"), recipe));
    assertTrue(error.getMessage().contains("неизвестный ключ frameSelector"), error.getMessage());
  }

  static ObjectNode control(ObjectNode recipe, int index) {
    return (ObjectNode) recipe.path("controls").get(index);
  }

  @Test
  void browserContractRejectsUnknownFieldsAndExecutableActions() {
    var snapshot =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot();
    var recipe = (ObjectNode) snapshot.browser("kufar").deepCopy();
    ((ObjectNode) recipe.path("controls").get(0)).put("action", "eval");
    assertThrows(
        ApiException.class,
        () -> new BrowserRecipeValidator().validate("kufar", snapshot.schema("kufar"), recipe));
    var other = (ObjectNode) snapshot.browser("kufar").deepCopy();
    ((ObjectNode) other.path("controls").get(0)).put("field", "unknown");
    assertThrows(
        ApiException.class,
        () -> new BrowserRecipeValidator().validate("kufar", snapshot.schema("kufar"), other));
    var invalidAddress = (ObjectNode) snapshot.browser("realt").deepCopy();
    ((ObjectNode) invalidAddress.path("controls").get(0).path("autocomplete"))
        .put("optionSelector", "");
    assertThrows(
        ApiException.class,
        () ->
            new BrowserRecipeValidator()
                .validate("realt", snapshot.schema("realt"), invalidAddress));
  }
}
