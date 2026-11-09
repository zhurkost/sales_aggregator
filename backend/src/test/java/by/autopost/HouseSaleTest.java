package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.ai.RentalAiPolicy;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.CategoryRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

class HouseSaleTest {
  private final CategoryRegistry registry = new CategoryRegistry("../data/rental");
  private final RentalCatalog catalog = new RentalCatalog(registry.require("houses_sale").references());
  private JsonNode card(JsonNode values) {
    return object("categoryId", "houses_sale", "modelVersion", 2, "schemaVersion", catalog.version(),
        "values", values, "platforms", List.of("realt", "kufar", "domovita", "onliner"));
  }
  private JsonNode values(JsonNode result, String platform) {
    return list(result.path("platforms")).stream().filter(p -> text(p,"platform").equals(platform))
        .findFirst().orElseThrow().path("values");
  }
  @Test void mapsSalePriceAreasAndHouseFactsToEveryPlatform() {
    var result = catalog.prepare(card(object("house.kind","Коттедж", "sale.price","245000", "sale.currency","BYN",
        "house.total_area","160", "house.living_area","90", "house.kitchen_area","18", "house.land_area","12",
        "house.levels","2", "house.building_year","2015", "house.rooms","4", "house.bedrooms","3")));
    assertEquals("house_sale", registry.require("houses_sale").analysis());
    assertTrue(registry.require("houses_sale").publication());
    assertEquals("Cottage", text(values(result,"realt"),"realt.object_type"));
    assertEquals(3, values(result,"realt").path("realt.apartment.rooms").asInt());
    assertEquals("sell",text(values(result,"kufar"),"kufar.type"));
    assertEquals("5",text(values(result,"kufar"),"kufar.house_type_for_sell"));
    assertEquals("BYR",text(values(result,"kufar"),"kufar.currency"));
    assertEquals(245000,values(result,"kufar").path("kufar.price").asInt());
    assertEquals("2",text(values(result,"kufar"),"kufar.house_number_floors"));
    assertEquals("sale",text(values(result,"domovita"),"domovita.action"));
    assertEquals("cottages",text(values(result,"domovita"),"domovita.type"));
    assertEquals(3,values(result,"domovita").path("domovita.object_type").asInt());
    assertEquals("4",text(values(result,"domovita"),"domovita.rooms"));
    assertEquals("245000",text(values(result,"domovita"),"domovita.price"));
    assertEquals(245000,values(result,"onliner").path("onliner.price.amount").asInt());
    assertEquals(160,values(result,"onliner").path("onliner.area.total").asInt());
    assertFalse(values(result,"onliner").has("onliner.floor"));
    assertFalse(result.toString().contains("monthly_price"));
  }
  @Test void saleRoutesNeverAdvanceOrSubmitAndDachaUsesItsOwnDomovitaForm() {
    for(var kind:List.of("Дом","Коттедж","Дача")) {
      var result=catalog.browser(card(object("house.kind",kind)));
      assertEquals(4,result.path("jobs").size());
      for(var j:result.path("jobs")) {
        assertTrue(j.path("next").isEmpty()); assertTrue(j.path("submit").isEmpty());
        if(text(j,"platform").equals("realt"))assertEquals("Продать",text(j.path("setup").get(0),"text"));
        if(text(j,"platform").equals("kufar"))assertEquals("Продажа",text(j.path("setup").get(3),"text"));
        if(text(j,"platform").equals("domovita"))assertEquals(kind.equals("Дача")?"Дачи":"Коттеджи/Дома",text(j.path("setup").get(1),"text"));
        if(text(j,"platform").equals("onliner"))assertEquals("https://r.onliner.by/pk/apartments/create",text(j,"startUrl"));
      }
    }
  }
  @Test void priceRequiresCurrencyAndRoomsAreNotBedrooms() {
    var result=catalog.prepare(card(object("house.kind","Дом","sale.price","90000","house.rooms","4")));
    for(var p:List.of("realt","kufar","domovita","onliner"))
      assertFalse(values(result,p).has(switch(p){case "realt" -> "realt.termsOfDeal.price";case "onliner" -> "onliner.price.amount";default -> p+".price";}));
    assertFalse(values(result,"realt").has("realt.apartment.rooms"));
  }
  @Test void houseSaleUsesUniversalGroundingAndAddressRules() {
    var schema=catalog.analysisSchema();
    var prompt=RentalAiPolicy.prompt(schema,"house_sale");
    assertTrue(prompt.contains("продать дом целиком"));
    assertTrue(prompt.contains("streetNominative"));
    assertFalse(prompt.contains("Заполняй только предложение продать квартиру"));
    var result=RentalAiPolicy.sanitize(schema,"Продам двухэтажный дом, участок 12 соток. Полная цена 245000 BYN.",object("suggestions",List.of(
        object("field","house.levels","value","2","quote","двухэтажный дом"),
        object("field","house.land_area","value","12","quote","участок 12 соток"),
        object("field","sale.price","value","245000","quote","Полная цена 245000 BYN"),
        object("field","rental.monthly_price","value","245000","quote","Полная цена 245000 BYN"))));
    assertEquals(3,result.path("suggestions").size());
    assertEquals(1,result.path("ignored").asInt());
  }
  @Test void onlinerSourceFieldsAndBrowserRecipeAreExactCopies() throws Exception {
    var sale=MAPPER.readTree(Files.readString(Path.of("../data/rental/apartments_sale/onliner/apartments_sale_onliner.json")));
    var house=MAPPER.readTree(Files.readString(Path.of("../data/rental/houses_sale/onliner/houses_sale_onliner.json")));
    assertEquals(sale.get(0).path("options"),house.get(0).path("options"));
    assertEquals(MAPPER.readTree(Files.readString(Path.of("../data/rental/apartments_sale/runtime/browser_onliner.json"))),
        MAPPER.readTree(Files.readString(Path.of("../data/rental/houses_sale/runtime/browser_onliner.json"))));
  }
}
