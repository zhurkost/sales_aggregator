package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.ai.RentalAiPolicy;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.CategoryRegistry;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.junit.jupiter.api.Test;

class HouseRentalTest {
  private final CategoryRegistry registry = new CategoryRegistry("../data/rental");
  private final RentalCatalog catalog = new RentalCatalog(registry.require("houses_long_term_rent").references());

  @Test
  void houseSchemaAndPublicationAreScopedToHouseCategory() {
    var editor = catalog.editor();
    assertEquals("houses_long_term_rent", text(editor.path("category"), "id"));
    assertTrue(editor.path("category").toString().contains("house.land_area"));
    assertTrue(editor.path("category").toString().contains("house.heating"));
    assertFalse(editor.path("category").toString().contains("rental.floor"));
    assertTrue(registry.require("houses_long_term_rent").publication());
    assertEquals("house_rental", registry.require("houses_long_term_rent").analysis());
    assertThrows(ApiException.class, () -> catalog.normalize(object("categoryId", "apartments_long_term_rent")));
  }

  @Test
  void mapsHouseAreasLevelsAndPriceWithoutReusingApartmentFields() {
    var values = object("house.kind", "Дом", "rental.monthly_price", "2500", "rental.currency", "BYN",
        "house.rooms", "4", "house.total_area", "120", "house.land_area", "10", "house.levels", "2");
    var prepared = catalog.prepare(object("categoryId", "houses_long_term_rent", "modelVersion", 2,
        "schemaVersion", catalog.version(), "values", values, "platforms", List.of("realt", "kufar", "domovita", "onliner")));
    var realt = platform(prepared, "realt");
    assertEquals("House", text(realt, "realt.object_type"));
    assertEquals(120, realt.path("realt.area.total").asInt());
    assertEquals(10, realt.path("realt.area.ground").asInt());
    assertEquals("933", text(realt, "realt.termsOfDeal.currency"));
    var kufar = platform(prepared, "kufar");
    assertEquals("1020", text(kufar, "kufar.category"));
    assertEquals(2500, kufar.path("kufar.price").asInt());
    assertEquals("BYR", text(kufar, "kufar.currency"));
    assertEquals(10, kufar.path("kufar.size_area").asInt());
    var domovita = platform(prepared, "domovita");
    assertEquals("cottages", text(domovita, "domovita.type"));
    assertEquals("10", text(domovita, "domovita.area_ground"));
    assertEquals("2", text(domovita, "domovita.buiding_levels"));
    assertEquals(2500, platform(prepared, "onliner").path("onliner.price_amount").asInt());
  }

  @Test
  void browserChoosesHouseCottageOrDachaAndNeverAdvancesOrSubmits() {
    for (var kind : List.of("Дом", "Коттедж", "Дача")) {
      var jobs = catalog.browser(object("categoryId", "houses_long_term_rent", "modelVersion", 2,
          "schemaVersion", catalog.version(), "values", object("house.kind", kind, "house.land_area", "10"),
          "platforms", List.of("realt", "kufar", "domovita", "onliner"))).path("jobs");
      assertEquals(4, jobs.size());
      var realt = list(jobs).stream().filter(j -> text(j, "platform").equals("realt")).findFirst().orElseThrow();
      assertEquals(kind, text(realt.path("setup").get(2), "text"));
      assertFalse(realt.toString().contains("textByValue"));
      for (var job : jobs) {
        assertTrue(job.path("next").isEmpty());
        assertTrue(job.path("submit").isEmpty());
      }
    }
    assertThrows(ApiException.class, () -> catalog.browser(object("modelVersion", 2,
        "schemaVersion", catalog.version(), "values", object(), "platforms", List.of("realt"))));
  }

  @Test
  void housePriceCannotBePreparedWithoutCurrencyAndCottageIsNotReplacedByHouse() {
    var prepared = catalog.prepare(object("categoryId", "houses_long_term_rent", "modelVersion", 2,
        "schemaVersion", catalog.version(), "values", object("house.kind", "Коттедж", "rental.monthly_price", "2500"),
        "platforms", List.of("realt", "kufar", "domovita", "onliner")));
    assertFalse(platform(prepared, "realt").has("realt.termsOfDeal.price"));
    assertFalse(platform(prepared, "kufar").has("kufar.price"));
    assertFalse(platform(prepared, "domovita").has("domovita.price"));
    assertFalse(platform(prepared, "onliner").has("onliner.price_amount"));
    assertEquals("Cottage", text(platform(prepared, "realt"), "realt.object_type"));
    assertFalse(platform(prepared, "kufar").has("kufar.house_type_for_rent"));
  }

  @Test
  void houseAnalysisUsesSameAddressRulesAndAcceptsOnlyItsOwnFields() {
    var schema = catalog.analysisSchema();
    var prompt = RentalAiPolicy.prompt(schema, "house_rental");
    assertTrue(prompt.contains("дом целиком на длительный срок"));
    assertTrue(prompt.contains("streetNominative"));
    assertFalse(prompt.contains("Если текст не про сдачу квартиры"));
    String source = "Сдам дом, площадь 120 м², участок 10 соток, 2 уровня.";
    var result = RentalAiPolicy.sanitize(schema, source, object("suggestions", List.of(
        object("field", "house.total_area", "value", "120", "quote", "площадь 120 м²"),
        object("field", "house.land_area", "value", "10", "quote", "участок 10 соток"),
        object("field", "house.levels", "value", "2", "quote", "2 уровня"),
        object("field", "rental.floor", "value", "2", "quote", "2 уровня"))));
    assertEquals(3, result.path("suggestions").size());
    assertEquals(1, result.path("ignored").asInt());
  }

  private JsonNode platform(JsonNode result, String id) {
    return list(result.path("platforms")).stream().filter(p -> text(p, "platform").equals(id))
        .findFirst().orElseThrow().path("values");
  }

  @Test
  void domovitaTransfersEverySharedHouseAmenityWithObservedNativeCodes() {
    var values = object("house.kind", "Дом", "amenity.air_conditioner", true,
        "amenity.internet", true, "amenity.sauna", true, "amenity.garage", true,
        "amenity.fireplace", true, "amenity.pool", true);
    var prepared = catalog.prepare(object("modelVersion", 2, "schemaVersion", catalog.version(),
        "values", values, "platforms", List.of("domovita")));
    var actual = new java.util.HashSet<String>();
    platform(prepared, "domovita").path("domovita.extra_info_comments").forEach(v -> actual.add(v.asText()));
    assertEquals(java.util.Set.of("kondicioner", "internet", "banay", "garage", "fireplace", "pool"), actual);
  }
}
