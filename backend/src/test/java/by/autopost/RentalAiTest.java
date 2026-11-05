package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.ai.RentalAiPolicy;
import by.autopost.rental.card.*;
import by.autopost.rental.catalog.*;
import by.autopost.rental.model.*;
import by.autopost.rental.preparation.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class RentalAiTest {
  ObjectNode editor() {
    List<ObjectNode> fields = new ArrayList<>();
    for (var pair :
        List.of(
            new String[] {"price", "text"},
            new String[] {"floor", "integer"},
            new String[] {"wifi", "boolean"},
            new String[] {"rental.currency", "enum"},
            new String[] {"style", "multi_enum"},
            new String[] {"listing.description", "text"},
            new String[] {"photos", "files"}))
      fields.add(object("id", pair[0], "name", pair[0], "type", pair[1]));
    return object(
        "category",
        object("options", List.of(object("id", "main", "options", fields))),
        "canonicalValues",
        object(
            "rental.currency", List.of("USD", "EUR", "BYN", "RUB"), "style", List.of("new", "old")),
        "platforms",
        object(
            "one",
            object(
                "rules",
                List.of(
                    object(
                        "common_option_id",
                        "price",
                        "conversion",
                        object("kind", "decimal", "target", "number"))))));
  }

  ObjectNode suggestion(String id, Object value, String quote) {
    return object("field", id, "value", value, "quote", quote);
  }

  @Test
  void acceptsTypedGroundedFactsAndKeepsFalseAndZero() {
    var result =
        RentalAiPolicy.sanitize(
            editor(),
            "Цена 1 500 BYN, этаж 0, без Wi-Fi.",
            object(
                "suggestions",
                List.of(
                    suggestion("price", "1500", "1 500 BYN"),
                    suggestion("floor", "0", "этаж 0"),
                    suggestion("wifi", false, "без Wi-Fi"),
                    suggestion("rental.currency", "BYN", "1 500 BYN"))));
    assertEquals(4, result.path("suggestions").size());
    assertFalse(result.path("suggestions").get(2).path("value").asBoolean());
    assertEquals("0", result.path("suggestions").get(1).path("value").asText());
  }

  @Test
  void dropsUnknownIdsInvalidEnumsInventedNumbersAndUnsupportedQuotes() {
    var result =
        RentalAiPolicy.sanitize(
            editor(),
            "Цена 1500, этаж 3, без Wi-Fi.",
            object(
                "suggestions",
                List.of(
                    suggestion("unknown", "x", "этаж 3"),
                    suggestion("price", "1700", "Цена 1500"),
                    suggestion("floor", "3.2", "этаж 3"),
                    suggestion("wifi", "false", "без Wi-Fi"),
                    suggestion("style", List.of("alien"), "этаж 3"),
                    suggestion("rental.currency", "BYN", "Цена 1500"),
                    suggestion("price", "1500", "нет такой цитаты"),
                    suggestion("listing.description", "hacked", "этаж 3"))));
    assertTrue(result.path("suggestions").isEmpty());
    assertEquals(8, result.path("ignored").asInt());
  }

  @Test
  void rejectsConflictingDuplicatesInsteadOfPickingOne() {
    var result =
        RentalAiPolicy.sanitize(
            editor(),
            "Цена 1500 или 1600",
            object(
                "suggestions",
                List.of(suggestion("price", "1500", "1500"), suggestion("price", "1600", "1600"))));
    assertTrue(result.path("suggestions").isEmpty());
  }

  @Test
  void addressIsLiteralUnconfirmedAndNeverAcceptsProviderIdsCoordinatesOrExtraSecrets() {
    var result =
        RentalAiPolicy.sanitize(
            editor(),
            "Сдам: Минск, улица Тестовая, 7А. 1500 BYN",
            object(
                "address",
                object(
                    "label",
                    "Минск, улица Тестовая, 7А",
                    "quote",
                    "Минск, улица Тестовая, 7А",
                    "confirmed",
                    true,
                    "latitude",
                    53.9,
                    "provider",
                    "dadata",
                    "key",
                    "secret")));
    assertFalse(result.path("address").path("confirmed").asBoolean());
    assertEquals("manual", result.path("address").path("provider").asText());
    assertFalse(result.toString().contains("secret"));
    assertFalse(result.path("address").has("latitude"));
    assertTrue(
        RentalAiPolicy.sanitize(
                editor(),
                "Сдам квартиру",
                object("address", object("label", "Минск", "quote", "квартиру")))
            .path("address")
            .isNull());
  }

  @Test
  void rublesDefaultToBynUnlessExplicitlyRussian() {
    assertTrue(RentalAiPolicy.currencyGrounded("BYN", "1500 рублей"));
    assertTrue(RentalAiPolicy.currencyGrounded("BYN", "1500 бел. руб."));
    assertTrue(RentalAiPolicy.currencyGrounded("USD", "500 долларов"));
    assertFalse(RentalAiPolicy.currencyGrounded("EUR", "500 долларов"));
  }

  @Test
  void acceptsNumericJsonAsWellAsDecimalStrings() {
    var result =
        RentalAiPolicy.sanitize(
            editor(),
            "Цена 1500 BYN, этаж 3",
            object(
                "suggestions",
                List.of(
                    suggestion("price", 1500, "Цена 1500 BYN"), suggestion("floor", 3, "этаж 3"))));
    assertEquals(2, result.path("suggestions").size());
    assertEquals("1500", result.path("suggestions").get(0).path("value").asText());
  }

  @Test
  void rejectsInventedContactTextInvalidDatesAndPhonesWithoutDigits() {
    assertNull(
        RentalAiPolicy.validValue(
            object("id", "contact.name", "type", "text"),
            array(),
            TextNode.valueOf("Выдуманный Контакт"),
            "Сдам квартиру"));
    assertNull(
        RentalAiPolicy.validValue(
            object("id", "contact.phone", "type", "text"),
            array(),
            TextNode.valueOf("-------"),
            "Сдам квартиру"));
    assertNull(
        RentalAiPolicy.validValue(
            object("id", "date", "type", "date"),
            array(),
            TextNode.valueOf("вчера"),
            "Договор вчера"));
    assertNull(
        RentalAiPolicy.validValue(
            object("id", "date", "type", "date"),
            array(),
            TextNode.valueOf("2026-02-30"),
            "2026-02-30"));
    assertEquals(
        "2026-11-02",
        RentalAiPolicy.validValue(
                object("id", "date", "type", "date"),
                array(),
                TextNode.valueOf("2026-11-02"),
                "Договор 2026-11-02")
            .asText());
    assertEquals(
        "Илья",
        RentalAiPolicy.validValue(
                object("id", "contact.name", "type", "text"),
                array(),
                TextNode.valueOf("Илья"),
                "Меня зовут Илья")
            .asText());
  }

  @Test
  void providerPromptUsesCurrentCanonicalSchemaNotNativeFormsOrStoredCards() {
    String prompt = RentalAiPolicy.prompt(editor());
    assertTrue(prompt.contains("price"));
    assertTrue(prompt.contains("wifi"));
    assertFalse(prompt.contains("photos"));
    assertFalse(RentalAiPolicy.fields(editor()).containsKey("listing.description"));
  }
}
