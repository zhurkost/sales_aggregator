package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.catalog.*;
import by.autopost.rental.application.RentalCatalog;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.junit.jupiter.api.Test;

class PublicationDiagnosticsTest {
  private final RentalCatalog catalog = new RentalCatalog(
      new FileReferenceRepository("../data/rental/apartments_sale"));

  private JsonNode card(JsonNode values) {
    return object("schemaVersion", catalog.version(), "modelVersion", 2,
        "values", values, "extras", object(), "platforms", List.of("realt", "kufar", "domovita", "onliner"));
  }

  @Test
  void caseInsensitiveAliasesNeverGuessBetweenDifferentCodes() {
    var pairs = array(List.of(object("from", "ЛИФТ", "to", 1), object("from", "лифт", "to", 2)));
    assertThrows(IllegalArgumentException.class, () -> by.autopost.rental.preparation.RuleExecutor.lookup(
        pairs, com.fasterxml.jackson.databind.node.TextNode.valueOf("ЛиФт")));
    assertEquals(1, by.autopost.rental.preparation.RuleExecutor.lookup(
        pairs, com.fasterxml.jackson.databind.node.TextNode.valueOf("ЛИФТ")).asInt());
  }

  @Test
  void unsupportedCurrencyMustRemainVisibleInExtensionReport() {
    var result = catalog.browser(card(object("sale.price", "6900000", "sale.currency", "RUB")));
    for (var job : result.path("jobs")) {
      if (text(job, "platform").equals("domovita")) continue;
      assertTrue(job.path("unbound").toString().matches("(?is).*(валют|цен).*"),
          text(job, "platform") + " silently drops the supplied price and currency");
    }
  }

  @Test
  void rentalCurrencyWarningsAreNotLostEither() {
    var rental = new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));
    var card = object("schemaVersion", rental.version(), "modelVersion", 2,
        "values", object("rental.monthly_price", "45000", "rental.currency", "RUB"),
        "extras", object(), "platforms", List.of("realt", "kufar", "onliner"));
    for (var job : rental.browser(card).path("jobs"))
      assertTrue(job.path("unbound").toString().matches("(?is).*(валют|цен|плат).*"), text(job, "platform"));
  }

  @Test
  void identicalAmenityLabelsHaveSameMappingsRegardlessOfCase() {
    for (var label : List.of("лифт", "Лифт")) {
      var result = catalog.prepare(card(object("building.amenities", List.of(label))));
      for (var site : result.path("platforms")) {
        String platform = text(site, "platform");
        if (platform.equals("realt")) assertEquals("[622]", site.path("values").path("realt.additional.appliance").toString(), label);
        if (platform.equals("kufar")) assertEquals("[\"1\"]", site.path("values").path("kufar.flat_building_improvements").toString(), label);
      }
    }
  }

  @Test
  void supportedAmenitiesSurviveAnUnsupportedMember() {
    var result = catalog.prepare(card(object("building.amenities", List.of("Лифт", "интернет"))));
    for (var site : result.path("platforms")) {
      if (!text(site, "platform").equals("kufar")) continue;
      assertEquals("[\"1\"]", site.path("values").path("kufar.flat_building_improvements").toString());
      assertTrue(site.path("issues").toString().contains("kufar.flat_building_improvements"));
    }
  }

  @Test
  void twoBathroomsMapsToRealtTwoOrMore() {
    var result = catalog.prepare(card(object("apartment.bathroom", "Два")));
    for (var site : result.path("platforms")) {
      if (!text(site, "platform").equals("realt")) continue;
      assertEquals(2, site.path("values").path("realt.apartment.toilet").asInt(-1));
    }
  }

  @Test
  void rentalStoveHasARealBrowserControl() {
    var rental = new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));
    var card = object("schemaVersion", rental.version(), "modelVersion", 2,
        "values", object("amenity.stove_type", "electric"), "extras", object(), "platforms", List.of("realt"));
    var controls = rental.browser(card).path("jobs").get(0).path("controls");
    assertTrue(list(controls).stream().anyMatch(c -> text(c, "field").equals("realt.stove") && c.path("value").asInt(-1) == 1));
  }

  @Test
  void editorDoesNotOfferTheSameAmenityTwice() {
    var choices = catalog.editor().path("canonicalValues").path("building.amenities");
    var normalized = new java.util.HashSet<String>();
    for (var choice : choices)
      assertTrue(normalized.add(choice.asText().toLowerCase(java.util.Locale.ROOT).replace('ё', 'е')), choice.asText());
  }
}
