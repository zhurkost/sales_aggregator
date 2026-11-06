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
    return RentalAiPolicy.sanitize(catalog.analysisSchema(), source,
        object("suggestions", List.of(suggestions)));
  }

  String value(JsonNode result, String field) {
    return list(result.path("suggestions")).stream().filter(s -> text(s, "field").equals(field))
        .map(s -> text(s, "value")).findFirst().orElse("");
  }

  @Test void kufarBynBalconyDepositAndContactReachNativeControls() {
    var draft = object("schemaVersion", catalog.version(), "modelVersion", 2,
        "values", object("rental.currency", "BYN", "rental.monthly_price", "1300",
            "rental.balcony", "balcony", "rental.prepayment", "deposit_unspecified",
            "contact.communication_method", "calls_and_messages"),
        "extras", object(), "platforms", List.of("kufar"));
    var controls = list(catalog.browser(draft).path("jobs").get(0).path("controls"));
    for (var expected : Map.of("currency", "BYR", "price", "1300", "balcony", "1",
        "prepayment", "25", "contact_method", "0").entrySet()) {
      var c = controls.stream().filter(row -> text(row,"field").equals("kufar." + expected.getKey()))
          .findFirst().orElseThrow();
      if (expected.getKey().equals("price")) assertEquals(1300, c.path("value").decimalValue().intValueExact());
      else assertEquals(expected.getValue(), text(c,"value"));
    }
  }

  @Test void internetReachesKufarUnlessWifiIsExplicitlyDisabled() {
    var values = object("amenity.internet", "yes");
    var card = object("schemaVersion", catalog.version(), "modelVersion", 2,
        "values", values, "extras", object(), "platforms", List.of("kufar"));
    var controls = list(catalog.browser(card).path("jobs").get(0).path("controls"));
    assertTrue(controls.stream().anyMatch(c -> text(c, "field").equals("kufar.household_amenities")
        && c.path("value").toString().equals("[\"1\"]")));
    ((ObjectNode) card.get("values")).put("amenity.wifi", false);
    controls = list(catalog.browser(card).path("jobs").get(0).path("controls"));
    assertFalse(controls.stream().anyMatch(c -> text(c, "field").equals("kufar.household_amenities")));
  }

  @Test void allKufarCurrenciesAreExplicitAndUnsupportedRubDoesNotTransferPrice() {
    for (var entry : Map.of("BYN","BYR", "USD","USD", "EUR","EUR", "RUB", "").entrySet()) {
      var draft = object("schemaVersion", catalog.version(), "modelVersion", 2,
          "values", object("rental.currency", entry.getKey(), "rental.monthly_price", "1300"),
          "extras", object(), "platforms", List.of("kufar"));
      var controls = list(catalog.browser(draft).path("jobs").get(0).path("controls"));
      var currency = controls.stream().filter(c -> text(c,"field").equals("kufar.currency")).findFirst();
      var price = controls.stream().filter(c -> text(c,"field").equals("kufar.price")).findFirst();
      if (entry.getValue().isEmpty()) {
        assertTrue(currency.isEmpty()); assertTrue(price.isEmpty());
      } else {
        assertEquals(entry.getValue(), text(currency.orElseThrow(),"value"));
        assertEquals(1300, price.orElseThrow().path("value").decimalValue().intValueExact());
      }
    }
  }

  @Test void depositIsNotAdvanceRentAndGenericStoveHasNoFuelType() {
    String source = "Есть холодильник, плита и микроволновка. Залог — за один месяц.";
    var result = analyze(source, suggestion("amenity.stove_type", "gas", "плита"),
        suggestion("rental.prepayment", "months_1", "Залог — за один месяц"));
    assertEquals("", value(result,"amenity.stove_type"));
    assertEquals("deposit_unspecified", value(result,"rental.prepayment"));
    for (String quote : List.of("Газовая плита", "Плита газовая"))
      assertEquals("gas", value(analyze(quote,suggestion("amenity.stove_type","gas",quote)),"amenity.stove_type"));
    for (String quote : List.of("Электрическая плита", "Электроплита"))
      assertEquals("electric", value(analyze(quote,suggestion("amenity.stove_type","electric",quote)),"amenity.stove_type"));
    for (String quote : List.of("Без газовой плиты", "Нет газовой плиты"))
      assertEquals("", value(analyze(quote,suggestion("amenity.stove_type","gas",quote)),"amenity.stove_type"));
    assertEquals("", value(analyze("Без залога", suggestion("rental.prepayment","none","Без залога")), "rental.prepayment"));
    assertEquals("none", value(analyze("Без предоплаты", suggestion("rental.prepayment","none","Без предоплаты")), "rental.prepayment"));
    String quote = "Предоплата за один месяц";
    assertEquals("months_1", value(analyze(quote,suggestion("rental.prepayment","months_1",quote)),"rental.prepayment"));
    quote = "Без залога";
    assertEquals("", value(analyze(quote,suggestion("rental.prepayment","deposit_unspecified",quote)),"rental.prepayment"));
  }

  @Test void threeRoomsTwoSeparateAndGroupedRentSurvivePreparationOnAllSites() {
    String source = "Трёхкомнатная квартира, из них 2 изолированные комнаты. Этаж 4 из 9. Аренда 1 750 рублей в месяц.";
    var result = analyze(source, suggestion("rental.room_configuration","2","2 изолированные комнаты"),
        suggestion("rental.separate_rooms","2","2 изолированные комнаты"),
        suggestion("rental.monthly_price","1750","1 750 рублей в месяц"),
        suggestion("rental.currency","BYN","рублей"), suggestion("building.total_floors","9","Этаж 4 из 9."));
    assertAll(() -> assertEquals("1750", value(result, "rental.monthly_price")),
        () -> assertEquals("3", value(result, "rental.room_configuration")),
        () -> assertEquals("2", value(result, "rental.separate_rooms")),
        () -> assertEquals("9", value(result, "building.total_floors")));
    var values = object();
    for (var item : result.path("suggestions")) values.set(text(item, "field"), item.path("value"));
    var sites = Map.of("kufar", "price", "domovita", "monthly_price", "realt", "monthly_rent", "onliner", "price_amount");
    var jobs = catalog.browser(object("values", values, "modelVersion", 2, "schemaVersion", catalog.version(),
        "extras", object(), "platforms", sites.keySet())).path("jobs");
    assertEquals(4, jobs.size());
    for (var job : jobs) {
      String site = text(job, "platform"), price = site + "." + sites.get(site);
      assertTrue(list(job.path("controls")).stream().anyMatch(c -> text(c,"field").equals(price)
          && c.path("value").asDouble() == 1750), site);
    }
  }

  @Test void fractionalRentSurvivesAnalysisAndOnlyGoesToCompatiblePlatforms() {
    String quote = "Ежемесячная плата 990,50 BYN";
    var result = analyze(quote, suggestion("rental.monthly_price", "990.50", quote),
        suggestion("rental.currency", "BYN", quote));
    assertEquals("990.5", value(result, "rental.monthly_price"));
    var fields = object("rental.monthly_price", value(result, "rental.monthly_price"), "rental.currency", "BYN");
    var prices = Map.of("kufar","kufar.price", "onliner","onliner.price_amount",
        "domovita","domovita.monthly_price", "realt","realt.monthly_rent");
    var jobs = catalog.browser(object("values",fields,"schemaVersion",catalog.version(),"modelVersion",2,
        "extras",object(),"platforms",prices.keySet())).path("jobs");
    assertEquals(4, jobs.size());
    for (var job : jobs) {
      String site = text(job,"platform");
      var price = list(job.path("controls")).stream().filter(c -> text(c,"field").equals(prices.get(site))).findFirst();
      if (site.equals("kufar") || site.equals("onliner")) assertEquals(990.5, price.orElseThrow().path("value").asDouble());
      else assertTrue(price.isEmpty(), site);
    }
  }

  @Test void cityAndHeightComeFromTheListingEvenWhenWrittenInProse() {
    String source = "В Витебске сдаётся однокомнатная квартира на длительный срок, ул. Ленина, дом 12А.";
    var addr = object("label","Витебск, ул. Ленина, дом 12А","quote","Витебск, ул. Ленина, дом 12А",
        "settlementNominative","Витебск","streetNominative","Ленина");
    var actual = RentalAiPolicy.sanitize(catalog.analysisSchema(), source, object("address", addr)).path("address");
    assertEquals("Витебск", text(actual, "settlement"));
    assertEquals("Ленина", LiteralAddress.cleanComponent(text(actual,"street"),"street"));
    assertEquals("12А", text(actual, "house"));
    var mogilev = LiteralAddress.parse("в Могилёве, проспект Мира, дом 10",
        object("settlement","в Могилёве","settlementNominative","Могилёв"));
    assertEquals("Могилёв", text(mogilev,"settlement"));

    source = "На 3-м этаже пятиэтажного дома. Из окна виден девятиэтажный дом.";
    var result = analyze(source, suggestion("rental.floor", "3", "На 3-м этаже"));
    assertEquals("5", value(result, "building.total_floors"));
    assertEquals("3", value(result, "rental.floor"));
    result = analyze(source, suggestion("listing.title", "Светлая квартира в центре", source));
    assertTrue(result.path("suggestions").isEmpty());
  }

  @Test void bareCityStartingWithKIsNotABuildingBlock() {
    var parsed = LiteralAddress.parse("Кобрин, ул. Пушкина 7",
        object("settlement","Кобрин", "street","ул. Пушкина", "house","7"));
    LiteralAddress.cleanComponents(parsed);
    assertEquals("", text(parsed, "block"));
    assertEquals("Кобрин", text(parsed, "settlement"));
    assertEquals("Пушкина", text(parsed, "street"));
    assertEquals("7", text(parsed, "house"));
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
    result = analyze("Одна комната", suggestion("rental.room_configuration","1","Одна комната"));
    assertEquals("1", value(result, "rental.separate_rooms"));
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

  @Test void writtenRoomCountsKeepIsolatedAndWalkThroughRoomsDistinct() {
    String source = "Трёхкомнатная квартира. Из трёх комнат две изолированные, одна проходная.";
    var result = analyze(source, suggestion("rental.room_configuration", "3", source),
        suggestion("rental.separate_rooms", "3", source));
    assertEquals("2", value(result, "rental.separate_rooms"));
    assertEquals("3", value(result, "rental.room_configuration"));
    assertEquals("true", value(result, "rental.walk_through_room"));
    source = "Три комнаты, из них одна раздельная и две проходные.";
    result = analyze(source, suggestion("rental.room_configuration", "3", source));
    assertEquals("1", value(result, "rental.separate_rooms"));
    assertEquals("true", value(result, "rental.walk_through_room"));
    source = "Трёхкомнатная квартира. Одна проходная.";
    result = analyze(source, suggestion("rental.room_configuration", "3", source));
    assertEquals("", value(result, "rental.separate_rooms"));
    source = "Трёхкомнатная квартира. Две раздельные кровати.";
    result = analyze(source, suggestion("rental.room_configuration", "3", source));
    assertNotEquals("2", value(result, "rental.separate_rooms"));
  }

  @Test void studioKeepsCityBeforeColonWrittenFloorAndExplicitlyAbsentBalcony() {
    String source = "Сдам квартиру в Лиде: ул. Победы, дом 5. Это студия 29,5 м² на первом этаже, всего в доме 4 этажа. Балкона нет.";
    var analyzed = RentalAiPolicy.sanitize(catalog.analysisSchema(), source,
        object("suggestions", List.of(suggestion("rental.room_configuration","studio","студия")),
            "address",object("label","ул. Победы, дом 5","quote","ул. Победы, дом 5",
                "street","ул. Победы","settlementNominative","Лида")));
    assertEquals("Лида", text(analyzed.path("address"), "settlement"));
    assertEquals("1", value(analyzed,"rental.floor"));
    assertEquals("none", value(analyzed,"rental.balcony"));
    source = "Это студия. На первом этаже магазин. Балкона нет. Есть лоджия.";
    var other = analyze(source, suggestion("rental.room_configuration","studio","студия"),
        suggestion("rental.floor","1","На первом этаже магазин"));
    assertEquals("", value(other,"rental.floor"));
    assertEquals("", value(other,"rental.balcony"));
  }

  @Test void genitiveStreetNamesRetainTheSurname() {
    for (String raw : List.of("ул. Горького", "Горького")) {
      var address = LiteralAddress.parse("Гродно, ул. Горького, дом 34",
          object("street", raw, "streetNominative", "Горькая"));
      assertEquals("Горького", LiteralAddress.cleanComponent(text(address, "street"), "street"));
    }
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
    assertEquals("Минск Брикета 18", LiteralAddress.searchText(
        object("label", "г. минск, ул. брикета, д. 18")));
    assertEquals("Зеленый Бор Карла Маркса 18А", LiteralAddress.searchText(
        object("label", "пос. зеленый бор, ул. карла маркса, дом 18а")));
  }
}
