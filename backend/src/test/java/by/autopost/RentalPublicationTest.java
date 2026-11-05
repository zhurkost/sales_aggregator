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
    assertEquals("Минск", text(city, "value"));
    assertEquals("г Минск", text(city, "matchValue"));
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
      assertEquals("Минск", text(city, "value"));
      assertTrue(
          controls.stream()
              .anyMatch(
                  c ->
                      text(c, "field").equals("realt.street")
                          && text(c, "value").equals("Брикета")
                          && text(c, "matchValue").equals("ул Брикета")));
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
  void manualStreetCorrectionDoesNotReuseStaleType() {
    var draft = partial();
    ((ObjectNode) draft.path("address"))
        .put("street", "пер Брикета")
        .put("streetWithType", "ул Брикета");
    var job = list(catalog.browser(draft).path("jobs")).stream()
        .filter(j -> text(j, "platform").equals("realt")).findFirst().orElseThrow();
    var street = list(job.path("controls")).stream()
        .filter(c -> text(c, "field").equals("realt.street")).findFirst().orElseThrow();
    assertEquals("Брикета", text(street, "value"));
    assertEquals("пер Брикета", text(street, "matchValue"));
  }

  @Test
  void singleAddressBoxesUseCapitalizedWordsWithoutTypesOrCommas() {
    for (var input : List.of(
        object("settlement", "г. минск", "street", "ул. брикета", "house", "д. 18", "block", ""),
        object("settlement", "пос. зеленый бор", "street", "ул. карла маркса", "house", "дом 18а", "block", "корп. 2"))) {
      var draft = partial();
      var address = (ObjectNode) draft.path("address");
      address.setAll(input);
      address.put("label", text(input, "settlement") + ", " + text(input, "street") + ", "
          + text(input, "house") + " " + text(input, "block"));
      var before = address.deepCopy();
      String expected = text(input, "settlement").contains("минск")
          ? "Минск Брикета 18" : "Зеленый Бор Карла Маркса 18А 2";
      var jobs = list(catalog.browser(draft).path("jobs"));
      for (String site : List.of("kufar", "onliner")) {
        var job = jobs.stream().filter(j -> text(j, "platform").equals(site)).findFirst().orElseThrow();
        var control = list(job.path("controls")).stream()
            .filter(c -> text(c, "addressPart").equals("label")).findFirst().orElseThrow();
        assertEquals(expected, text(control, "value"), site);
        assertEquals(text(before, "label"), text(control, "matchValue"));
      }
      assertEquals(before, draft.path("address"));
    }
  }

  @Test
  void singleAddressQueryDoesNotMatchAStaleLabelAfterManualCorrection() {
    var draft = partial();
    ((ObjectNode) draft.path("address")).put("street", "Брикета").put("house", "18");
    for (var job : catalog.browser(draft).path("jobs")) {
      for (var control : job.path("controls")) {
        if (!text(control, "addressPart").equals("label")) continue;
        assertEquals("Минск Брикета 18", text(control, "value"));
        assertFalse(control.has("matchValue"));
      }
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
    var invalidAddress = (ObjectNode) snapshot.browser("realt");
    ((ObjectNode) invalidAddress.path("controls").get(0).path("autocomplete"))
        .put("optionSelector", "");
    assertThrows(
        ApiException.class,
        () ->
            new BrowserRecipeValidator()
                .validate("realt", snapshot.schema("realt"), invalidAddress));
  }
}
