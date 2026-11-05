package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.ai.*;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.FileReferenceRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.junit.jupiter.api.Test;

class RentalReportedErrorsTest {
  final RentalCatalog catalog = new RentalCatalog(
      new FileReferenceRepository("../data/rental/apartments_long_term_rent"));

  ObjectNode suggestion(String field, String value, String quote) {
    return object("field", field, "value", value, "quote", quote);
  }

  ObjectNode analyze(String source, ObjectNode... suggestions) {
    return RentalAiPolicy.sanitize(catalog.editor(), source,
        object("suggestions", List.of(suggestions)));
  }

  String value(JsonNode result, String field) {
    return list(result.path("suggestions")).stream().filter(s -> text(s, "field").equals(field))
        .map(s -> text(s, "value")).findFirst().orElse("");
  }

  @Test void totalRoomsIncludeSeparateRoomsAndSingleCountPopulatesBoth() {
    String source = "Всего 3 комнаты, из них 2 комнаты раздельные";
    var result = analyze(source,
        suggestion("rental.room_configuration", "2", source),
        suggestion("rental.separate_rooms", "2", source));
    assertEquals("3", value(result, "rental.room_configuration"));
    assertEquals("2", value(result, "rental.separate_rooms"));
    source = "Всего 3 комнаты, из них 2 раздельные";
    result = analyze(source, suggestion("rental.room_configuration", "2", source),
        suggestion("rental.separate_rooms", "2", source));
    assertEquals("3", value(result, "rental.room_configuration"));
    assertEquals("2", value(result, "rental.separate_rooms"));
    for (String field : List.of("rental.room_configuration", "rental.separate_rooms")) {
      result = analyze("Сдам квартиру, 3 комнаты", suggestion(field, "3", "3 комнаты"));
      assertEquals("3", value(result, "rental.room_configuration"));
      assertEquals("3", value(result, "rental.separate_rooms"));
    }
    result = analyze("Сдам студию", suggestion("rental.room_configuration", "studio", "студию"));
    assertEquals("", value(result, "rental.separate_rooms"));
    result = analyze("Сдам двухкомнатную квартиру",
        suggestion("rental.room_configuration", "2", "двухкомнатную квартиру"));
    assertEquals("2", value(result, "rental.separate_rooms"));
  }

  @Test void conflictingRoomCountsAreNotSilentlyReplaced() {
    String source = "Всего 2 комнаты, из них 3 раздельные комнаты";
    var result = analyze(source, suggestion("rental.room_configuration", "2", source),
        suggestion("rental.separate_rooms", "3", source));
    assertEquals("2", value(result, "rental.room_configuration"));
    assertEquals("", value(result, "rental.separate_rooms"));
  }

  @Test void floorAndBuildingHeightRemainDistinctAllTheWayToBrowser() {
    for (String source : List.of("Сдам квартиру, этаж 3 из 9", "Сдам квартиру, 3 этаж из 9", "Сдам квартиру, 3/9 этаж")) {
      var result = analyze(source, suggestion("rental.floor", "3", source),
          suggestion("building.total_floors", "3", source));
      assertEquals("3", value(result, "rental.floor"));
      assertEquals("9", value(result, "building.total_floors"));
    }
    var draft = object("schemaVersion", catalog.version(), "modelVersion", 2,
        "values", object("rental.floor", "3", "building.total_floors", "9", "rental.currency", "BYN",
            "rental.monthly_price", "1500"), "extras", object(), "platforms", List.of("domovita"));
    var controls = list(catalog.browser(draft).path("jobs").get(0).path("controls"));
    var values = new HashMap<String, String>();
    for (var c : controls) values.put(text(c, "field"), text(c, "value"));
    assertEquals("3", values.get("domovita.storey"));
    assertEquals("9", values.get("domovita.storeys"));
    assertEquals("BYN", values.get("domovita.currency"));
  }

  @Test void marketingTextsAreComposedSeparatelyWithStrictLengths() {
    String source = "Сдам квартиру рядом с парком. Есть мебель и стиральная машина.";
    var result = analyze(source,
        suggestion("listing.title", "Жизнь рядом с парком", "рядом с парком"),
        suggestion("listing.short_description", "Квартира у парка с мебелью и техникой для комфортной жизни.", source));
    assertEquals("Жизнь рядом с парком", value(result, "listing.title"));
    assertFalse(value(result, "listing.short_description").isBlank());
    result = analyze(source, suggestion("listing.title", "а".repeat(101), source),
        suggestion("listing.short_description", "а".repeat(501), source));
    assertTrue(result.path("suggestions").isEmpty());
    result = analyze(source, suggestion("listing.title", "а".repeat(100), source),
        suggestion("listing.short_description", "а".repeat(500), source));
    assertEquals(2, result.path("suggestions").size());
  }

