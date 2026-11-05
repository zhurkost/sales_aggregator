package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.ai.AiCard;
import by.autopost.rental.ai.RentalAiPolicy;
import by.autopost.rental.catalog.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class RentalAiTest {
  /** What AiCard.of gives for a card whose price a platform converts to a number. */
  AiCard editor() {
    Map<String, List<String>> choices =
        Map.of(
            "rental.currency",
            List.of("USD", "EUR", "BYN", "RUB"),
            "style",
            List.of("new", "old"),
            "rooms",
            List.of("studio", "1", "2", "5+"),
            "levels",
            List.of("1", "2", "3"));
    Map<String, AiCard.Field> fields = new LinkedHashMap<>();
    for (var pair :
        List.of(
            new String[] {"price", "number"},
            new String[] {"floor", "integer"},
            new String[] {"wifi", "boolean"},
            new String[] {"rental.currency", "enum"},
            new String[] {"style", "multi_enum"},
            new String[] {"complex", "text"},
            new String[] {"rooms", "enum"},
            new String[] {"levels", "multi_enum"}))
      fields.put(
          pair[0],
          new AiCard.Field(pair[0], pair[0], pair[1], choices.getOrDefault(pair[0], List.of())));
    return new AiCard("card", fields, Map.of());
  }

  static AiCard.Field field(String id, String type) {
    return new AiCard.Field(id, id, type, List.of());
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
  void rublesWithoutCurrencyRemainUnknown() {
    assertFalse(RentalAiPolicy.currencyGrounded("BYN", "1500 рублей"));
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
  void quotesMatchDespiteTypographyOfTheModel() {
    String source =
        "Сдаётся квартира в ЖК «Новая Боровая» — этаж 3, цена 1\u00a0500\u00a0BYN,"
            + " Wi\u2011Fi есть.";
    var result =
        RentalAiPolicy.sanitize(
            editor(),
            source,
            object(
                "suggestions",
                List.of(
                    suggestion("wifi", true, "Wi-Fi есть"),
                    suggestion("complex", "Новая Боровая", "ЖК \"Новая Боровая\""),
                    suggestion("floor", "3", "Сдается квартира в ЖК “Новая Боровая” - этаж 3"),
                    suggestion("price", "1500", "цена 1 500 BYN"),
                    suggestion("rental.currency", "BYN", "1 500 BYN"))));
    assertEquals(0, result.path("ignored").asInt(), result.toString());
    assertEquals(5, result.path("suggestions").size());
    assertEquals("Новая Боровая", text(result.path("suggestions").get(1), "value"));
    // Normalization makes typography irrelevant, not words.
    assertFalse(RentalAiPolicy.grounded(source, "ЖК «Старая Боровая»"));
    assertTrue(RentalAiPolicy.grounded("«Ёлки»\u00a0—\u00a0рядом", "\"елки\" - РЯДОМ"));
  }

  @Test
  void numericOptionCodeFromTheModelBecomesItsStringCode() {
    var result =
        RentalAiPolicy.sanitize(
            editor(),
            "Сдам 2 комнаты, уровни 1 и 3, этаж 2.",
            object(
                "suggestions",
                List.of(
                    suggestion("rooms", 2, "Сдам 2 комнаты"),
                    suggestion("levels", List.of(1, "3"), "уровни 1 и 3"))));
    assertEquals(0, result.path("ignored").asInt(), result.toString());
    assertEquals(TextNode.valueOf("2"), result.path("suggestions").get(0).path("value"));
    assertEquals(
        array(List.of("1", "3")), result.path("suggestions").get(1).path("value"));
    var rejected =
        RentalAiPolicy.sanitize(
            editor(),
            "Сдам 2 комнаты",
            object(
                "suggestions",
                List.of(
                    suggestion("rooms", 4, "Сдам 2 комнаты"),
                    suggestion("rooms", 2.5, "Сдам 2 комнаты"),
                    suggestion("rooms", true, "Сдам 2 комнаты"),
                    suggestion("levels", List.of(4), "Сдам 2 комнаты"))));
    assertTrue(rejected.path("suggestions").isEmpty());
    assertEquals(4, rejected.path("ignored").asInt());
  }

  @Test
  void rejectsInventedContactTextInvalidDatesAndPhonesWithoutDigits() {
    assertNull(
        RentalAiPolicy.validValue(
            field("contact.name", "text"),
            TextNode.valueOf("Выдуманный Контакт"),
            "Сдам квартиру"));
    assertNull(
        RentalAiPolicy.validValue(
            field("contact.phone", "text"),
            TextNode.valueOf("-------"),
            "Сдам квартиру"));
    assertNull(
        RentalAiPolicy.validValue(
            field("date", "date"),
            TextNode.valueOf("вчера"),
            "Договор вчера"));
    assertNull(
        RentalAiPolicy.validValue(
            field("date", "date"),
            TextNode.valueOf("2026-02-30"),
            "2026-02-30"));
    assertEquals(
        "2026-11-02",
        RentalAiPolicy.validValue(
            field("date", "date"),
                TextNode.valueOf("2026-11-02"),
                "Договор 2026-11-02")
            .asText());
    assertEquals(
        "Илья",
        RentalAiPolicy.validValue(
            field("contact.name", "text"),
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
    var card =
        AiCard.of(new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot());
    assertFalse(card.fields().containsKey("listing.description"));
    assertFalse(card.fields().containsKey("media.images"));
    assertFalse(card.fields().containsKey("location.latitude"));
    // A text field a platform converts to a number is offered as that number.
    assertEquals("number", card.fields().get("rental.total_area").type());
    assertEquals("integer", card.fields().get("rental.floor").type());
    assertTrue(card.fields().get("rental.currency").choices().contains("BYN"));
  }
}
