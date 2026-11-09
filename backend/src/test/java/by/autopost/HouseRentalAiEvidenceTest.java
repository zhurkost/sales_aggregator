package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.ai.RentalAiPolicy;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.CategoryRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Reproductions from real house-editor AI responses on 2026-11-09. */
class HouseRentalAiEvidenceTest {
  private final JsonNode schema = new RentalCatalog(new CategoryRegistry("../data/rental")
      .require("houses_long_term_rent").references()).analysisSchema();

  private JsonNode suggestion(String field, String value, String quote) {
    return RentalAiPolicy.sanitize(schema, quote,
        object("suggestions", List.of(object("field", field, "value", value, "quote", quote))))
        .path("suggestions");
  }

  @Test
  void aRoleIsNotAContactName() {
    for (String role : List.of("Собственник", "Хозяйка", "Агент", "Риэлтор", "Собственник дома"))
      assertTrue(suggestion("contact.name", role, role).isEmpty(), role);
    assertEquals(1, suggestion("contact.name", "Илья", "Собственник Илья").size());
    assertEquals(1, suggestion("specific.onliner.contact_owner", "Собственник", "Собственник").size());
  }

  @Test
  void keepsExplicitHouseLevelsWrittenAsWords() {
    for (String quote : List.of("два уровня", "двухэтажный дом", "двухуровневый коттедж")) {
      var result = suggestion("house.levels", "2", quote);
      assertEquals(1, result.size(), quote);
      assertEquals("2", text(result.get(0), "value"));
    }
    assertEquals(1, suggestion("house.levels", "1", "одноэтажный дом").size());
    assertEquals(1, suggestion("house.levels", "3", "Три уровня").size());
  }

  @Test
  void keepsExplicitGuestCapacityWrittenAsWords() {
    for (var example : List.of(new String[]{"8", "вместимость восемь человек"},
        new String[]{"6", "Дом рассчитан на шесть человек"},
        new String[]{"4", "на четырёх человек"},
        new String[]{"5", "максимум пять жильцов"},
        new String[]{"12", "на двенадцать гостей"})) {
      var result = suggestion("house.capacity", example[0], example[1]);
      assertEquals(1, result.size(), example[1]);
      assertEquals(example[0], text(result.get(0), "value"));
    }
  }

  @Test
  void doesNotConfuseUnrelatedWordCountsWithLevelsOrCapacity() {
    assertTrue(suggestion("house.levels", "2", "два гаража").isEmpty());
    assertTrue(suggestion("house.capacity", "6", "шесть соток").isEmpty());
    assertTrue(suggestion("house.levels", "3", "два уровня").isEmpty());
    assertTrue(suggestion("house.capacity", "8", "на четырёх человек").isEmpty());
    assertTrue(suggestion("house.levels", "2", "двухэтажный гараж").isEmpty());
  }

  @Test
  void depositDoesNotBecomeDomovitaAdvancePayment() {
    assertTrue(suggestion("specific.domovita.prepayment", "месяц", "Залог за один месяц").isEmpty());
    assertTrue(suggestion("specific.domovita.prepayment", "нет", "Без залога").isEmpty());
    assertEquals(1, suggestion("specific.domovita.prepayment", "2 месяца", "Предоплата за два месяца").size());
    assertEquals(1, suggestion("specific.domovita.prepayment", "нет", "Без предоплаты").size());
  }

  @Test
  void houseSummaryUsesTheSameAiFieldAsApartmentCategories() {
    assertTrue(RentalAiPolicy.fields(schema).containsKey("listing.short_description"));
    var result = suggestion("listing.short_description", "Дом с гаражом и баней для длительной аренды.",
        "Сдам дом целиком на длительный срок. Есть гараж и баня.");
    assertEquals(1, result.size());
    var catalog = new RentalCatalog(new CategoryRegistry("../data/rental")
        .require("houses_long_term_rent").references());
    var prepared = catalog.prepare(object("categoryId", "houses_long_term_rent", "modelVersion", 2,
        "schemaVersion", catalog.version(), "values", object("house.kind", "Дом", "listing.short_description", text(result.get(0), "value")),
        "platforms", List.of("realt")));
    assertEquals(text(result.get(0), "value"),
        text(prepared.path("platforms").get(0).path("values"), "realt.description.shortDescription"));
  }
}