  @Test void kufarReceivesAllSixReportedChoiceGroups() {
    var draft = object("schemaVersion", catalog.version(), "modelVersion", 2,
        "values", object("rental.bathroom", "combined", "rental.balcony", "loggia",
            "rental.repair", "euro", "amenity.furniture", "present",
            "amenity.washing_machine", "yes", "amenity.refrigerator", "yes"),
        "extras", object(), "platforms", List.of("kufar"));
    var controls = list(catalog.browser(draft).path("jobs").get(0).path("controls"));
    for (String id : List.of("bathroom", "balcony", "repair", "household_amenities",
        "bathroom_amenities", "kitchen_amenities")) {
      var c = controls.stream().filter(row -> text(row, "field").equals("kufar." + id))
          .findFirst().orElseThrow();
      assertFalse(c.path("value").isNull(), id);
      assertFalse(c.path("labels").isEmpty(), id);
    }
  }

  @Test void bareRublesAreBynButRussianRublesAreNot() {
    for (String quote : List.of("1500 рублей", "1500 руб.", "1 рубль", "2 рубля", "BYN 1500"))
      assertTrue(RentalAiPolicy.currencyGrounded("BYN", quote), quote);
    for (String quote : List.of("1500 российских рублей", "1500 RUB", "1500 рос. руб.")) {
      assertFalse(RentalAiPolicy.currencyGrounded("BYN", quote), quote);
      assertTrue(RentalAiPolicy.currencyGrounded("RUB", quote), quote);
    }
  }

  @Test void spacedBynRentReachesDomovitaPriceAndCurrencyControls() {
    String source = "Стоимость — 1 300 BYN в месяц, коммунальные платежи отдельно. Залог — за один месяц.";
    var analyzed = analyze(source,
        suggestion("rental.monthly_price", "1300", "1 300 BYN в месяц"),
        suggestion("rental.currency", "BYN", "1 300 BYN"));
    assertEquals("1300", value(analyzed, "rental.monthly_price"));
    assertEquals("BYN", value(analyzed, "rental.currency"));
    var draft = object("schemaVersion", catalog.version(), "modelVersion", 2,
        "values", object("rental.monthly_price", value(analyzed, "rental.monthly_price"),
            "rental.currency", value(analyzed, "rental.currency")),
        "extras", object(), "platforms", List.of("domovita"));
    var controls = list(catalog.browser(draft).path("jobs").get(0).path("controls"));
    var price = controls.stream().filter(c -> text(c, "field").equals("domovita.monthly_price")).findFirst().orElseThrow();
    var currency = controls.stream().filter(c -> text(c, "field").equals("domovita.currency")).findFirst().orElseThrow();
    assertEquals("1300", text(price, "value"));
    assertEquals("BYN", text(currency, "value"));
    assertEquals("mousedown", text(currency, "triggerEvent"));
  }

  @Test void domovitaBrowserRecipePreservesAddressContextAndPhotoGate() {
    var draft = object("schemaVersion", catalog.version(), "modelVersion", 2,
        "values", object(), "extras", object(), "platforms", List.of("domovita"),
        "address", object("settlement", "Лесная", "settlementWithType", "д. Лесная",
            "region", "Брестская область", "district", "Ивацевичский район",
            "street", "Мира", "streetWithType", "ул. Мира", "house", "27/1"));
    var controls = list(catalog.browser(draft).path("jobs").get(0).path("controls"));
    var town = controls.stream().filter(c -> text(c, "field").equals("domovita.town")).findFirst().orElseThrow();
    assertEquals("д. Лесная", text(town, "matchValue"));
    assertEquals(List.of("Брестская область", "Ивацевичский район"),
        list(town.path("matchContext")).stream().map(JsonNode::asText).toList());
    assertEquals("display-and-closed", text(town.path("autocomplete"), "confirm"));
    var photos = controls.stream().filter(c -> text(c, "action").equals("files")).findFirst().orElseThrow();
    assertFalse(text(photos, "blockedSelector").isBlank());
    assertFalse(text(photos, "blockedMessage").isBlank());
  }

  @Test void addressComponentsDoNotCarryTypePrefixes() {
    for (String prefix : List.of("г.", "г ", "город ", "пос.", "аг. "))
      assertEquals("Минск", LiteralAddress.cleanComponent(prefix + "Минск", "settlement"));
    for (String prefix : List.of("ул.", "ул ", "улица ", "пер. ", "пр-т ", "наб. "))
      assertEquals("Ленина", LiteralAddress.cleanComponent(prefix + "Ленина", "street"));
    assertEquals("18А", LiteralAddress.cleanComponent("д.18А", "house"));
    assertEquals("Гагарина", LiteralAddress.cleanComponent("Гагарина", "street"));
    assertEquals("Ульяновская", LiteralAddress.cleanComponent("Ульяновская", "street"));
  }
}
